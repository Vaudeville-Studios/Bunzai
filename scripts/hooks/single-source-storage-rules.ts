/** Storage-specific single-source guards for app-data writes. */
import { norm, stripComments } from "./lib";
import { writeCapableFsOpens } from "./single-source-syntax";
import {
  reviewedHandleSinkProtocol,
  reviewedIdentityQuarantine,
  reviewedTemporaryWriteProtocol,
  reviewedTerminalFileActionProtocol,
} from "./single-source-storage-protocol";

const BANNED_FS_WRITES: ReadonlySet<string> = new Set([
  "rename", "renameSync", "writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream",
]);
const FLAG_GATED_FS_OPENS: ReadonlySet<string> = new Set(["open", "openSync"]);
const FS_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\s*["'](node:fs(?:\/promises)?)["']/g;
const FS_NAMESPACE_IMPORT = /\bimport\s+(?:\*\s+as\s+([\w$]+)|([\w$]+))\s+from\s*["'](node:fs(?:\/promises)?)["']/g;
const DYNAMIC_FS_IMPORT = /\b(?:const|let)\s+([\w$]+)\s*=\s*await\s+import\s*\(\s*["'](node:fs(?:\/promises)?)["']\s*\)/g;
const DYNAMIC_FS_DESTRUCTURE = /\b(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+import\s*\(\s*["']node:fs(?:\/promises)?["']\s*\)/g;

function namespaceWriteCalls(source: string, namespace: string): string[] {
  const names = [...BANNED_FS_WRITES].join("|");
  const calls = new RegExp(`\\b${namespace}\\s*(?:\\.promises)?\\s*\\.\\s*(${names})\\s*\\(`, "g");
  return [...source.matchAll(calls)].map((match) => match[1]!);
}

function bannedFsWriteImports(path: string, source: string): string[] {
  const clean = stripComments(source);
  const hits: string[] = [];
  const openLocals = new Map<string, string>();
  const namespaces: string[] = [];
  const named = (list: string, separator: RegExp): void => {
    for (const raw of list.split(",")) {
      const [name = "", local = name] = raw.trim().replace(/^type\s+/, "").split(separator).map((part) => part.trim());
      if (BANNED_FS_WRITES.has(name)) hits.push(name);
      if (FLAG_GATED_FS_OPENS.has(name)) openLocals.set(local, name);
    }
  };
  for (const match of clean.matchAll(FS_IMPORT)) named(match[1]!, /\s+as\s+/);
  for (const match of clean.matchAll(DYNAMIC_FS_DESTRUCTURE)) named(match[1]!, /\s*:\s*/);
  for (const match of clean.matchAll(FS_NAMESPACE_IMPORT)) {
    const namespace = match[1] ?? match[2];
    if (namespace) { hits.push(...namespaceWriteCalls(clean, namespace)); namespaces.push(namespace); }
  }
  for (const match of clean.matchAll(DYNAMIC_FS_IMPORT)) {
    hits.push(...namespaceWriteCalls(clean, match[1]!));
    namespaces.push(match[1]!);
  }
  if (openLocals.size > 0 || namespaces.length > 0) hits.push(...writeCapableFsOpens(path, source, openLocals, namespaces));
  return hits;
}

/** Keep file-specific exceptions tied to the reviewed protocol in the source file. */
function hasSingleUnaliasedWriteFileBinding(source: string): boolean {
  const clean = stripComments(source);
  let bindings = 0;
  for (const match of clean.matchAll(FS_IMPORT)) {
    for (const specifier of match[1]!.split(",").map((part) => part.trim())) {
      if (specifier.split(/\s+as\s+/)[0] !== "writeFile") continue;
      if (specifier !== "writeFile" || match[2] !== "node:fs/promises") return false;
      bindings += 1;
    }
  }
  return bindings === 1
    && [...clean.matchAll(FS_NAMESPACE_IMPORT)].length === 0
    && [...clean.matchAll(DYNAMIC_FS_IMPORT)].length === 0;
}

/** Bare app-data writes must use atomic-file.ts or a specifically reviewed protocol. */
export function appDataWriteOutsideHome(
  path: string,
  source: string,
  allowlist: ReadonlySet<string> = new Set(),
): string | null {
  const p = norm(path);
  if (!p.startsWith("src/") || p === "src/studio/atomic-file.ts") return null;
  const hits = bannedFsWriteImports(p, source);
  if (hits.length === 0 || allowlist.has(p)) return null;
  if (hits.length === 1 && hits[0] === "rename" && reviewedIdentityQuarantine(p, source)) return null;
  if (hits.every((name) => name === "writeFile") && hasSingleUnaliasedWriteFileBinding(source)
    && reviewedTemporaryWriteProtocol(p, source)) return null;
  if (hits.every((name) => name === "open") && reviewedHandleSinkProtocol(p, source)) return null;
  if (hits.every((name) => name === "open") && reviewedTerminalFileActionProtocol(p, source)) return null;
  return `${p}: imports or calls ${hits.join(", ")} from node:fs or node:fs/promises (open counts when its flags can write). Use writeAtomicReplace (src/studio/atomic-file.ts) for app data, or retain a specifically reviewed storage protocol.`;
}
