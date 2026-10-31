/** Preserve the rule that codecs, transfer adapters, saves and runtime package inspection keep macro text inert. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const inertBoundaries = ["src/formats", "src/extensions/operations/transfers", "src/extensions/runtime", "src/stage"];
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("import, codec, save and package runtime boundaries never invoke the macro evaluator", () => {
  const violations = inertBoundaries.flatMap((directory) => sourceFiles(join(import.meta.dir, "..", directory)))
    .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
    .filter((path) => /\bprocessMacros\s*\(/.test(readFileSync(path, "utf8")));
  expect(violations).toEqual([]);
});
