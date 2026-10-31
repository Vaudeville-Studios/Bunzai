/** Contract tests for fail-closed extension operation discovery. */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createOperationCatalog } from "./operations";
import type { JsonValue } from "../contracts/value";
import { createExtensionOperations } from "../../generated/extension-operations";
import { extensionOperationMetadata } from "../../generated/extension-operation-metadata";
import { operationPolicyFingerprint } from "../permissions/fingerprint";
import describeDefinition from "../operations/api/describe";
import type { ExtensionOperationDescriptor } from "../contracts/operation";

const makeOperation = (id: string): ExtensionOperationDescriptor => ({
  id,
  version: 1,
  inputVersion: 1,
  outputVersion: 1,
  projectionVersion: 1,
  title: "Read title",
  description: "Read a title.",
  input: z.strictObject({ id: z.string() }),
  output: z.strictObject({ title: z.string() }),
  effect: "read",
  sensitivity: "private",
  hosts: ["desktop"],
  estimateBudget: () => ({ bytes: 4096, tokens: 0 }),
  measureTokens: () => 0,
  policy: {
    resources: ["piece"], fields: ["title"], methods: [], destinations: [], destinationMode: "none", budget: "read-small",
    confirmation: "none",
  },
  resolveAccess: ({ id }) => ({ resources: [{ kind: "piece", id }], fields: ["title"], methods: [], destinations: [] }),
  project: (value) => value as JsonValue,
  execute: async ({ id }) => ({ title: id }),
});

describe("extension operation catalog", () => {
  test("orders descriptors and generates closed input/output schemas", () => {
    const catalog = createOperationCatalog([makeOperation("piece.read"), makeOperation("api.describe")]);
    expect(catalog.all().map(({ id }) => id)).toEqual(["api.describe", "piece.read"]);
    expect(catalog.metadata()[1]?.input.additionalProperties).toBe(false);
    expect(catalog.metadata()[1]?.output.additionalProperties).toBe(false);
  });

  test("rejects duplicate IDs, open objects, and missing policy values", () => {
    expect(() => createOperationCatalog([makeOperation("piece.read"), makeOperation("piece.read")]))
      .toThrow("duplicate extension operation id");
    const open = makeOperation("piece.open");
    open.input = z.object({ id: z.string() });
    expect(() => createOperationCatalog([open])).toThrow("object schemas must reject unknown keys");
    const malformed = makeOperation("piece.bad");
    malformed.policy = { ...malformed.policy, budget: "unknown" as never };
    expect(() => createOperationCatalog([malformed])).toThrow("invalid extension policy");
    const mismatch = makeOperation("piece.mismatch");
    mismatch.effect = "external";
    expect(() => createOperationCatalog([mismatch])).toThrow("effect does not match");
    const destination = makeOperation("piece.destination");
    destination.policy = { ...destination.policy, destinations: ["https://example.com"] };
    expect(() => createOperationCatalog([destination])).toThrow("only fixed-origins");
    const invalidOrigin = makeOperation("piece.fixed");
    invalidOrigin.policy = { ...invalidOrigin.policy, destinationMode: "fixed-origins", destinations: ["https://example.com/path"] };
    expect(() => createOperationCatalog([invalidOrigin])).toThrow("exact public HTTPS origins");
    const invalidMethod = makeOperation("piece.method");
    invalidMethod.policy = { ...invalidMethod.policy, methods: ["TRACE"] };
    expect(() => createOperationCatalog([invalidMethod])).toThrow("invalid method policy");
    const publicLink = makeOperation("links.open");
    publicLink.policy = { ...publicLink.policy, destinationMode: "approved-public-https" };
    expect(() => createOperationCatalog([publicLink])).not.toThrow();
  });

  test("delegated writes name reviewed children and reject missing or unreviewed targets", () => {
    const child = makeOperation("files.write.apply");
    child.effect = "write";
    child.policy = { ...child.policy, budget: "write", confirmation: "effect" };
    const wrapper = makeOperation("export.write");
    wrapper.effect = "write";
    wrapper.policy = { ...wrapper.policy, budget: "write" };
    wrapper.delegates = [child.id];
    expect(createOperationCatalog([wrapper, child]).get("export.write")?.delegates).toEqual([child.id]);

    const unreviewed = makeOperation("export.write");
    unreviewed.effect = "write";
    unreviewed.policy = { ...unreviewed.policy, budget: "write" };
    expect(() => createOperationCatalog([unreviewed])).toThrow("must declare delegated operations");
    const missing = { ...wrapper, delegates: ["absent.write"] };
    expect(() => createOperationCatalog([missing, child])).toThrow("delegated target must be a reviewed write");
    const cycle = { ...wrapper, delegates: ["export.write"] };
    expect(() => createOperationCatalog([cycle, child])).toThrow("delegated target must be a reviewed write");
  });

  test("allows only metadata-budget host-confirmed control previews", () => {
    const preview = makeOperation("macros.preview");
    preview.effect = "control";
    preview.policy = { ...preview.policy, budget: "metadata", confirmation: "effect" };
    expect(() => createOperationCatalog([preview])).not.toThrow();
    expect(() => createOperationCatalog([{ ...preview, policy: { ...preview.policy, budget: "read-large" } }]))
      .toThrow("effect does not match");
    expect(() => createOperationCatalog([{ ...preview, policy: { ...preview.policy, confirmation: "sensitive-send" } }]))
      .toThrow("effect does not match");
  });

  test("validates activation-origin policies and preserves them in public metadata", () => {
    const safeRead = { ...makeOperation("content.read"), activationOrigins: ["command", "prompt"] as const };
    expect(createOperationCatalog([safeRead]).metadata()[0]?.activationOrigins).toEqual(["command", "prompt"]);
    expect(() => createOperationCatalog([{ ...safeRead, activationOrigins: ["prompt", "prompt"] }]))
      .toThrow("invalid activation origin policy");
    expect(() => createOperationCatalog([{ ...safeRead, activationOrigins: ["worker"] as never }]))
      .toThrow("invalid activation origin policy");
  });

  test("binds activation origins into the permission fingerprint", async () => {
    const unrestricted = makeOperation("content.read");
    const promptScoped = { ...unrestricted, activationOrigins: ["command", "prompt"] as const };
    expect(await operationPolicyFingerprint(unrestricted)).not.toBe(await operationPolicyFingerprint(promptScoped));
  });

  test("binds schema changes into the permission fingerprint even at the same explicit versions", async () => {
    const original = makeOperation("content.read");
    const changed = { ...original, output: z.strictObject({ title: z.string(), revision: z.number().int() }) };
    expect(changed.version).toBe(original.version);
    expect(await operationPolicyFingerprint(original)).not.toBe(await operationPolicyFingerprint(changed));
  });

  test("baked metadata matches every source operation folder", async () => {
    const root = join(import.meta.dir, "..", "operations");
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.startsWith("_")) files.push(path);
      }
    };
    visit(root);
    const discovered = [];
    for (const file of files) {
      const module = await import(pathToFileURL(file).href);
      const exported = module.definitions ?? module.default;
      const definitions = (Array.isArray(exported) ? exported : [exported]) as
        { metadata: { id: string } }[];
      discovered.push(...definitions.map((definition) => definition.metadata));
    }
    expect(discovered.map(({ id }) => id).sort()).toEqual(extensionOperationMetadata.map(({ id }) => id));
    const exported = extensionOperationMetadata.find(({ id }) => id === "export.write");
    expect(exported && "delegates" in exported ? exported.delegates : undefined).toEqual(["files.write.apply"]);
    const services = {
      content: { readSummary: async () => null, readBody: async () => null, readSelectedFields: async () => null, listSummaries: async () => [], searchSummaries: async () => [], readFields: async () => null, readPersonaIdentity: async () => null, readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null },
    };
    expect(createExtensionOperations(services).all().map(({ id }) => id)).toEqual(extensionOperationMetadata.map(({ id }) => id));
  });

  test("api.describe returns public host metadata and marks the caller's grants", async () => {
    const available = createOperationCatalog([makeOperation("piece.read"), makeOperation("piece.write")]).metadata();
    const value = await describeDefinition.execute({ offset: 0, limit: 10 }, {
      principal: {
        storeId: "store", packageId: "pkg", packageDigest: "digest", apiMajor: 1,
        policyFingerprint: "policy", grantRevision: 1, runEpoch: 1,
      },
      signal: new AbortController().signal,
      invocation: { resources: [] },
      resources: [],
      grantedOperations: ["piece.read", "api.describe"],
      host: "desktop",
      availableGrants: [],
      operationReceipts: [],
      availableOperations: JSON.parse(JSON.stringify(available)) as JsonValue[],
      access: { resources: [], fields: [], methods: [], destinations: [] },
      commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "pkg", packageDigest: "digest", policyFingerprint: "policy", grantRevision: 1, operation: "api.describe", access: { resources: [], fields: ["api.catalog"], methods: [], destinations: [] }, now: () => 1 },
      assertCurrent: async () => undefined,
      confirm: async () => false,
    }, undefined);
    expect(value).toMatchObject({ operations: [{ id: "piece.read", granted: true, inputSchema: expect.any(String) }, { id: "piece.write", granted: false, inputSchema: expect.any(String) }], total: 2, nextOffset: null });
  });
});
