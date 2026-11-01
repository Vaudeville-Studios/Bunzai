/** Purpose: prove macro.preview is denied before execution and runs only after the Terminal host prompt. */
/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test";
import { App } from "./app";
import { testRender, settleUntil } from "./test-render";
import type { Session } from "../session";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "../extensions/owner";

test("Terminal macro preview shows the exact sample and runs only after explicit host approval", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const extensions = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-macro-ui-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  let view: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.macroui", version: "1.0.0", name: "Terminal macro UI fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], purpose: "preview a bounded sample in read-only mode", required: true }],
      contributions: [{ type: "command" as const, id: "preview", label: "Preview sample", operation: "test.preview" }] },
      files: { "main.js": `bunzai.extension.define({commands:{preview:()=>bunzai.call("macros.preview",{sample:"Hello {{char}}!",environment:{characterName:"Nova",randomSeed:7}})}});` } };
    const preview = await extensions.preview(pkg);
    await extensions.install(preview.challenge, [{ operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 400_000, tokens: 0 } }], [], preview.expectedRevision);
    const item = (await extensions.list()).find((candidate) => candidate.id === pkg.manifest.id)!;
    await extensions.enable(item.id, item.revision); now += 1;
    const session: Session = { extensions, async runTurn(_input, history) { return history; }, async probe() {}, async summarise() { return null; }, async activeProvider() { return null; } };
    view = await testRender(<App studioName="Terminal macro fixture" totalPieces={0} decks={[]} session={session} commands={[]} onQuit={() => {}} />, { width: 90, height: 24 });

    const deniedRun = extensions.activate(pkg.manifest.id, "command", "preview", null);
    await settleUntil(() => view!.captureCharFrame().includes("EXTENSION REQUEST: Preview supplied macro text"));
    expect(view.captureCharFrame()).toContain("Hello {{char}}!");
    view.mockInput.pressKey("n");
    await expect(deniedRun).rejects.toThrow();
    await settleUntil(() => !view!.captureCharFrame().includes("EXTENSION REQUEST:"));

    const approvedRun = extensions.activate(pkg.manifest.id, "command", "preview", null);
    await settleUntil(() => view!.captureCharFrame().includes("EXTENSION REQUEST: Preview supplied macro text"));
    expect(view.captureCharFrame()).toContain("Hello {{char}}!");
    view.mockInput.pressKey("y");
    const result = await approvedRun;
    expect(result).toMatchObject({ status: "completed", output: { text: "Hello Nova!", diagnostics: { errors: 0, sideEffects: 0 } } });
  } finally { if (view) await view.renderer.destroy(); await extensions.close(); }
}, 15_000);
