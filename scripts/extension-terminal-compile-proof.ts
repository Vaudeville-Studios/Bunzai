/** Purpose: compile the production Terminal owner and verify QuickJS can broker a reviewed Kit docs tool inside a throwaway artifact. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = join(root, "src", "kit", "extensions", `.terminal-proof-${crypto.randomUUID()}.ts`);
const temp = await mkdtemp(join(tmpdir(), "bunzai-extension-terminal-proof-"));
const executable = join(temp, process.platform === "win32" ? "terminal-proof.exe" : "terminal-proof");
try {
  const source = `import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "./owner";
const runtime = await createTerminalExtensionRuntime({ store: memoryExtensionStore(), content: createContentStore(memoryDocumentBackend()), stateStore: memoryStateStore(), chats: memoryChatStore(), storeId: "compiled-proof", wasmBinary: await readTerminalQuickJsWasm() });
try {
 const pkg = { manifest: { schemaVersion: 1, id: "demo.compiled", version: "1.0.0", name: "Compiled proof", description: "", author: "Fixture", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [{ operation: "tools.invoke", resources: ["kit-tool"], fields: ["tools.invoke"], methods: [], destinations: [], purpose: "discover reviewed content capabilities", required: true }], contributions: [{ type: "command", id: "run", label: "Run", operation: "test.run" }] }, files: { "main.js": "bunzai.extension.define({commands:{run:()=>bunzai.call('tools.invoke',{id:'capability_find',args:{action:'browse',domain:'content',limit:1}}).then(result=>({...result,bun:typeof Bun,fetch:typeof fetch,document:typeof document}))}});" } };
 const preview = await runtime.preview(pkg); await runtime.install(preview.challenge, [{ operation: "tools.invoke", resources: [{ kind: "kit-tool", id: "capability_find" }], fields: ["tools.invoke"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 100_000, tokens: 0 } }], [], preview.expectedRevision);
 const installed = await runtime.list(); await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id).revision);
 const result = await runtime.activate(pkg.manifest.id, "command", "run", null); console.log(JSON.stringify(result));
} finally { await runtime.close(); }
`;
  await writeFile(sourcePath, source, { flag: "wx" });
  const compile = Bun.spawnSync(["bun", "build", "--compile", "--root", join(root, "src"), sourcePath, join(root, "src", "sandbox", "javascript", "worker.ts"), "--outfile", executable], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (compile.exitCode !== 0) throw new Error(`compiled worker build failed: ${compile.stderr.toString().slice(-4_000)}`);
  const run = Bun.spawnSync([executable], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`compiled worker failed: ${run.stderr.toString().slice(-4_000)}`);
  const result = JSON.parse(run.stdout.toString().trim()) as unknown;
  const output = result && typeof result === "object" ? (result as { output?: unknown }).output : null;
  if (!output || typeof output !== "object" || !JSON.stringify(output).includes("capability browse")
    || !JSON.stringify(output).includes('"bun":"undefined"') || !JSON.stringify(output).includes('"fetch":"undefined"')
    || !JSON.stringify(output).includes('"document":"undefined"')) throw new Error("compiled Terminal Kit tool invocation returned an unexpected result");
  console.log(`extension terminal compile proof: passed (${process.platform}-${process.arch}, production owner + worker + embedded WASM + brokered semantic tool)`);
} finally {
  await rm(sourcePath, { force: true });
  await rm(temp, { recursive: true, force: true });
}
