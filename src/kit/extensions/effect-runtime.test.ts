/** Purpose: prove a Terminal model send waits for its explicit host confirmation before execution. */
import { expect, test } from "bun:test";
import { EXTENSION_BUDGET_PRESETS } from "../../extensions/contracts/operation";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import type { ExtensionModelServices } from "../../extensions/operations/models/_services";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "./owner";

test("Terminal model generation is shown to the host and does not send after denial", async () => {
  const store = memoryExtensionStore(() => 1_000);
  let generated = false, serial = 0;
  const connection = { id: "saved-1", name: "Saved provider", provider: "openai", model: "fixture-model", hasKey: true };
  const modelServices: ExtensionModelServices = {
    describe: async () => connection, list: async () => [], prepareGeneration: async () => connection,
    generate: async () => { generated = true; return { model: connection.model, text: "should not send", usage: null, promptTokens: null, outputTokens: null, accountingUnits: 0 }; },
    cancel: async () => true, usage: async () => ({ calls: 0, promptTokens: 0, outputTokens: 0, accountingUnits: 0, tokenUsageComplete: true }),
  };
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => 1_000, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    storeId: "terminal-effects-fixture", modelServices, wasmBinary: await readTerminalQuickJsWasm(),
    now: () => 1_000, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.model-effect", version: "1.0.0", name: "Model fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "models.generate", resources: ["host-connection"], fields: ["model.prompt"], methods: [], destinations: ["connection:saved-1"], purpose: "Send one reviewed prompt", required: true }],
      contributions: [{ type: "command" as const, id: "run", label: "Run model", operation: "models.generate" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:async()=>{try{await bunzai.call("models.generate",{connectionId:"saved-1",jobId:"run-0001",prompt:"send this exact prompt",maxOutputTokens:24});return {denied:false}}catch{return {denied:true}}}}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "models.generate", resources: [{ kind: "host-connection", id: "saved-1" }], fields: ["model.prompt"], methods: [], destinations: ["connection:saved-1"], duration: "session", budget: { ...EXTENSION_BUDGET_PRESETS.external, requests: 2 } }], [], preview.expectedRevision);
    await runtime.enable(pkg.manifest.id, (await runtime.list()).find((item) => item.id === pkg.manifest.id)!.revision);
    const activation = runtime.activate(pkg.manifest.id, "command", "run", null);
    let pending = await runtime.pendingEffects();
    for (let attempt = 0; attempt < 50 && pending.length === 0; attempt++) { await new Promise((resolve) => setTimeout(resolve, 10)); pending = await runtime.pendingEffects(); }
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ operation: "models.generate", destinations: ["connection:saved-1"], review: { prompt: "send this exact prompt", maxOutputTokens: 24 } });
    expect(await runtime.answerEffect(pending[0]!.id, false)).toBe(true);
    await expect(activation).resolves.toMatchObject({ status: "completed", output: { denied: true } });
    expect(generated).toBe(false);
  } finally { await runtime.close(); }
});
