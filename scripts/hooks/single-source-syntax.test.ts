/** Regression cases separating real shared implementations from imports, data, and owner adapters. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compiledBuildOutsideHome, isLuaResourceLimitErrorOutsideHome,
  openInBrowserOutsideHome, providerFetchHarnessCopyOutsideHome, readJsonCappedOutsideHome,
  sharedHomeDeclarationOutsideHome, testCipherOutsideHome, transportHelperOutsideHome,
} from "./single-source-core";
import { appDataWriteOutsideHome } from "./single-source-storage-rules";
import { walk } from "./walk";
import { callsNamed, functionBody } from "./single-source-syntax";

test("syntax: imports and fixture text are not declarations", () => {
  for (const source of [
    'import { type WireRequest } from "./provider";',
    'import type { WireRequest } from "./provider";',
    'export { deepEq } from "./guards";',
    'const fixture = "const testCipher = () => {}; function controlledStream() {}";',
    'const fixture = `export function deepEq() {}`;',
    'const pattern = /function deepEq/;',
  ]) {
    expect(sharedHomeDeclarationOutsideHome("src/other.ts", source)).toBeNull();
    expect(testCipherOutsideHome("scripts/hooks/example.test.ts", source)).toBeNull();
    expect(providerFetchHarnessCopyOutsideHome("scripts/hooks/example.test.ts", source)).toBeNull();
  }
  expect(sharedHomeDeclarationOutsideHome("src/other.ts", "interface WireRequest {}" )).toContain("shared home");
  expect(sharedHomeDeclarationOutsideHome("src/other.ts", "const deepEq = () => true;" )).toContain("shared home");
  expect(sharedHomeDeclarationOutsideHome("src/other.ts", "class C { private deepEq() {} }" )).toContain("shared home");
  expect(sharedHomeDeclarationOutsideHome("src/other.test.ts", "function deepEq() {}" )).toContain("shared home");
});

test("syntax: calls exclude messages and regexes but include template interpolation", () => {
  const cases = [
    [readJsonCappedOutsideHome, "readJsonCapped"],
    [isLuaResourceLimitErrorOutsideHome, "isLuaResourceLimitError"],
    [compiledBuildOutsideHome, "compiledBuild"],
  ] as const;
  for (const [detector, name] of cases) {
    expect(detector("scripts/hooks/example.ts", `const message = "${name}("; const regex = /${name}\\s*\\(/;`)).toBeNull();
    expect(detector("src/other.ts", `const data = \`${name}()\`;`)).toBeNull();
    expect(detector("src/other.ts", `const data = \`result: \$\{${name}()\}\`;`)).not.toBeNull();
    expect(detector("src/other.ts", `${name}();`)).not.toBeNull();
    expect(detector("src/other.ts", `helpers.${name}();`)).not.toBeNull();
    expect(detector("src/other.ts", `helpers["${name}"]();`)).not.toBeNull();
    expect(detector("src/other.ts", `function ${name}() { return true; }`)).not.toBeNull();
    expect(detector("src/other.ts", `// ${name}()`)).toBeNull();
  }
  expect(openInBrowserOutsideHome("src/other.ts", 'const data = "function openInBrowser() {}";')).toBeNull();
  expect(transportHelperOutsideHome("src/other.ts", 'const data = `const createLineSplitter = () => {};`;')).toBeNull();
});

test("syntax: local tick values and rendering callbacks do not duplicate the timer helper", () => {
  for (const source of [
    "const tick = useTick(220);", "let tick = 0;", "const tick = () => setImportState(next);",
  ]) expect(sharedHomeDeclarationOutsideHome("src/other.ts", source)).toBeNull();
  expect(sharedHomeDeclarationOutsideHome("src/other.ts", "const tick = () => new Promise((resolve) => setTimeout(resolve, 0));")).toContain("shared home");
});

test("syntax: bespoke fetch callbacks are distinct from the recording harness factory", () => {
  for (const source of [
    "const fakeFetch = async (input) => { reached.push(String(input)); return new Response(null, { status: 302 }); };",
    "const fakeFetch = async () => Response.json({ data: [] });",
  ]) {
    expect(sharedHomeDeclarationOutsideHome("src/other.test.ts", source)).toBeNull();
    expect(providerFetchHarnessCopyOutsideHome("src/other.test.ts", source)).toBeNull();
  }
  const copy = readFileSync("src/stage/provider/test-fetch-harness.ts", "utf8");
  expect(providerFetchHarnessCopyOutsideHome("src/other.test.ts", copy)).toContain("fakeFetch");
  expect(sharedHomeDeclarationOutsideHome("src/other.ts", copy)).toContain("shared home");
});

test("syntax: branch adapters delegate to the imported canonical version guard", () => {
  const base = 'import { requireVersion as checkVersion } from "../chat-rules";';
  const direct = "const requireVersion = (branch, expected) => { checkVersion(branch.version, expected); };";
  const lookup = "const requireVersion = (branchId, expected) => { const branch = branches.get(branchId)!; checkVersion(branch.version, expected); };";
  for (const adapter of [direct, lookup]) expect(sharedHomeDeclarationOutsideHome("src/stage/store/memory/chat-store.ts", base + adapter)).toBeNull();
  for (const wrong of [
    direct, base + direct.replace("branch.version", "branch.other"),
    base + direct.replace("checkVersion(branch.version, expected);", "if (expected) checkVersion(branch.version, expected);"),
    base + direct.replace("checkVersion(branch.version, expected);", 'if (branch.version !== expected) throw new Error("stale");'),
    base + direct.replace("checkVersion(branch.version, expected);", "checkVersion(branch.version, expected); changed();"),
    base.replace("../chat-rules", "../other") + direct,
  ]) expect(sharedHomeDeclarationOutsideHome("src/stage/store/memory/chat-store.ts", wrong)).toContain("shared home");
});

test("syntax: updated private ciphertext staging retains only its exact write protocol", () => {
  for (const path of ["src/ui/server-staging.ts", "src/ui/server-body.ts", "src/kit/keystore/backends/identity-file.ts"]) {
    const source = readFileSync(path, "utf8");
    expect(appDataWriteOutsideHome(path, source)).toBeNull();
    const extra = path.includes("identity-file") ? "await rename(path, published);" : "await writeFile(appData, plaintext);";
    expect(appDataWriteOutsideHome(path, source + extra)).toContain("writeAtomicReplace");
    if (path.includes("identity-file")) {
      expect(appDataWriteOutsideHome(path, source.replace(".damaged-", ".published-"))).toContain("writeAtomicReplace");
    } else if (path.endsWith("server-staging.ts")) {
      expect(appDataWriteOutsideHome(path, source.replace("writeFile(path, sealed", "writeFile(path, text"))).toContain("writeAtomicReplace");
      expect(appDataWriteOutsideHome(path, source.replace("aesSeal(STAGING_KEY", "unsealed(STAGING_KEY"))).toContain("writeAtomicReplace");
      expect(appDataWriteOutsideHome(path, source.replace("bunzai-import-staged-", "persistent-"))).toContain("writeAtomicReplace");
    } else {
      const refused = (changed: string): void => {
        expect(changed).not.toBe(source);
        expect(appDataWriteOutsideHome(path, changed)).toContain("writeAtomicReplace");
      };
      // A plaintext write where the sealed one was, a second handle write, and every other way in.
      refused(source.replace("handle.writeFile(cipher.update(chunk))", "handle.writeFile(chunk)"));
      refused(source.replace("handle.writeFile(cipher.getAuthTag())", "handle.writeFile(plaintext)"));
      refused(source + "\nasync function leak(handle: FileHandle, text: Uint8Array) { await handle.write(text); }");
      refused(source.replace('"aes-256-gcm"', '"aes-128-cbc"'));
      refused(source.replace("randomBytes(12)", "randomBytes(8)"));
      refused(source.replace("mode = 0o600", "mode = 0o644"));
      refused(source.replace('open(path, "w", mode)', 'open(path, "a", mode)'));
      refused(source.replace('import { open, unlink, type FileHandle }', 'import { open as openFile, unlink, type FileHandle }').replaceAll("await open(", "await openFile("));
      refused(source.replace('if (flags === "wx") ', ""));
      refused(source.replace('flags === "wx"', 'flags === "w"'));
      refused(source.replace("await unlink(path).catch(() => undefined);", ""));
      refused(source.replace("handle.writeFile(chunk)", "handle.write(chunk)"));
      refused(source.replace("await handle.sync();", ""));
      refused('import { open as raw } from "node:fs/promises";\n' + source + '\nawait raw(appData, "w");');
      refused('import * as fs from "node:fs/promises";\n' + source + '\nawait fs.open(appData, "w");');
      refused(source + '\nconst fs = await import("node:fs");\nfs.promises.open(appData, "r+");');
      refused(source + '\nconst { open: reopen } = await import("node:fs/promises");\nawait reopen(appData, "wx");');
      refused('import { createWriteStream } from "node:fs";\n' + source + '\ncreateWriteStream(appData);');
      refused('import { appendFile } from "node:fs/promises";\n' + source + '\nawait appendFile(appData, text);');
      refused('import { openSync } from "node:fs";\n' + source + '\nopenSync(appData, "w");');
      refused(source + "\nawait writeFile(appData, plaintext);");
    }
  }
});

test("syntax: the upload file sink and the sealed sink keep their reviewed callers", () => {
  // server-body.ts pins what its handles write; the private temp root belongs to each caller.
  const callers = (name: string): string[] => walk("src", (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path), new Set())
    .filter((path) => path !== "src/ui/server-body.ts" && new RegExp(`\\b${name}\\s*\\(`).test(readFileSync(path, "utf8")));
  expect(callers("sealedFileSink")).toEqual(["src/ui/server-asset-staging.ts"]);
  expect(callers("fileSink")).toEqual(["src/ui/server-security.ts"]);
  expect(callers("streamBodyToFile")).toEqual(["src/ui/server-engine.ts", "src/ui/server-export-folder.ts", "src/ui/server-security.ts"]);
  const exported = readFileSync("src/ui/server-export-folder.ts", "utf8");
  expect(exported).toContain('resolveStudioExportRunPath(studioDir, folder, name)');
  expect(exported).toContain('streamBodyToFile(req, path, EXPORT_FILE_MAX_BYTES, { mode: 0o644, flags: "wx" })');
  const security = readFileSync("src/ui/server-security.ts", "utf8");
  const preopen = (source: string): boolean => {
    const body = functionBody("src/ui/server-security.ts", source, "streamBodyToFile");
    if (!body || callsNamed("src/ui/server-security.ts", body, "fileSink") !== 1) return false;
    const checks = ['if (req.signal.aborted)', 'return { ok: false, response: refusal("aborted") };',
      'const refused = refuseDeclaredLength(req, limit);', 'if (refused) return { ok: false, response: refused };',
      'await fileSink(destPath, file.mode, file.flags)'].map((text) => body.indexOf(text));
    return checks.every((at, i) => at >= 0 && (i === 0 || at > checks[i - 1]!));
  };
  expect(preopen(security)).toBe(true);
  const body = functionBody("src/ui/server-security.ts", security, "streamBodyToFile")!;
  for (const removed of ['if (req.signal.aborted)', 'return { ok: false, response: refusal("aborted") };',
    'const refused = refuseDeclaredLength(req, limit);', 'if (refused) return { ok: false, response: refused };']) {
    const changed = security.replace(body, body.replace(removed, ""));
    expect(changed).not.toBe(security);
    expect(preopen(changed)).toBe(false);
  }
  const opening = body.split("\n").find((line) => line.includes("await fileSink(destPath, file.mode, file.flags)"))!;
  const reordered = security.replace(body, body.replace(opening, "").replace("{", `{\n${opening}`));
  expect(reordered).not.toBe(security);
  expect(preopen(reordered)).toBe(false);
  const staging = readFileSync("src/ui/server-asset-staging.ts", "utf8");
  expect(staging).toContain('mkdtemp(join(tmpdir(), "bunzai-asset-staged-"))');
  expect(staging).toContain("sealedFileSink(file, KEY)");
  expect(staging).toContain("const KEY = randomBytes(32);");
  expect(readFileSync("src/ui/server-engine.ts", "utf8")).toContain('mkdtemp(join(tmpdir(), "bunzai-lvbak-upload-"))');
  // Staging no longer writes itself: any write import there is a new, unreviewed writer.
  expect(appDataWriteOutsideHome("src/ui/server-asset-staging.ts", staging)).toBeNull();
  for (const planted of [
    'import { writeFile } from "node:fs/promises"; await writeFile(file, plaintext);',
    'import { open } from "node:fs/promises"; await open(file, "w");',
    'import { createWriteStream } from "node:fs"; createWriteStream(file);',
  ]) expect(appDataWriteOutsideHome("src/ui/server-asset-staging.ts", staging + planted)).toContain("writeAtomicReplace");
});

test("syntax: node:fs open counts as a write only when its flags can write", () => {
  const flagged = (source: string): string | null => appDataWriteOutsideHome("src/studio/reader.ts", source);
  const imports = ['import { open } from "node:fs/promises";', 'import { openSync as open } from "node:fs";'];
  for (const head of imports) {
    for (const flags of ['"r"', '"rs"', "undefined"]) expect(flagged(`${head} await open(path, ${flags});`)).toBeNull();
    expect(flagged(`${head} await open(path);`)).toBeNull();
    for (const flags of ['"w"', '"a"', '"r+"', '"wx"', '"a+"', "`w`", "mode", "O_WRONLY", "0o1"]) {
      expect(flagged(`${head} await open(path, ${flags});`)).toContain("writeAtomicReplace");
    }
  }
  expect(flagged('import * as fs from "node:fs/promises"; await fs.open(path, "r");')).toBeNull();
  expect(flagged('import * as fs from "node:fs/promises"; await fs.open(path, "w");')).toContain("open");
  expect(flagged('import fs from "node:fs"; fs.promises.open(path, "r+");')).toContain("open");
  expect(flagged('const fs = await import("node:fs/promises"); await fs.open(path, "a");')).toContain("open");
  expect(flagged('const { open } = await import("node:fs/promises"); await open(path, "w");')).toContain("open");
  expect(flagged('const { open } = await import("node:fs/promises"); await open(path, "r");')).toBeNull();
  expect(flagged('import { open } from "node:fs/promises"; // await open(path, "w");')).toBeNull();
  expect(flagged('import { open } from "node:fs/promises"; const doc = "open(path, \\"w\\")";')).toBeNull();
  // An unrelated open (a dialog, a window) is not a node:fs import.
  expect(flagged('dialog.open(path, "w"); window.open(url, "w");')).toBeNull();
  expect(flagged('import { createWriteStream } from "node:fs"; createWriteStream(path);')).toContain("createWriteStream");
  expect(flagged('import * as fs from "node:fs"; fs.appendFileSync(path, text);')).toContain("appendFileSync");
});
