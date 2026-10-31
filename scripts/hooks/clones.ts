/**
 * Clone guard - no new copy-paste-and-tweak code or CSS. The imperative shell around clones-core.ts.
 *
 *   --staged   : pre-commit. Compares the staged TS/TSX/CSS files against the whole tree and blocks any clone pair
 *                that is not in scripts/hooks/clones-baseline.json (a ratchet: known copies never block new work).
 *   --scan     : every clone pair in the tree, newest-known first (exit 0).
 *   --baseline : rewrite the baseline to the tree's current pairs (run after a merge so fixed copies drop out).
 *
 * Escape: a `clone-ok: <reason>` comment inside the function or rule.
 * Fingerprints are cached by file size and mtime in node_modules/.cache/bunzai-clones.json.
 * Run: bun run scripts/hooks/clones.ts --scan|--staged|--baseline
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cloneSourcePaths, cssClones, cssRulesOf, fnClones, functionsOf, pairId, type Clone, type CssPrint, type FnPrint } from "./clones-core";

const BASELINE = "scripts/hooks/clones-baseline.json";
const CACHE = "node_modules/.cache/bunzai-clones.json";
const mode = process.argv.includes("--scan") ? "scan" : process.argv.includes("--baseline") ? "baseline" : "staged";

const isCode = (f: string): boolean => /^src\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$|\/fake-|\.d\.ts$|generated/.test(f);
const isCss = (f: string): boolean => /^src\/.*\.css$/.test(f) && !/tokens\.css$/.test(f);

type Entry = { stamp: string; fns?: FnPrint[]; css?: CssPrint[] };
const cache: Record<string, Entry> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
function prints(file: string): Entry {
  const st = statSync(file);
  const stamp = `${st.size}:${st.mtimeMs}`;
  const hit = cache[file];
  if (hit?.stamp === stamp) return hit;
  const source = readFileSync(file, "utf8");
  const entry: Entry = isCss(file) ? { stamp, css: cssRulesOf(file, source) } : { stamp, fns: functionsOf(file, source) };
  cache[file] = entry;
  return entry;
}

const tracked = cloneSourcePaths(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 1 << 28 }), (f) => (isCode(f) || isCss(f)) && existsSync(f));
const allFns = tracked.filter(isCode).flatMap((f) => prints(f).fns ?? []);
const allCss = tracked.filter(isCss).flatMap((f) => prints(f).css ?? []);
mkdirSync("node_modules/.cache", { recursive: true });
writeFileSync(CACHE, JSON.stringify(cache));

const baseline = new Set<string>(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : []);
const uniq = (pairs: Clone[]): Clone[] => [...new Map(pairs.map((p) => [pairId(p), p])).values()];

if (mode !== "staged") {
  const pairs = uniq([...fnClones(allFns, allFns), ...cssClones(allCss, allCss)]);
  if (mode === "baseline") {
    writeFileSync(BASELINE, JSON.stringify(pairs.map(pairId).sort(), null, 1) + "\n");
    console.log(`clones: baseline written, ${pairs.length} known pairs.`);
  } else {
    const fresh = pairs.filter((p) => !baseline.has(pairId(p)));
    console.log(`clones: ${pairs.length} pairs in the tree, ${fresh.length} not in the baseline.`);
    for (const p of fresh.slice(0, 200)) console.log(`  ${(p.sim * 100).toFixed(0)}%  ${p.a}  ~  ${p.b}`);
  }
  process.exit(0);
}

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { encoding: "utf8" }).split("\n").filter((f) => (isCode(f) || isCss(f)) && existsSync(f));
const mineFns = staged.filter(isCode).flatMap((f) => prints(f).fns ?? []);
const mineCss = staged.filter(isCss).flatMap((f) => prints(f).css ?? []);
const fresh = uniq([...fnClones(mineFns, allFns), ...cssClones(mineCss, allCss)]).filter((p) => !baseline.has(pairId(p)));
if (fresh.length === 0) { console.log("clones: clean (staged)."); process.exit(0); }
console.error(`\nclones: ${fresh.length} new near-duplicate(s). Call or extend the existing one instead of copying it (AGENTS.md rules 7 and 12), or add "clone-ok: <reason>".`);
for (const p of fresh.slice(0, 40)) console.error(`  ${(p.sim * 100).toFixed(0)}%  ${p.a}  ~  ${p.b}`);
process.exit(2);
