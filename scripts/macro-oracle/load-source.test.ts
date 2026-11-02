/** Macro-oracle source loader resolves a root-relative module through the current platform's file URL. */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceModule } from "./load-source";

test("loads a source module from the native temporary root path", async () => {
  const root = mkdtempSync(join(tmpdir(), "macro-oracle-source-"));
  try {
    writeFileSync(join(root, "entry.mjs"), "export const value = 42;\n");
    expect(await loadSourceModule<{ value: number }>(root, "entry.mjs")).toEqual({ value: 42 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
