/**
 * Runs the D18 boundary lint over every authored TypeScript file under src/ and scripts/. The rules live in
 * stage-boundary-core.ts; this shell only gathers files and reports.
 *
 * COMPOSITION_ROOTS is the one place a file is allowed to import a store backend directly, so the
 * app can be wired together; the first is the library root.
 * Adding a path here is the reviewed act of connecting a backend, and should land in the same
 * change that needs it.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { stageBoundaryViolations } from "./stage-boundary-core";
import { SKIP_DIRS, SOURCE_EXTS, walk } from "./walk";

const COMPOSITION_ROOTS: readonly string[] = [
  // The app wires the encrypted library in here, and only here.
  "src/ui/library-root.ts",
  // The open helper constructs all native stores over the database from library-root.
  "src/ui/library-open.ts",
  // Builds the snapshot store over that same library: the one other file that names a backend.
  "src/ui/library-snapshots.ts",
  // The static browser Studio wires its memory stores in here: it has no library, only this page.
  "src/pocket/runtime.ts",
  // Theme lifecycle tests compose the in-memory extension store with the service fixture.
  "src/extensions/theme-test-fixture.ts",
];

const sourceFiles = (root: string): string[] => walk(root, (_path, name) => SOURCE_EXTS.has(extname(name)), SKIP_DIRS);

const check = (path: string): string[] => stageBoundaryViolations(path, readFileSync(path, "utf8"), COMPOSITION_ROOTS);
// Scripts are held only to rule 4: they wire things together on purpose, but never from a port copy.
const scripts = sourceFiles("scripts");
const sources = sourceFiles("src");
const files = [...sources, ...scripts];
const hits = [...sources.flatMap(check), ...scripts.flatMap((path) => check(path).filter((hit) => hit.endsWith("(rule 4)")))];

if (hits.length > 0) {
  console.error(`stage-boundary: ${hits.length} violation(s):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(2); // policy violation, per the exit contract in scripts/hooks/README.md
}
console.log(`stage-boundary: clean (${files.length} files checked).`);
