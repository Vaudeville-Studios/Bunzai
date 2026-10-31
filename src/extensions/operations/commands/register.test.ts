/** Verifies broker operation inputs stay inside trusted manifest command declarations. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext, ExtensionOperationDefinition, OperationPrincipal } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { commandOperations } from "./register";

const principal: OperationPrincipal = { storeId: "store", packageId: "pkg", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const context = (): ExtensionOperationContext => ({ principal, signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: [],
  availableOperations: [], availableGrants: [], operationReceipts: [], host: "desktop", declaredCommands: ["run", "inspect"],
  access: { resources: [], fields: ["commands"], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "pkg", packageDigest: principal.packageDigest,
    policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: "commands.register", access: { resources: [], fields: ["commands"], methods: [], destinations: [] }, now: () => 1 }, confirm: async () => false, assertCurrent: async () => {} });
const operation = commandOperations[0] as ExtensionOperationDefinition<{ commandIds: string[] }, { status: "saved" | "stale"; registered: string[]; revision: number }, ExtensionOperationServices>;

test("command registration reviews current and requested IDs and persists only manifest-declared IDs", async () => {
  let saved: readonly string[] = [];
  const services = { content: {} as never, commands: { registered: async () => ["run", "inspect"], replaceRegistered: async (_id: string, ids: readonly string[]) => {
    saved = ids; return { status: "saved" as const, registered: ids, revision: 2 };
  } } } as ExtensionOperationServices;
  const invocation = context();
  const input = operation.metadata.input.parse({ commandIds: ["run"] });
  await expect(operation.review!(input, invocation, services)).resolves.toEqual({ operation: "commands.register", packageId: "pkg", current: ["run", "inspect"], requested: ["run"] });
  await expect(operation.execute(input, invocation, services)).resolves.toEqual({ status: "saved", registered: ["run"], revision: 2 });
  expect(saved).toEqual(["run"]);
  const invalid = operation.metadata.input.parse({ commandIds: ["hidden"] });
  await expect(operation.execute(invalid, invocation, services)).rejects.toThrow(/manifest/);
});

test("command registration input rejects duplicates and extra properties", () => {
  expect(() => operation.metadata.input.parse({ commandIds: ["run", "run"] })).toThrow();
  expect(() => operation.metadata.input.parse({ commandIds: ["run"], packageId: "another" })).toThrow();
});
