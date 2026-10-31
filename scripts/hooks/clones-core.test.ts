/**
 * The clone detector: a copied-and-renamed function and a copied CSS rule are caught across files; different code,
 * same-file copies, size-mismatched containment, and clone-ok escapes are not.
 */
import { expect, test } from "bun:test";
import { cloneSourcePaths, cssClones, cssRulesOf, fnClones, functionsOf, pairId } from "./clones-core";

test("clone source inventory includes unique tracked and untracked source paths", () => {
  expect(cloneSourcePaths("src/a.ts\nsrc/new.ts\nsrc/a.ts\nsrc/a.test.ts\n", (path) => path.endsWith(".ts") && !path.endsWith(".test.ts")))
    .toEqual(["src/a.ts", "src/new.ts"]);
});

const body = (v: string, f: string): string => `
export function ${f}(items: { at: number; label: string }[], now: number): string[] {
  const out: string[] = [];
  for (const ${v} of items) {
    const minutes = Math.floor((now - ${v}.at) / 60000);
    if (minutes < 1) out.push(${v}.label + " just now");
    else if (minutes < 60) out.push(${v}.label + " " + minutes + " minutes ago");
    else if (minutes < 1440) out.push(${v}.label + " " + Math.floor(minutes / 60) + " hours ago");
    else out.push(${v}.label + " " + Math.floor(minutes / 1440) + " days ago");
  }
  return out;
}`;

test("a renamed copy in another file is a clone; the same code in one file is not", () => {
  const a = functionsOf("src/a.ts", body("item", "agoLabels"));
  const b = functionsOf("src/b.ts", body("entry", "formatAgo"));
  expect(a.length).toBe(1);
  const pairs = fnClones(a, [...a, ...b]);
  expect(pairs.map(pairId)).toEqual(["src/a.ts#agoLabels | src/b.ts#formatAgo"]);
  expect(fnClones(a, a)).toEqual([]);
});

test("different code is not a clone, and short functions are ignored", () => {
  const other = functionsOf("src/c.ts", `export function sum(xs: number[]): number { let t = 0; for (const x of xs) t += x; return t; }`);
  expect(other).toEqual([]);
  const a = functionsOf("src/a.ts", body("item", "agoLabels"));
  const d = functionsOf("src/d.ts", `
export function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\\n")) {
    const at = line.indexOf("=");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!key || key.startsWith("#")) continue;
    out[key] = value.replace(/^"|"$/g, "");
  }
  return out;
}`);
  expect(fnClones(a, d)).toEqual([]);
});

test("a clone-ok comment exempts a function", () => {
  const b = functionsOf("src/b.ts", body("entry", "formatAgo").replace("const out", "// clone-ok: test fixture\n  const out"));
  expect(b).toEqual([]);
});

test("a copied CSS rule in another file is a clone; a small or different rule is not", () => {
  const rule = ".x { display: flex; gap: 8px; padding: 4px 8px; font: 600 12px var(--font-body); color: var(--text); }";
  const a = cssRulesOf("src/a.css", rule);
  const b = cssRulesOf("src/b.css", rule.replace(".x", ".eyebrow"));
  const c = cssRulesOf("src/c.css", ".y { display: grid; margin: 0; border: 0; background: none; }");
  expect(cssClones(a, [...b, ...c]).map(pairId)).toEqual(["src/a.css#.x | src/b.css#.eyebrow"]);
  expect(cssRulesOf("src/d.css", ".s { color: red; }")).toEqual([]);
  expect(cssRulesOf("src/e.css", rule.replace("color:", "/* clone-ok: twin */ color:"))).toEqual([]);
});
