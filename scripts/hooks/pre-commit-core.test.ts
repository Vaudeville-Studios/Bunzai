/** Regression coverage for staged pre-commit parsing and routing decisions. */
import { expect, test } from "bun:test";
import {
  needsCodeMap,
  needsDocsIndex,
  parseNameStatusZ,
  type StagedPath,
} from "./pre-commit-core";

const staged = (status: string, path: string): StagedPath => ({ status, path });

test("parseNameStatusZ reads ordinary paths and keeps rename destinations", () => {
  expect(parseNameStatusZ("M\0src/a.ts\0R091\0src/old.tsx\0src/new.tsx\0D\0src/gone.ts\0")).toEqual([
    staged("M", "src/a.ts"),
    { status: "R091", path: "src/new.tsx", previousPath: "src/old.tsx" },
    staged("D", "src/gone.ts"),
  ]);
});

test("needsDocsIndex matches the generator corpus: docs/**.md except generated/ and media/", () => {
  expect(needsDocsIndex([staged("M", "docs/guide/converting.md")])).toBe(true);
  expect(needsDocsIndex([staged("A", "docs/reference/ui.md")])).toBe(true);
  expect(needsDocsIndex([staged("D", "docs/LOCAL-NOTES.md")])).toBe(true);
  // FORMAT-SUPPORT.md is directly under docs/ and IS in the corpus; editing it must regen
  expect(needsDocsIndex([staged("M", "docs/FORMAT-SUPPORT.md")])).toBe(true);
  // a doc moved out of docs/ (rename destination outside, previous inside) still changes the index
  expect(needsDocsIndex([
    { status: "R100", path: "local-notes/LOCAL-NOTES.md", previousPath: "docs/LOCAL-NOTES.md" },
  ])).toBe(true);
  // the generator's own outputs and skipped dirs never trigger (no regen loop)
  expect(needsDocsIndex([staged("M", "docs/generated/docs-index.json")])).toBe(false);
  expect(needsDocsIndex([staged("M", "docs/media/notes.md")])).toBe(false);
  expect(needsDocsIndex([staged("M", "src/ui/receipt.ts")])).toBe(false);
});

test("needsCodeMap fires for mapped source, the map, and its generator, never for tests or docs", () => {
  expect(needsCodeMap([staged("M", "src/stage/crypto/keyring.ts")])).toBe(true);
  expect(needsCodeMap([staged("A", "scripts/perf-gate.ts")])).toBe(true);
  expect(needsCodeMap([staged("D", "src/ui/old.tsx")])).toBe(true);
  expect(needsCodeMap([{ status: "R100", path: "notes/x.ts", previousPath: "src/core/x.ts" }])).toBe(true);
  expect(needsCodeMap([staged("M", "docs/generated/CODE-MAP.md")])).toBe(true);
  expect(needsCodeMap([staged("M", "scripts/code-map-core.ts")])).toBe(true);
  expect(needsCodeMap([staged("M", "src/stage/crypto/keyring.test.ts")])).toBe(false);
  expect(needsCodeMap([staged("M", "docs/reference/ui.md")])).toBe(false);
  expect(needsCodeMap([staged("M", "src/generated/formats.ts")])).toBe(false);
});
