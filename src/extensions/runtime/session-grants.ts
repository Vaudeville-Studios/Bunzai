/** Expires session-duration grants once when a runtime opens a new host session. */
import { inspectExtensionPackage } from "../contracts/package-validation";
import { ExtensionServiceError } from "./service-errors";
import type { ExtensionRuntimeFence, ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionGrant } from "../contracts/grants";
import type { ThemeScope } from "../theme-appearance";

type SessionGrantStore = Pick<ExtensionStore, "listControls" | "readPackage" | "compareAndSaveControl">;
type Fingerprint = (grants: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[]) => Promise<string>;

export async function expireSessionGrants(
  store: SessionGrantStore,
  liveFence: ExtensionRuntimeFence,
  fingerprint: Fingerprint,
  stopRuns: (packageId: string) => Promise<void>,
): Promise<void> {
  for (const control of await store.listControls()) {
    if (!control.grants.some((grant) => grant.duration === "session")) continue;
    let grants = control.grants.filter((grant) => grant.duration === "persistent");
    let recoveryRequired = control.recoveryRequired, enabled = control.enabled;
    try {
      const stored = await store.readPackage(control.packageDigest);
      if (!stored) throw new Error("missing package");
      const pkg = (await inspectExtensionPackage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown)).package;
      const allowed = new Set(grants.map((grant) => grant.operation));
      if (pkg.manifest.requirements.some((requirement) => requirement.required && !allowed.has(requirement.operation))) {
        enabled = false; recoveryRequired = true;
      }
    } catch {
      grants = []; enabled = false; recoveryRequired = true;
    }
    let policyFingerprint: string;
    try { policyFingerprint = await fingerprint(grants, control.themeScopes); }
    catch {
      grants = [];
      policyFingerprint = await fingerprint([], control.themeScopes);
      enabled = false; recoveryRequired = true;
    }
    const next = { ...control, grants, eventSubscriptions: [], policyFingerprint, grantRevision: control.grantRevision + 1,
      revision: control.revision + 1, enabled, recoveryRequired };
    if (await store.compareAndSaveControl(next, control.revision, liveFence) !== "saved") {
      throw new ExtensionServiceError("CONFLICT", "Extension state changed while session access expired.");
    }
    if (!next.enabled) await stopRuns(control.id);
  }
}
