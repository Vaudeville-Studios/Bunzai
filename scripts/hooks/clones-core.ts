/**
 * Near-duplicate detection (pure), the copy-paste-and-tweak check behind AGENTS.md rules 7 and 12. TS/TSX: each function
 * body of at least MIN_TOKENS is reduced to its token shape (identifiers, strings and numbers erased), fingerprinted by
 * winnowing k-grams, and two functions in different files of similar size that share >= TS_SIM of their fingerprints are
 * clones. A `clone-ok` comment inside a function body or CSS rule exempts it. CSS: each rule of at least MIN_DECLS declarations becomes a set of "property: value"; two rules in different
 * files with Jaccard >= CSS_SIM are clones. It finds copied-and-renamed code, not the same idea written differently.
 */
import ts from "typescript";

export const MIN_TOKENS = 60;
export const TS_SIM = 0.8;
export const MIN_DECLS = 4;
export const CSS_SIM = 0.7;
const K = 10;
const W = 6;

export function cloneSourcePaths(gitPaths: string, isSource: (path: string) => boolean): string[] {
  return [...new Set(gitPaths.split(/\r?\n/).filter((path) => path && isSource(path)))].sort();
}

export type FnPrint = { file: string; name: string; line: number; tokens: number; fp: number[] };
export type CssPrint = { file: string; selector: string; decls: string[] };
export type Clone = { a: string; b: string; sim: number };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shape(text: string, jsx: boolean): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  const out: string[] = [];
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (k === ts.SyntaxKind.Identifier || k === ts.SyntaxKind.PrivateIdentifier) out.push("I");
    else if (k === ts.SyntaxKind.NumericLiteral) out.push("N");
    else if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.JsxText || (k >= ts.SyntaxKind.NoSubstitutionTemplateLiteral && k <= ts.SyntaxKind.TemplateTail)) out.push("S");
    else out.push(String(k));
  }
  return out;
}

function winnow(tokens: string[]): number[] {
  const grams: number[] = [];
  for (let i = 0; i + K <= tokens.length; i++) grams.push(hash(tokens.slice(i, i + K).join(" ")));
  const fp = new Set<number>();
  for (let i = 0; i + W <= grams.length; i++) fp.add(Math.min(...grams.slice(i, i + W)));
  return [...fp];
}

/** The fingerprinted functions of one TS/TSX source (outermost functions only; nested ones are part of the body). */
export function functionsOf(file: string, source: string): FnPrint[] {
  const jsx = file.endsWith(".tsx");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: FnPrint[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      const body = node.body.getText(sf);
      const tokens = shape(body, jsx);
      if (tokens.length >= MIN_TOKENS) {
        if (body.includes("clone-ok")) return;
        const parent = node.parent;
        const name = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name ? node.name.getText(sf)
          : ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ? parent.name.getText(sf) : "(anonymous)";
        out.push({ file, name, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, tokens: tokens.length, fp: winnow(tokens) });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The declaration sets of one CSS source's rules (comments stripped; at-rule wrappers are skipped, their rules kept). */
export function cssRulesOf(file: string, source: string): CssPrint[] {
  const comment = /\/\*[\s\S]*?\*\//g;
  const out: CssPrint[] = [];
  const re = /([^{}@;]+)\{([^{}]*)\}/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[2]!.includes("clone-ok")) continue;
    const decls = [...new Set(m[2]!.replace(comment, "").split(";").map((d) => d.trim().replace(/\s+/g, " ").toLowerCase()).filter((d) => d.includes(":")))];
    if (decls.length >= MIN_DECLS) out.push({ file, selector: m[1]!.replace(comment, "").trim().replace(/\s+/g, " "), decls });
  }
  return out;
}

export const fnKey = (f: FnPrint): string => `${f.file}#${f.name}`;
export const cssKey = (r: CssPrint): string => `${r.file}#${r.selector}`;

/** Clones between `mine` and `others` (and among `mine`), never within one file. */
export function fnClones(mine: FnPrint[], others: FnPrint[]): Clone[] {
  const index = new Map<number, FnPrint[]>();
  for (const f of others) for (const h of f.fp) (index.get(h) ?? index.set(h, []).get(h)!).push(f);
  const out: Clone[] = [];
  for (const a of mine) {
    const counts = new Map<FnPrint, number>();
    for (const h of a.fp) for (const b of index.get(h) ?? []) if (b.file !== a.file) counts.set(b, (counts.get(b) ?? 0) + 1);
    for (const [b, c] of counts) {
      if (Math.min(a.tokens, b.tokens) / Math.max(a.tokens, b.tokens) < 0.6) continue;
      const sim = c / Math.min(a.fp.length, b.fp.length);
      if (sim >= TS_SIM) out.push({ a: fnKey(a), b: fnKey(b), sim });
    }
  }
  return out;
}

export function cssClones(mine: CssPrint[], others: CssPrint[]): Clone[] {
  const out: Clone[] = [];
  for (const a of mine) {
    const set = new Set(a.decls);
    for (const b of others) {
      if (b.file === a.file) continue;
      const inter = b.decls.filter((d) => set.has(d)).length;
      const sim = inter / (a.decls.length + b.decls.length - inter);
      if (sim >= CSS_SIM) out.push({ a: cssKey(a), b: cssKey(b), sim });
    }
  }
  return out;
}

/** Order-free id of a clone pair, for the baseline. */
export const pairId = (c: Clone): string => [c.a, c.b].sort().join(" | ");
