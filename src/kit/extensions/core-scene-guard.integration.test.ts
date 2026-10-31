/** Purpose: prove a real Core-linked SQLite scene cannot reach legacy extension writes or turns. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeComputer } from "../../stage/crypto/fake-device-vault";
import { createLibrary, type LibraryHandle } from "../../ui/library-root";
import { libraryFor } from "../../studio/library-content";
import { createCoreSceneSession } from "../../studio/core-scene";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "./owner";
import { createExtensionRouteOwner } from "../../ui/server-extension-owner";
import { EXTENSION_BUDGET_PRESETS } from "../../extensions/contracts/operation";
import { createExtensionSceneServices } from "../../extensions/runtime/scene-services";

const handles: LibraryHandle[] = [], roots: string[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("real Core links fail closed for extension turn, message and prompt paths while legacy scenes remain usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunzai-extension-core-")); roots.push(root);
  const library = createLibrary(root, { vault: fakeComputer(), sessionsDir: join(root, "sessions"), skipOpenMaintenance: true }); handles.push(library);
  const opened = await library.open();
  if (!opened || opened.state !== "unlocked") throw new Error("isolated library did not open");
  const stores = libraryFor(root);
  if (!stores?.core || stores.chats !== opened.chats) throw new Error("SQLite Core scene records are unavailable");
  const cast = { character: { id: "fixture-character", version: 1 } };
  const snapshot = { character: { kind: "character", id: "fixture-character", body: { identity: { name: "Fixture" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } } };
  const coreChat = await opened.chats.createChat({ title: "Core linked", cast, snapshot });
  await opened.chats.setConnection(coreChat.id, { id: "no-provider", model: "offline-fixture" });
  await createCoreSceneSession(opened.chats, stores.core, join(root, "core-home"), coreChat.id);
  const legacyChat = await opened.chats.createChat({ title: "Legacy scene", cast, snapshot });
  const coreTake = (await opened.chats.listBranches(coreChat.id))[0]!;
  const legacyTake = (await opened.chats.listBranches(legacyChat.id))[0]!;
  const ownedScenes = createExtensionSceneServices(opened.chats, opened.content, async (sceneId) => (await stores.core!.sceneFor(sceneId)) !== null);
  await expect(ownedScenes.previewCreateScene({ characterId: "fixture-character", characterVersion: 1 }, [{ kind: "character", id: "fixture-character" }]))
    .rejects.toMatchObject({ code: "UNSUPPORTED_HOST" });
  expect((await opened.chats.listChats()).chats).toHaveLength(2);
  const coreEntriesBefore = opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get() as { count: number };
  let providerReviews = 0, providerConnects = 0, now = Date.now(), serial = 0;
  const runtime = await createTerminalExtensionRuntime({
    store: opened.extensionStore, content: opened.content, stateStore: opened.stateStore!, chats: opened.chats, storeId: root,
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now,
    id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    turnConnectionReader: async () => { providerReviews++; return null; },
    connectScene: async () => { providerConnects++; return null; },
  });
  try {
    await expect(runtime.previewPrompts(coreChat.id, "must not assemble legacy prompt")).rejects.toMatchObject({ code: "UNSUPPORTED_HOST" });
    expect((await runtime.previewPrompts(legacyChat.id, "legacy preview remains available")).messages.length).toBeGreaterThan(0);
    const pkg = { manifest: { schemaVersion: 1, id: "demo.core-scene-guard", version: "1.0.0", name: "Core guard fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "messages.send", resources: ["scene", "take"], fields: ["message.content"], methods: [], destinations: [], purpose: "append a reviewed message", required: true },
        { operation: "turns.start", resources: ["scene", "host-connection"], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:no-provider"], purpose: "start a reviewed turn", required: true },
      ],
      contributions: [{ type: "command" as const, id: "run", label: "Exercise Core guards", operation: "test.run" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:async()=>{
        const turn=await bunzai.call("turns.start",{sceneId:${JSON.stringify(coreChat.id)},connectionId:"no-provider",expectedVersion:${coreTake.version}}).then(()=>"allowed",error=>error.message);
        const linked=await bunzai.call("messages.send",{sceneId:${JSON.stringify(coreChat.id)},takeId:${JSON.stringify(coreTake.id)},content:"must not reach legacy ChatStore",expectedVersion:${coreTake.version}}).then(()=>"allowed",error=>error.message);
        const legacy=await bunzai.call("messages.send",{sceneId:${JSON.stringify(legacyChat.id)},takeId:${JSON.stringify(legacyTake.id)},content:"legacy extension message",expectedVersion:${legacyTake.version}}).then(value=>value,error=>String(error?.message??error));
        return {turn,linked,legacy};
      }}});` } };
    const preview = await runtime.preview(pkg);
    const grants = [
      { operation: "messages.send", resources: [{ kind: "scene", id: coreChat.id }, { kind: "take", id: coreTake.id }, { kind: "scene", id: legacyChat.id }, { kind: "take", id: legacyTake.id }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
      { operation: "turns.start", resources: [{ kind: "scene", id: coreChat.id }, { kind: "host-connection", id: "no-provider" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:no-provider"], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.external },
    ];
    await runtime.install(preview.challenge, grants, [], preview.expectedRevision);
    const installed = (await runtime.list()).find((item) => item.id === pkg.manifest.id)!;
    await runtime.enable(installed.id, installed.revision);
    const activation = runtime.activate(installed.id, "command", "run", null);
    let done = false;
    const settled = activation.finally(() => { done = true; });
    for (let i = 0; i < 300 && !done; i++) {
      for (const effect of await runtime.pendingEffects()) await runtime.answerEffect(effect.id, true);
      if (!done) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const result = await settled;
    expect(result).toMatchObject({ status: "completed", output: { legacy: { role: "user" } } });
    const refused = result.status === "completed" ? result.output as { turn: string; linked: string } : null;
    expect(refused?.turn).toStartWith("UNSUPPORTED_HOST:");
    expect(refused?.linked).toStartWith("UNSUPPORTED_HOST:");
    expect(providerReviews).toBe(0);
    expect(providerConnects).toBe(0);
    expect((await opened.chats.listChats()).chats.map((chat) => chat.id).sort()).toEqual([coreChat.id, legacyChat.id].sort());
    expect((await opened.chats.readMessages(coreTake.id, { limit: 10 })).messages).toEqual([]);
    expect((await opened.chats.readMessages(legacyTake.id, { limit: 10 })).messages.map((message) => message.swipes[message.current]?.content)).toEqual(["legacy extension message"]);
    expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual(coreEntriesBefore);
  } finally { await runtime.close(); }
  let desktopPreviewCalls = 0;
  const desktop = createExtensionRouteOwner(library, () => "http://127.0.0.1", undefined, async (sceneId, draft) => {
    desktopPreviewCalls++;
    return { sceneId, label: "Local prompt preview; no model called; unshaped and unbudgeted.", messages: [{ role: "user", content: draft }] };
  });
  const desktopService = await desktop.get();
  if (!desktopService) throw new Error("Desktop extension service did not start");
  try {
    await expect(desktopService.previewPrompts(coreChat.id, "blocked", new AbortController().signal)).rejects.toMatchObject({ code: "UNSUPPORTED_HOST" });
    expect(desktopPreviewCalls).toBe(0);
    await desktopService.previewPrompts(legacyChat.id, "legacy", new AbortController().signal);
    expect(desktopPreviewCalls).toBe(1);
  } finally { await desktop.close(); }
});
