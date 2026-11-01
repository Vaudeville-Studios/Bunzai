/** Test generated extension catalog determinism and source ownership. */
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("catalog generation matches its checked-in projections", () => {
  const result = Bun.spawnSync(["bun", "run", "scripts/extension-catalog.ts", "--check"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toMatch(/checked \d+ operations from \d+ drop-ins/);
});

test("a temporary drop-in appears and disappears in every generated projection", () => {
  const fixture = mkdtempSync(join(import.meta.dir, ".extension-catalog-fixture-"));
  const source = join(fixture, "source");
  const output = join(fixture, "output");
  const root = join(import.meta.dir, "..");
  const protectedPaths = [
    "src/generated/extension-operations.ts", "src/generated/browser-extension-operations.ts",
    "src/generated/extension-operation-metadata.ts", "docs/reference/extending/api.json",
    "docs/reference/extending/api.md", "docs/reference/extending/coverage.md",
  ];
  const realOutputs = () => Object.fromEntries(protectedPaths.map((path) => [path, readFileSync(join(root, path), "utf8")]));
  const before = realOutputs();
  mkdirSync(source);
  const module = join(source, "fixture.ts");
  writeFileSync(module, `import { z } from "zod";
import { EXTENSION_HOSTS, type ExtensionOperationDescriptor } from "../../../src/extensions/contracts/operation";
import { bindExtensionOperation, type ExtensionOperationDefinition } from "../../../src/extensions/contracts/operation";
const operation: ExtensionOperationDefinition = {
  metadata: {
  id: "fixture.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Fixture", description: "Catalog test operation", input: z.strictObject({}),
  output: z.strictObject({ ok: z.boolean() }), effect: "read", sensitivity: "public",
  hosts: EXTENSION_HOSTS, policy: { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none", budget: "metadata", confirmation: "none" },
  estimateBudget: () => ({ bytes: 16, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }), project: (value) => value,
  },
  execute: async () => ({ ok: true }),
};
export const createOperations = () => [bindExtensionOperation(operation, undefined)];
export default operation;
`);
  const run = (): ReturnType<typeof Bun.spawnSync> => Bun.spawnSync([
    "bun", "run", "scripts/extension-catalog.ts", "--operations-root", source, "--output-root", output,
  ]);
  try {
    const unsafe = Bun.spawnSync(["bun", "run", "scripts/extension-catalog.ts", "--operations-root", source]);
    expect(unsafe.exitCode).toBe(2);
    expect(realOutputs()).toEqual(before);
    expect(run().exitCode).toBe(0);
    expect(readFileSync(join(output, "src/generated/extension-operations.ts"), "utf8")).toContain("source/fixture");
    expect(readFileSync(join(output, "src/generated/browser-extension-operations.ts"), "utf8")).toContain("createBrowserExtensionOperations");
    expect(readFileSync(join(output, "src/generated/browser-extension-operations.ts"), "utf8")).toContain("source/fixture");
    expect(readFileSync(join(output, "src/generated/extension-operation-metadata.ts"), "utf8")).toContain("fixture.read");
    expect(readFileSync(join(output, "docs/reference/extending/api.json"), "utf8")).toContain("fixture.read");
    expect(readFileSync(join(output, "docs/reference/extending/api.md"), "utf8")).toContain("fixture.read");
    expect(readFileSync(join(output, "docs/reference/extending/coverage.md"), "utf8")).toContain("fixture.read");
    expect(realOutputs()).toEqual(before);
    unlinkSync(module);
    expect(run().exitCode).toBe(0);
    expect(readFileSync(join(output, "docs/reference/extending/api.json"), "utf8")).not.toContain("fixture.read");
    expect(readFileSync(join(output, "src/generated/browser-extension-operations.ts"), "utf8")).not.toContain("source/fixture");
    expect(readFileSync(join(output, "docs/reference/extending/coverage.md"), "utf8")).not.toContain("fixture.read");
    expect(realOutputs()).toEqual(before);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
