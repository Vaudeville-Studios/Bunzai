/** Fixed section 6 acceptance matrix. This gate intentionally stays red until every required owner and host lands. */
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { extensionOperationMetadata } from "../src/generated/extension-operation-metadata";
import { allCapabilities } from "../src/generated/capabilities";

type Host = "desktop" | "browser" | "terminal";
type Matrix = {
  hosts: readonly Host[];
  browserFamilies: readonly string[];
  browserExcludedIds: readonly string[];
  terminalExcludedFamilies: readonly string[];
  terminalExcludedIds: readonly string[];
  terminalHostAmendments: readonly { id: string; reason: string; evidence: readonly string[] }[];
  families: readonly { name: string; ids: readonly string[] }[];
};
const matrix = JSON.parse(readFileSync(new URL("./extension-required-families.json", import.meta.url), "utf8")) as Matrix;
const expectedHosts = (family: string, id: string): Host[] => [
  "desktop",
  ...(matrix.browserFamilies.includes(family) && !matrix.browserExcludedIds.includes(id) ? ["browser" as const] : []),
  ...(!matrix.terminalExcludedFamilies.includes(family) && !matrix.terminalExcludedIds.includes(id) ? ["terminal" as const] : []),
];

test("required extension families have the exact plan hosts", () => {
  for (const amendment of matrix.terminalHostAmendments) {
    expect(amendment.reason.length).toBeGreaterThan(0);
    expect(amendment.evidence.length).toBeGreaterThan(0);
    for (const path of amendment.evidence) expect(existsSync(new URL(`../${path}`, import.meta.url))).toBe(true);
  }
  const catalog = new Map(extensionOperationMetadata.map((operation) => [operation.id, operation]));
  const ids = matrix.families.flatMap(({ ids }) => ids);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missing = matrix.families.flatMap(({ name, ids }) => ids.filter((id) => !catalog.has(id)).map((id) => `${name}:${id}`));
  const hostDifferences = matrix.families.flatMap(({ name, ids }) => ids.flatMap((id) => {
    const operation = catalog.get(id);
    if (!operation) return [];
    const expected = expectedHosts(name, id);
    return matrix.hosts.filter((host) => operation.hosts.includes(host) !== expected.includes(host))
      .map((host) => `${name}:${id}@${host}:${expected.includes(host) ? "required" : "excluded"}`);
  }));
  const missingCapabilityAdapters = allCapabilities.filter((capability) => capability.extensionExposure
    && !catalog.has(capability.extensionExposure.operationId)).map((capability) => capability.extensionExposure!.operationId);
  expect({ duplicates, missing, hostDifferences, missingCapabilityAdapters }).toEqual({
    duplicates: [], missing: [], hostDifferences: [], missingCapabilityAdapters: [],
  });
});
