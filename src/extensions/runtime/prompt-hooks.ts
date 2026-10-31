/** Runs manifest-declared prompt contributors through the active-turn broker boundary. */
import type { ExtensionPromptInvocation, ExtensionOperationDescriptor } from "../contracts/operation";
import { MAX_EXTENSION_PROMPT_CANDIDATE_BYTES, MAX_EXTENSION_PROMPT_HOOKS, MAX_EXTENSION_PROMPT_TOTAL_BYTES } from "../contracts/limits";
import type { ExtensionRuntimeFence, ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionPackageInput } from "../contracts/package";
import { inspectExtensionPackage } from "../contracts/package-validation";
import { decodeJsonValue } from "../contracts/value";
import { resolveGrantedAccess } from "../permissions/matching";

type Message = { role: "system" | "user" | "assistant" | "tool"; content: string };
type Activate = (id: string, kind: "command" | "event", contributionId: string, input: ReturnType<typeof decodeJsonValue>, invocation?: ExtensionPromptInvocation, signal?: AbortSignal) => Promise<unknown>;
type Hook = { packageId: string; packageDigest: string; grantRevision: number; id: string; priority: number; stage: "system.append"; required: boolean };
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

async function recordOutcome(store: ExtensionStore, requireFence: () => Promise<ExtensionRuntimeFence>, hook: Hook, succeeded: boolean): Promise<boolean> {
  const fence = await requireFence();
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await store.readControl(hook.packageId);
    if (!current || !current.enabled || current.recoveryRequired || current.packageDigest !== hook.packageDigest || current.grantRevision !== hook.grantRevision) return false;
    const failures = current.promptFailures.filter((item) => item.id !== hook.id);
    const suspended = [...current.suspendedPromptIds];
    if (succeeded) {
      if (failures.length === current.promptFailures.length) return false;
      const next = { ...current, promptFailures: failures, revision: current.revision + 1 };
      if (await store.compareAndSaveControl(next, current.revision, fence) === "saved") return false;
      continue;
    }
    const count = (current.promptFailures.find((item) => item.id === hook.id)?.count ?? 0) + 1;
    if (count >= 3) {
      if (!suspended.includes(hook.id)) suspended.push(hook.id);
    } else failures.push({ id: hook.id, count });
    const next = { ...current, promptFailures: failures, suspendedPromptIds: suspended, revision: current.revision + 1 };
    if (await store.compareAndSaveControl(next, current.revision, fence) === "saved") return count >= 3;
  }
  return false;
}

async function stillAuthorized(store: ExtensionStore, hook: Hook): Promise<boolean> {
  const current = await store.readControl(hook.packageId);
  return !!current && current.enabled && !current.recoveryRequired && current.packageDigest === hook.packageDigest
    && current.grantRevision === hook.grantRevision && !current.suspendedPromptIds.includes(hook.id);
}

export function createPromptHookRunner(store: ExtensionStore, operations: readonly ExtensionOperationDescriptor[], requireFence: () => Promise<ExtensionRuntimeFence>, activate: Activate) {
  return async (sceneId: string, messages: readonly Message[], signal: AbortSignal): Promise<readonly string[]> => {
    await requireFence();
    const candidates: Hook[] = [];
    const controls = [...await store.listControls()].sort((a, b) => compareText(a.id, b.id));
    for (const control of controls) {
      if (!control.enabled || control.recoveryRequired) continue;
      const stored = await store.readPackage(control.packageDigest);
      if (!stored) continue;
      let pkg: ExtensionPackageInput;
      try { pkg = (await inspectExtensionPackage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown)).package; }
      catch { continue; }
      const hasPromptGrant = operations.some((operation) => control.grants.some((grant) => grant.operation === operation.id
        && resolveGrantedAccess(grant, operation, operation.resolveAccess({ sceneId, stage: "system.append" }), []) !== null));
      if (!hasPromptGrant) continue;
      for (const hook of pkg.manifest.contributions) {
        if (hook.type !== "prompt" || hook.stage !== "system.append") continue;
        if (control.suspendedPromptIds.includes(hook.id)) continue;
        candidates.push({ packageId: control.id, packageDigest: control.packageDigest, grantRevision: control.grantRevision, id: hook.id, priority: hook.priority ?? 0, stage: hook.stage, required: hook.required ?? false });
      }
    }
    candidates.sort((a, b) => a.priority - b.priority || compareText(a.packageId, b.packageId) || compareText(a.id, b.id));
    const required = candidates.filter((hook) => hook.required);
    if (required.length > MAX_EXTENSION_PROMPT_HOOKS) throw new Error("Required prompt hooks exceed the host hook limit.");
    const selected = [...required, ...candidates.filter((hook) => !hook.required).slice(0, MAX_EXTENSION_PROMPT_HOOKS - required.length)]
      .sort((a, b) => a.priority - b.priority || compareText(a.packageId, b.packageId) || compareText(a.id, b.id));

    const output: string[] = [];
    let totalBytes = 0;
    for (const hook of selected) {
      if (signal.aborted) break;
      let candidate: string | null = null;
      const replace = (text: string, transform: boolean): boolean => {
        const bytes = new TextEncoder().encode(text).byteLength;
        if (!text.trim() || bytes > MAX_EXTENSION_PROMPT_CANDIDATE_BYTES || totalBytes + bytes > MAX_EXTENSION_PROMPT_TOTAL_BYTES
          || (transform ? candidate === null : candidate !== null)) return false;
        candidate = text;
        return true;
      };
      const invocation: ExtensionPromptInvocation = {
        sceneId, stage: hook.stage, messages,
        contribute: (text) => replace(text, false),
        transform: (text) => replace(text, true),
      };
      try {
        await activate(hook.packageId, "event", hook.id, decodeJsonValue({ sceneId, stage: hook.stage }), invocation, signal);
        if (signal.aborted) break;
        if (candidate === null) {
          if (hook.required) throw new Error(`Required prompt contribution ${hook.id} did not produce a candidate.`);
          await recordOutcome(store, requireFence, hook, false);
          continue;
        }
        await recordOutcome(store, requireFence, hook, true);
        if (!signal.aborted && !(await stillAuthorized(store, hook))) {
          if (hook.required) throw new Error(`Required prompt contribution ${hook.id} was revoked before acceptance.`);
          continue;
        }
        if (candidate !== null && !signal.aborted) {
          totalBytes += new TextEncoder().encode(candidate).byteLength;
          output.push(candidate);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (hook.required) throw error;
        try { await recordOutcome(store, requireFence, hook, false); } catch { /* Optional hook failure cannot block the host turn. */ }
      }
    }
    return output;
  };
}
