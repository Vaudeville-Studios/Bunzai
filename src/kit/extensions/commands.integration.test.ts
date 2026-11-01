/** Purpose: prove the Terminal prompt command assembles a stored scene and runs a real QuickJS prompt hook. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "./owner";
import { runExtensionCommand } from "./commands";

test("Terminal local prompt command includes stored context, local draft and actual extension output without a provider", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const chats = memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Prompt preview fixture", cast: { character: { id: "fixture-character", version: 1 } }, snapshot: { character: {
    kind: "character", id: "fixture-character", body: { identity: { name: "Fixture guide" }, persona: {}, prompts: { systemPrompt: "Canonical stored prompt marker." }, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {},
    },
  } } });
  await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Canonical stored scene history marker." }]);
  const runtime = await createTerminalExtensionRuntime({ store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), chats, storeId: "terminal-prompt-command-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`, isCoreScene: null });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.prompt-command", version: "1.0.0", name: "Prompt command fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "prompts.contribute", resources: ["scene"], fields: ["system.append"], methods: [], destinations: [], purpose: "append one fixture candidate to the local prompt preview", required: true }],
      contributions: [{ type: "prompt" as const, id: "append", label: "Append fixture candidate", stage: "system.append" }] },
      files: { "main.js": `bunzai.extension.define({events:{append:async(input)=>bunzai.call("prompts.contribute",{sceneId:input.sceneId,stage:input.stage,text:"Terminal QuickJS candidate."})}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "prompts.contribute", resources: [{ kind: "scene", id: chat.id }], fields: ["system.append"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 2_000_000, tokens: 0 } }], [], preview.expectedRevision);
    const item = (await runtime.list()).find((candidate) => candidate.id === pkg.manifest.id)!;
    await runtime.enable(item.id, item.revision);
    const output: string[] = [];
    await runExtensionCommand({ arg: `prompt ${chat.id} Terminal local draft marker.`, say: (text) => output.push(text), extensions: runtime });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("Local prompt preview; no model called; unshaped and unbudgeted.");
    expect(output[0]).toContain("Canonical stored scene history marker.");
    expect(output[0]).toContain("Terminal local draft marker.");
    expect(output[0]).toContain("Terminal QuickJS candidate.");
    expect(output[0]).not.toContain("provider");
  } finally { await runtime.close(); }
});
