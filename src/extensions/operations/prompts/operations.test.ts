/** Proves prompt calls can only contribute and replace one active invocation's candidate. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext, ExtensionOperationDefinition, ExtensionPromptInvocation, OperationPrincipal } from "../../contracts/operation";
import { MAX_EXTENSION_PROMPT_CANDIDATE_BYTES } from "../../contracts/limits";
import { promptOperations } from "./operations";

const principal: OperationPrincipal = { storeId: "store", packageId: "pkg", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
function setup(): { context: ExtensionOperationContext; candidate: () => string | null } {
  let value: string | null = null;
  const replace = (text: string, transforming: boolean): boolean => {
    if (new TextEncoder().encode(text).byteLength > MAX_EXTENSION_PROMPT_CANDIDATE_BYTES || (transforming ? value === null : value !== null)) return false;
    value = text;
    return true;
  };
  const invocation: ExtensionPromptInvocation = {
    sceneId: "scene", stage: "system.append", messages: [],
    contribute: (text) => replace(text, false), transform: (text) => replace(text, true),
  };
  return {
    context: {
      principal, signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: [], availableOperations: [], availableGrants: [],
      operationReceipts: [], host: "desktop", access: { resources: [], fields: ["system.append"], methods: [], destinations: [] },
      commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "pkg", packageDigest: principal.packageDigest,
        policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: "prompts.contribute", access: { resources: [], fields: ["system.append"], methods: [], destinations: [] }, now: () => 1 },
      confirm: async () => false, assertCurrent: async () => {}, promptInvocation: invocation,
    },
    candidate: () => value,
  };
}
const candidateOperation = (id: "prompts.contribute" | "prompts.transform") => promptOperations.find((item) => item.metadata.id === id)! as ExtensionOperationDefinition<
  { sceneId: string; stage: "system.append"; text: string }, { accepted: boolean }, undefined
>;

test("transform requires a candidate from the same active hook", async () => {
  const current = setup();
  const transform = candidateOperation("prompts.transform");
  const args = transform.metadata.input.parse({ sceneId: "scene", stage: "system.append", text: "replacement" });
  await expect(transform.execute(args, current.context, undefined)).resolves.toEqual({ accepted: false });
  expect(current.candidate()).toBeNull();
});

test("contribute then transform replaces only this candidate and respects the UTF-8 ceiling", async () => {
  const current = setup();
  const contribute = candidateOperation("prompts.contribute");
  const transform = candidateOperation("prompts.transform");
  await expect(contribute.execute(contribute.metadata.input.parse({ sceneId: "scene", stage: "system.append", text: "initial" }), current.context, undefined)).resolves.toEqual({ accepted: true });
  await expect(transform.execute(transform.metadata.input.parse({ sceneId: "scene", stage: "system.append", text: "replacement" }), current.context, undefined)).resolves.toEqual({ accepted: true });
  expect(current.candidate()).toBe("replacement");
  await expect(transform.execute(transform.metadata.input.parse({ sceneId: "scene", stage: "system.append", text: "\u{1F4AC}".repeat(1_001) }), current.context, undefined)).resolves.toEqual({ accepted: false });
  expect(current.candidate()).toBe("replacement");
});
