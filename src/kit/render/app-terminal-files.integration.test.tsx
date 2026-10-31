/** Purpose: prove a real QuickJS command reads a temporary file only after Terminal host path input. */
/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "./app";
import { testRender, settleUntil } from "./test-render";
import type { Session } from "../session";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "../extensions/owner";

test("Terminal host input selects opaque files and approves a real worker read and write", async () => {
  let now = 1_000, serial = 0;
  const dir = await mkdtemp(join(tmpdir(), "bunzai-terminal-ui-file-")), path = join(dir, "chosen.txt");
  await writeFile(path, "host selected through the TUI");
  const store = memoryExtensionStore(() => now);
  const extensions = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-file-ui-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  let view: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.fileui", version: "1.0.0", name: "Terminal file UI fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "files.pick", resources: [], fields: [], methods: [], destinations: [], purpose: "select one local file", required: true },
        { operation: "files.read", resources: [], fields: ["file.contents"], methods: [], destinations: [], purpose: "read the selected fixture", required: true },
        { operation: "files.write.preview", resources: [], fields: ["file.contents"], methods: [], destinations: [], purpose: "preview selected bytes", required: true },
        { operation: "files.write.apply", resources: [], fields: ["file.contents"], methods: [], destinations: [], purpose: "write the reviewed file", required: true },
      ], contributions: [
        { type: "command" as const, id: "read", label: "Read chosen file", operation: "test.read" },
        { type: "command" as const, id: "write", label: "Write chosen file", operation: "test.write" },
      ] },
      files: { "main.js": `bunzai.extension.define({commands:{read:async()=>{const file=await bunzai.call("files.pick",{mode:"read"});return bunzai.call("files.read",{handleId:file.id,maxBytes:100})},write:async()=>{const file=await bunzai.call("files.pick",{mode:"create",suggestedName:"created.txt"});const preview=await bunzai.call("files.write.preview",{handleId:file.id,base64:"Y3JlYXRlZCBieSB0aGUgYXBwcm92ZWQgVGVybWluYWwgZXh0ZW5zaW9u"});return bunzai.call("files.write.apply",{previewId:preview.previewId})}}});` } };
    const preview = await extensions.preview(pkg);
    await extensions.install(preview.challenge, [
      { operation: "files.pick", resources: [], fields: [], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 380_000, tokens: 0 } },
      { operation: "files.read", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 190_000, tokens: 0 } },
      { operation: "files.write.preview", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 190_000, tokens: 0 } },
      { operation: "files.write.apply", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 190_000, tokens: 0 } },
    ], [], preview.expectedRevision);
    const item = (await extensions.list()).find((candidate) => candidate.id === pkg.manifest.id)!;
    await extensions.enable(item.id, item.revision);
    now += 1;
    const activation = extensions.activate(pkg.manifest.id, "command", "read", null);
    const session: Session = { extensions, async runTurn(_input, history) { return history; }, async probe() {}, async summarise() { return null; }, async activeProvider() { return null; } };
    view = await testRender(<App studioName="Terminal file fixture" totalPieces={0} decks={[]} session={session} commands={[]} onQuit={() => {}} />, { width: 90, height: 24 });
    await settleUntil(() => view!.captureCharFrame().includes("EXTENSION FILE SELECTION"));
    await view.mockInput.typeText(path);
    view.mockInput.pressEnter();
    const result = await activation;
    const encoded = (result.output as { base64?: unknown } | null)?.base64;
    expect(typeof encoded).toBe("string");
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded as string), (char) => char.charCodeAt(0)))).toBe("host selected through the TUI");
    expect(JSON.stringify(result.output)).not.toContain(path);

    const writeActivation = extensions.activate(pkg.manifest.id, "command", "write", null);
    await settleUntil(() => view!.captureCharFrame().includes("EXTENSION FILE SELECTION"));
    await view.mockInput.typeText(join(dir, "created.txt")); view.mockInput.pressEnter();
    await settleUntil(() => view!.captureCharFrame().includes("EXTENSION REQUEST: Write a chosen file"));
    view.mockInput.pressKey("y");
    expect(await writeActivation).toEqual({ status: "completed", output: { written: true } });
    const created = await readFile(join(dir, "created.txt"));
    expect(new TextDecoder().decode(created)).toBe("created by the approved Terminal extension");
  } finally {
    if (view) await view.renderer.destroy();
    await extensions.close();
    await rm(dir, { recursive: true, force: true });
  }
});
