/** Exact retained temporary ciphertext, scratch, and artifact write protocols for the storage guard. */
import { stripComments } from "./lib";
import { callsNamed } from "./single-source-syntax";

/** Exact scratch/staging write callsites use newly-created private roots or publish a verified
 *  manual-update artifact. Their protocol is local to one callsite; a second writer invalidates the
 *  exception instead of exempting the rest of the file. */
export function reviewedTemporaryWriteProtocol(path: string, source: string): boolean {
  const clean = stripComments(source);
  const protocols: Readonly<Record<string, { root: RegExp; write: RegExp; calls: number; boundary: RegExp }>> = {
    "src/core/preset/render/scratch.ts": {
      root: /mkdtemp\s*\(\s*join\s*\(\s*tmpdir\s*\(\s*\)\s*,\s*["']bunzai-macro-lab-["']\s*\)\s*\)/,
      write: /await\s+writeFile\s*\(\s*preset\s*,\s*scratchWireFile\s*\(/,
      calls: 1,
      boundary: /const\s+preset\s*=\s*join\s*\(\s*dir\s*,\s*`scratch\.\$\{req\.engine\}\.json`\s*\)/,
    },
    "src/ui/server-staging.ts": {
      root: /mkdtemp\s*\(\s*join\s*\(\s*tmpdir\s*\(\s*\)\s*,\s*["']bunzai-import-staged-["']\s*\)\s*\)/,
      write: /await\s+writeFile\s*\(\s*path\s*,\s*sealed\s*,\s*\{\s*mode\s*:\s*0o600\s*\}\s*\)/,
      calls: 1,
      boundary: /const\s+sealed\s*=\s*JSON\.stringify\s*\(\s*aesSeal\s*\(\s*STAGING_KEY\s*,\s*text\s*,\s*`\$\{token\}:\$\{key\}`\s*\)\s*\)[\s\S]*?const\s+path\s*=\s*join\s*\(\s*dir\s*,\s*`\$\{key\}\.sealed`\s*\)/,
    },
    "src/kit/tools/preset-verify-export.ts": {
      root: /mkdtemp\s*\(\s*join\s*\(\s*tmpdir\s*\(\s*\)\s*,\s*["']hoplight-verify-["']\s*\)\s*\)/,
      write: /await\s+writeFile\s*\(\s*path\s*,\s*text\s*,\s*["']utf8["']\s*\)/,
      calls: 1,
      boundary: /const\s+path\s*=\s*join\s*\(\s*dir\s*,\s*["']preset\.json["']\s*\)/,
    },
    "src/formats/_fixtures/lumiverse-archive/materialize.ts": {
      root: /mkdtemp\s*\(\s*join\s*\(\s*tmpdir\s*\(\s*\)\s*,\s*["']bunzai-lvbak-["']\s*\)\s*\)/,
      write: /await\s+writeFile\s*\(\s*target\s*,\s*data\s*\)/,
      calls: 1,
      boundary: /if\s*\(\s*unsafeName\s*\(\s*name\s*\)\s*\)\s*throw[\s\S]*?const\s+target\s*=\s*join\s*\(\s*root\s*,\s*name\s*\)/,
    },
    "src/kit/providers/claude-cli.ts": {
      root: /mkdtemp\s*\(\s*join\s*\(\s*tmpdir\s*\(\s*\)\s*,\s*["']bunzai-mcp-["']\s*\)\s*\)/,
      write: /await\s+writeFile\s*\(\s*path\s*,\s*JSON\.stringify\s*\(\s*\{\s*mcpServers\s*:[\s\S]*?mode\s*:\s*0o600\s*,\s*flag\s*:\s*["']wx["']/,
      calls: 1,
      boundary: /const\s+path\s*=\s*join\s*\(\s*dir\s*,\s*["']config\.json["']\s*\)/,
    },
    "src/ui/switch/packaged-engine.ts": {
      root: /join\s*\(\s*exeDir\s*,\s*["']\.bunzai-update["']\s*\)/,
      write: /await\s+writeFile\s*\(\s*staged\s*,\s*bytes\s*\)/,
      calls: 1,
      boundary: /if\s*\(\s*!expected\s*\|\|\s*got\s*!==?\s*expected\s*\)[\s\S]*?const\s+staged\s*=\s*join\s*\(\s*stageDir\s*,\s*assetName\s*\)/,
    },
  };
  const protocol = protocols[path];
  if (!protocol) return false;
  const root = protocol.root.exec(clean);
  const boundary = protocol.boundary.exec(clean);
  const write = protocol.write.exec(clean);
  if (!root || !boundary || !write || root.index > boundary.index || boundary.index > write.index) return false;
  return callsNamed(path, source, "writeFile") === protocol.calls;
}

/**
 * The shared upload/export sinks retain exact write sites, owner-only defaults, complete writes,
 * sync-before-close and exclusive-file cleanup. Callers own private staging roots or the selected
 * export run; the syntax test pins those callers separately. Four writes carry sealed bytes and
 * the plain sink carries a bounded upload or an explicitly requested export.
 */
export function reviewedHandleSinkProtocol(path: string, source: string): boolean {
  if (path !== "src/ui/server-body.ts") return false;
  const clean = stripComments(source);
  const count = (re: RegExp): number => [...clean.matchAll(re)].length;
  const once = (re: RegExp): boolean => count(re) === 1;
  if (!/^import \{ open, unlink, type FileHandle \} from "node:fs\/promises";$/m.test(clean)) return false;
  if (count(/\bfrom\s*["']node:fs/g) !== 1 || /\bimport\s*\(|\brequire\s*\(/.test(clean)) return false;
  if (callsNamed(path, source, "open") !== 2
    || !once(/const handle = await open\(path, flags, mode\);/g)
    || !once(/const handle: FileHandle = await open\(path, "w", mode\);/g)) return false;
  if (!once(/fileSink\(path: string, mode = 0o600, flags: "w" \| "wx" = "w"\)/g)
    || !once(/sealedFileSink\(path: string, key: Buffer, mode = 0o600\)/g)) return false;
  for (const name of ["writeFileSync", "appendFile", "createWriteStream", "openSync", "writeSync"]) {
    if (callsNamed(path, source, name) !== 0) return false;
  }
  if (callsNamed(path, source, "writeFile") !== 5 || callsNamed(path, source, "write") !== 1 || !once(/inner\.write\(chunk\)/g)) return false;
  if (!once(/\bhandle\.writeFile\(chunk\)/g) || !once(/\bhandle\.writeFile\(iv\)/g) || !once(/\bhandle\.writeFile\(cipher\.update\(chunk\)\)/g)
    || !once(/\bhandle\.writeFile\(cipher\.final\(\)\)/g) || !once(/\bhandle\.writeFile\(cipher\.getAuthTag\(\)\)/g)) return false;
  if (callsNamed(path, source, "sync") !== 2 || count(/handle\.close\(/g) !== 5) return false;
  if (!once(/finish: async \(\) => \{ try \{ await handle\.sync\(\); \} finally \{ await handle\.close\(\); \} \}/g)) return false;
  if (callsNamed(path, source, "unlink") !== 1 || !once(/await handle\.close\(\)\.catch\(\(\) => undefined\);\s*if \(flags === "wx"\) await unlink\(path\)\.catch\(\(\) => undefined\);/g)) return false;
  // The sealing boundary: a 12-byte random iv and the AES-256-GCM cipher precede every sealed write.
  const sealing = /const\s+iv\s*=\s*randomBytes\(12\);\s*const\s+cipher\s*=\s*createCipheriv\("aes-256-gcm",\s*key,\s*iv\);\s*await\s+handle\.writeFile\(iv\);/.exec(clean);
  if (!sealing) return false;
  const afterSealing = clean.slice(sealing.index);
  return /handle\.writeFile\(cipher\.update\(chunk\)\)/.test(afterSealing)
    && /await handle\.writeFile\(cipher\.final\(\)\);\s*await handle\.writeFile\(cipher\.getAuthTag\(\)\);\s*await handle\.sync\(\);\s*\} finally \{ await handle\.close\(\); \}/.test(afterSealing);
}

/** Terminal's user-selected path is a separate bounded native-file protocol, not app-data publication. */
export function reviewedTerminalFileActionProtocol(path: string, source: string): boolean {
  if (path !== "src/kit/extensions/file-actions.ts") return false;
  const clean = stripComments(source);
  if (!/^import \{ open, realpath, stat, type FileHandle \} from "node:fs\/promises";$/m.test(clean)
    || [...clean.matchAll(/\bfrom\s*["']node:fs/g)].length !== 1
    || /\bimport\s*\(|\brequire\s*\(/.test(clean)) return false;
  if (![...clean.matchAll(/\bopen\(/g)].length || [...clean.matchAll(/\bopen\(/g)].length !== 3) return false;
  for (const flags of ['"r"', '"wx+"', '"r+"']) if (!new RegExp(`\\bopen\\((?:canonical|handle\\.path), ${flags.replace(/[+]/g, "\\+")}\\)`).test(clean)) return false;
  if (!/info\.size > MAX_SELECTED_FILE_BYTES/.test(clean) || !/new Uint8Array\(size \+ 1\)/.test(clean)
    || !/await file\.read\(/.test(clean) || !/offset !== size/.test(clean)) return false;
  if (!/result\.bytesWritten <= 0/.test(clean) || !/offset \+= result\.bytesWritten/.test(clean)
    || !/await file\.truncate\(0\)/.test(clean) || !/await file\.truncate\(bytes\.byteLength\)/.test(clean)
    || !/await file\.sync\(\)/.test(clean)) return false;
  if (!/await realpath\(target\)/.test(clean) || !/sameIdentity\(handle\.identity, current\)/.test(clean)
    || !/beginWriteThroughService\(id\)/.test(clean) || !/writeEffectStarted = true/.test(clean)
    || !/status: "ambiguous"/.test(clean)) return false;
  return true;
}

/** Identity repair moves one damaged file aside; all key publication remains in the atomic owner. */
export function reviewedIdentityQuarantine(path: string, source: string): boolean {
  if (path !== "src/kit/keystore/backends/identity-file.ts") return false;
  const clean = stripComments(source);
  if (!/import\s*\{\s*readFile,\s*rename,\s*stat\s*\}\s*from\s*["']node:fs\/promises["']/.test(clean)) return false;
  if (!/import\s*\{\s*writeIdentityFile\s*\}\s*from\s*["']\.\/identity-write["']/.test(clean)) return false;
  if (/\b(?:rename\s+as|\*\s+as|await\s+import\s*\()/.test(clean)) return false;
  return callsNamed(path, source, "rename") === 1
    && /async function setAside\(path: string\): Promise<string>\s*\{\s*const stamp = new Date\(\)\.toISOString\(\)\.replace\(/.test(clean)
    && /const target = `\$\{path\}\.damaged-\$\{stamp\}-\$\{randomBytes\(3\)\.toString\(["']hex["']\)\}`;\s*await rename\(path, target\);\s*return target;/.test(clean)
    && /await writeIdentityFile\(path, encodeIdentity\(key\)\)/.test(clean);
}
