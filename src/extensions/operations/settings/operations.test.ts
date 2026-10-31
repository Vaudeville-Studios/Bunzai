/** Exercises package-owned settings reads and reviewed revision-checked updates. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionSettingsServices } from "./_services";
import read from "./read";
import update from "./update";

const context = (): ExtensionOperationContext => ({
  principal: { storeId: "fixture", packageId: "example.extension", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: ["settings.read", "settings.update"], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [], fields: ["settings"], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "example.extension", packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 2, operation: "settings.update", access: { resources: [], fields: ["settings"], methods: [], destinations: [] }, now: () => 1 }, confirm: async () => true, assertCurrent: async () => {},
});

test("settings handlers use the trusted principal and validate against its schema", async () => {
  const calls: unknown[][] = [];
  const settings: ExtensionSettingsServices = {
    read: async (packageId, digest) => { calls.push(["read", packageId, digest]); return { schema: { type: "object", properties: { mode: { type: "string" } }, required: ["mode"] }, value: { mode: "quiet" }, revision: 1 }; },
    write: async (packageId, digest, value, revision, commit) => { calls.push(["write", packageId, digest, value, revision, commit.operation]); return { status: "saved", revision: 2 }; },
  };
  const services = { settings } as ExtensionOperationServices;
  await expect(read[0]!.execute({}, context(), services)).resolves.toMatchObject({ value: { mode: "quiet" }, revision: 1 });
  await expect(update[0]!.review!({ value: { mode: "loud" }, expectedRevision: 1 }, context(), services)).resolves.toMatchObject({ packageId: "example.extension", expectedRevision: 1 });
  await expect(update[0]!.review!({ value: { mode: 1 }, expectedRevision: 1 }, context(), services)).rejects.toThrow();
  await expect(update[0]!.execute({ value: { mode: "loud" }, expectedRevision: 1 }, context(), services)).resolves.toEqual({ status: "saved", revision: 2 });
  expect(calls.at(-1)).toEqual(["write", "example.extension", "a".repeat(64), { mode: "loud" }, 1, "settings.update"]);
});
/** Exercises package-owned settings reads and reviewed revision-checked updates. */
