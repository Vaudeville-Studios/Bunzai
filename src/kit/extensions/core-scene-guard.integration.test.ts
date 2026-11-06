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
import type { JsonValue } from "../../extensions/contracts/value";
import { createExtensionSceneServices } from "../../extensions/runtime/scene-services";
import { testCharacter } from "../../studio/test-character";
import { createHandler } from "../../ui/server-handler";
import { StudioStore } from "../../studio/store";
import { SettingsStore } from "../../studio/settings";
import { sheetAsPreset } from "../../core/preset/script-sheet";
import { apiReq, filledSec } from "../../ui/server-test-rig";

const handles: LibraryHandle[] = [], roots: string[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("real Core links use Core preview and append paths while legacy scenes remain usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunzai-extension-core-")); roots.push(root);
  const library = createLibrary(root, { vault: fakeComputer(), sessionsDir: join(root, "sessions"), skipOpenMaintenance: true }); handles.push(library);
  const opened = await library.open();
  if (!opened || opened.state !== "unlocked") throw new Error("isolated library did not open");
  const stores = libraryFor(root);
  if (!stores?.core || stores.chats !== opened.chats) throw new Error("SQLite Core scene records are unavailable");
  await opened.content.create(testCharacter("fixture-character", [], { name: "Fixture", firstMessage: "Welcome." }));
  const preset = sheetAsPreset({ name: "Preset with file", content: "" });
  preset.prompts[0]!.attachments = [{ name: "notes.png", ref: "data:image/png;base64,eA==" }];
  await opened.content.create({ schemaVersion: "1", kind: "preset", id: "preset-with-file", body: preset });
  const cast = { character: { id: "fixture-character", version: 1 } };
  const snapshot = { character: { kind: "character", id: "fixture-character", body: { identity: { name: "Fixture" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } } };
  if (!opened.chats.createCoreChat) throw new Error("SQLite ChatStore lacks Core-first creation");
  const coreChat = await opened.chats.createCoreChat({ title: "Core linked", cast, snapshot });
  await opened.chats.setConnection(coreChat.id, { id: "no-provider", model: "offline-fixture" });
  await createCoreSceneSession(opened.chats, stores.core, join(root, "core-home"), coreChat.id);
  await opened.chats.setPreset(coreChat.id, { kind: "preset", id: "preset-with-file", toggles: {}, samplers: {} });
  const turns = stores.coreTurns;
  if (!turns) throw new Error("the library Core turn owner is unavailable");
  const beforeBlockedTurn = await turns.inspect(coreChat.id);
  if (!beforeBlockedTurn) throw new Error("the linked Core scene is unavailable");
  let previewApplied = 0, turnEvents = 0;
  const originalRead = opened.content.read.bind(opened.content), originalLight = opened.content.readLight.bind(opened.content);
  let fullReads = 0, lightReads = 0;
  opened.content.read = async (...args) => { fullReads++; return originalRead(...args); };
  opened.content.readLight = async (...args) => { lightReads++; return originalLight(...args); };
  try {
    await expect(turns.preview(coreChat.id, "preview", new AbortController().signal, async () => { previewApplied++; return []; }, async () => false))
      .rejects.toThrow("no longer matches its recorded media type");
    await expect(turns.run({ sceneId: coreChat.id, sessionId: beforeBlockedTurn.sessionId, kind: "reply", expectedBranchVersion: beforeBlockedTurn.branchVersion, actor: { kind: "host" } }, () => { turnEvents++; }))
      .rejects.toThrow("no longer matches its recorded media type");
  } finally {
    opened.content.read = originalRead;
    opened.content.readLight = originalLight;
  }
  expect(fullReads).toBe(0);
  expect(lightReads).toBeGreaterThan(0);
  expect(previewApplied).toBe(0);
  expect(turnEvents).toBe(0);
  await opened.chats.setPreset(coreChat.id, null);
  const legacyChat = await opened.chats.createChat({ title: "Legacy scene", cast, snapshot });
  const coreTake = (await opened.chats.listBranches(coreChat.id))[0]!;
  const legacyTake = (await opened.chats.listBranches(legacyChat.id))[0]!;
  const ownedScenes = createExtensionSceneServices(opened.chats, opened.content, async (sceneId) => (await stores.core!.sceneFor(sceneId)) !== null);
  await expect(ownedScenes.previewCreateScene({ characterId: "fixture-character", characterVersion: 1 }, [{ kind: "character", id: "fixture-character" }]))
    .rejects.toMatchObject({ code: "UNSUPPORTED_HOST" });
  expect((await opened.chats.listChats()).chats).toHaveLength(2);
  let providerReviews = 0, providerConnects = 0, now = Date.now(), serial = 0;
  const runtime = await createTerminalExtensionRuntime({
    store: opened.extensionStore, content: opened.content, stateStore: opened.stateStore!, chats: opened.chats, storeId: root,
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now,
    id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    turnConnectionReader: async () => { providerReviews++; return null; },
    connectScene: async () => { providerConnects++; return null; },
  });
  const security = filledSec();
  const handler = createHandler(new StudioStore(root), new SettingsStore(root), undefined, security, undefined, undefined, undefined, undefined, undefined, undefined, undefined, library);
  const originalHostCreate = stores.core.forHostSceneCreation.bind(stores.core);
  let releaseHeader!: () => void, headerCreated!: () => void;
  let headerHeld = false;
  const headerGate = new Promise<void>((resolve) => { releaseHeader = resolve; });
  const headerReached = new Promise<void>((resolve) => { headerCreated = resolve; });
  stores.core.forHostSceneCreation = (sceneId, takeId) => {
    const recordStore = originalHostCreate(sceneId, takeId);
    return { ...recordStore, async create(header, entries) {
      if (!headerHeld) { headerHeld = true; headerCreated(); await headerGate; }
      return recordStore.create(header, entries);
    } };
  };
  let hostStart: Promise<Response> | undefined, pendingChat: Awaited<ReturnType<typeof opened.chats.getChat>> = null;
  try {
    await expect(runtime.previewPrompts(coreChat.id, "must use the Core preview path")).rejects.toThrow("the scene's Kit connection is gone");
    expect((await runtime.previewPrompts(legacyChat.id, "legacy preview remains available")).messages.length).toBeGreaterThan(0);
    hostStart = handler(apiReq("/api/chats/start", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ characterId: "fixture-character" }) }));
    await headerReached;
    for (const chat of (await opened.chats.listChats()).chats) {
      if ((await stores.core.unlinkedBirth(chat.id))?.origin === "host") { pendingChat = chat; break; }
    }
    if (!pendingChat) throw new Error("host start did not publish its atomic Core birth marker");
    const hostPendingChat = pendingChat;
    const pkg = { manifest: { schemaVersion: 1, id: "demo.core-scene-guard", version: "1.0.0", name: "Core guard fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "messages.send", resources: ["scene", "take"], fields: ["message.content"], methods: [], destinations: [], purpose: "append a reviewed message", required: true },
        { operation: "scenes.list", resources: ["library"], fields: [], methods: [], destinations: [], purpose: "find the pending Core scene", required: true },
        { operation: "messages.edit.apply", resources: ["scene", "take"], fields: ["message.seq", "message.id", "message.content"], methods: [], destinations: [], purpose: "edit an exactly mapped Core message", required: true },
        { operation: "turns.start", resources: ["scene", "host-connection"], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:no-provider"], purpose: "start a reviewed turn", required: true },
        { operation: "scenes.create", resources: ["character"], fields: ["scene.create"], methods: [], destinations: [], purpose: "create a Core scene from an approved character", required: true },
      ],
      contributions: [{ type: "command" as const, id: "run", label: "Exercise Core guards", operation: "test.run" }, { type: "command" as const, id: "append", label: "Append Core user message", operation: "messages.send" }, { type: "command" as const, id: "appendAgain", label: "Append after existing Core history", operation: "messages.send" }, { type: "command" as const, id: "edit", label: "Edit mapped Core message", operation: "messages.edit.apply" }, { type: "command" as const, id: "create", label: "Create Core scene", operation: "scenes.create" }, { type: "command" as const, id: "discoverPending", label: "Discover pending Core birth", operation: "scenes.list" }] },
      files: { "main.js": `bunzai.extension.define({commands:{create:async()=>await bunzai.call("scenes.create",{characterId:"fixture-character",characterVersion:1,title:"Extension Core scene"}),append:async()=>await bunzai.call("messages.send",{sceneId:${JSON.stringify(coreChat.id)},takeId:${JSON.stringify(coreTake.id)},content:"Core append only",expectedVersion:${coreTake.version}}),appendAgain:async(input)=>await bunzai.call("messages.send",{sceneId:${JSON.stringify(coreChat.id)},takeId:${JSON.stringify(coreTake.id)},content:"Second Core append",expectedVersion:input.expectedVersion}),discoverPending:async()=>{const scenes=await bunzai.call("scenes.list",{scope:{type:"library"},limit:50});const scene=scenes.find(item=>item.id===${JSON.stringify(hostPendingChat.id)});if(!scene)throw new Error("pending Core scene was not listed");return await bunzai.call("messages.send",{sceneId:scene.id,takeId:scene.activeTakeId,content:"must not hit legacy",expectedVersion:1}).then(value=>value,error=>String(error?.message??error))},edit:async(input)=>await bunzai.call("messages.edit.apply",{sceneId:${JSON.stringify(coreChat.id)},takeId:${JSON.stringify(coreTake.id)},seq:1,content:"Core edited in place",expectedVersion:input.expectedVersion}),run:async(input)=>{
        const turn=await bunzai.call("turns.start",{sceneId:${JSON.stringify(coreChat.id)},connectionId:"no-provider",expectedVersion:input.expectedVersion}).then(value=>value,error=>String(error?.message??error));
        const legacy=await bunzai.call("messages.send",{sceneId:${JSON.stringify(legacyChat.id)},takeId:${JSON.stringify(legacyTake.id)},content:"legacy extension message",expectedVersion:${legacyTake.version}}).then(value=>value,error=>String(error?.message??error));
        return {turn,legacy};
      }}});` } };
    const preview = await runtime.preview(pkg);
    const grants = [
      { operation: "messages.send", resources: [{ kind: "scene", id: coreChat.id }, { kind: "take", id: coreTake.id }, { kind: "scene", id: legacyChat.id }, { kind: "take", id: legacyTake.id }, { kind: "scene", id: hostPendingChat.id }, { kind: "take", id: hostPendingChat.activeBranchId }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
      { operation: "scenes.list", resources: [{ kind: "library", id: "library" }], fields: [], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS["read-small"] },
      { operation: "messages.edit.apply", resources: [{ kind: "scene", id: coreChat.id }, { kind: "take", id: coreTake.id }], fields: ["message.seq", "message.id", "message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
      { operation: "turns.start", resources: [{ kind: "scene", id: coreChat.id }, { kind: "host-connection", id: "no-provider" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:no-provider"], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.external },
      { operation: "scenes.create", resources: [{ kind: "character", id: "fixture-character" }], fields: ["scene.create"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
    ];
    await runtime.install(preview.challenge, grants, [], preview.expectedRevision);
    const installed = (await runtime.list()).find((item) => item.id === pkg.manifest.id)!;
    await runtime.enable(installed.id, installed.revision);
    const created = await (async () => {
      const pending = runtime.activate(installed.id, "command", "create", null);
      let settled = false;
      const result = pending.finally(() => { settled = true; });
      for (let i = 0; i < 400 && !settled; i++) {
        for (const effect of await runtime.pendingEffects()) await runtime.answerEffect(effect.id, true);
        if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!settled) throw new Error("Core scene create command did not settle");
      return result;
    })();
    expect(created).toMatchObject({ status: "completed", output: { title: "Extension Core scene", characterId: "fixture-character" } });
    const createdScene = created.status === "completed" ? created.output as { id: string } : null;
    expect(createdScene && await stores.core.sceneFor(createdScene.id)).toMatchObject({ branchId: expect.any(String), sessionId: expect.any(String) });
    const activateCommand = async (command: string, input: JsonValue) => {
      const activation = runtime.activate(installed.id, "command", command, input);
      let done = false;
      const settled = activation.finally(() => { done = true; });
      for (let i = 0; i < 300 && !done; i++) {
        for (const effect of await runtime.pendingEffects()) await runtime.answerEffect(effect.id, true);
        if (!done) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!done) throw new Error(`Core extension command ${command} did not settle`);
      return settled;
    };
    const pendingWrite = await activateCommand("discoverPending", null);
    expect(pendingWrite).toMatchObject({ status: "completed", output: expect.stringContaining("UNSUPPORTED_HOST:") });
    expect(await opened.chats.countMessages(hostPendingChat.activeBranchId)).toBe(0);
    releaseHeader();
    if (!hostStart) throw new Error("the host Core start request did not begin");
    const started = await hostStart;
    expect(started.status).toBe(200);
    expect(await stores.core.sceneFor(hostPendingChat.id)).toMatchObject({ branchId: hostPendingChat.activeBranchId, sessionId: expect.any(String) });
    const coreEntriesBefore = opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get() as { count: number };
    const appended = await activateCommand("append", null);
    expect(appended).toMatchObject({ status: "completed", output: { role: "user", seq: 1, branchVersion: coreTake.version + 1 } });
    expect(providerReviews).toBe(0);
    expect(providerConnects).toBe(0);
    expect((await opened.chats.readMessages(coreTake.id, { limit: 10 })).messages.map((message) => message.swipes[message.current]?.content)).toEqual(["Core append only"]);
    expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual({ count: coreEntriesBefore.count + 1 });
    const appendedAgain = await activateCommand("appendAgain", { expectedVersion: coreTake.version + 1 });
    expect(appendedAgain).toMatchObject({ status: "completed", output: { role: "user", seq: 2, branchVersion: coreTake.version + 2 } });
    const secondProjection = (await opened.chats.readMessages(coreTake.id, { fromSeq: 2, limit: 1 })).messages[0]!;
    expect(appendedAgain).toMatchObject({ output: { id: secondProjection.id } });
    expect(secondProjection.swipes[secondProjection.current]?.content).toBe("Second Core append");
    expect(providerReviews).toBe(0);
    expect(providerConnects).toBe(0);
    expect((await opened.chats.readMessages(coreTake.id, { limit: 10 })).messages.map((message) => message.swipes[message.current]?.content)).toEqual(["Core append only", "Second Core append"]);
    expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual({ count: coreEntriesBefore.count + 2 });
    const edited = await activateCommand("edit", { expectedVersion: coreTake.version + 2 });
    expect(edited).toMatchObject({ status: "completed", output: { role: "user", seq: 1, branchVersion: coreTake.version + 3 } });
    expect((await opened.chats.readMessages(coreTake.id, { limit: 10 })).messages.map((message) => message.swipes[message.current]?.content)).toEqual(["Core edited in place", "Second Core append"]);
    expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual({ count: coreEntriesBefore.count + 3 });
    const result = await activateCommand("run", { expectedVersion: coreTake.version + 3 });
    expect(result).toMatchObject({ status: "completed", output: { legacy: { role: "user" } } });
    const output = result.status === "completed" ? result.output as { turn: string; legacy: { role: string } } : null;
    expect(output?.turn).toStartWith("OPERATION_FAILED: CONFLICT:");
    expect(providerReviews).toBe(1);
    expect(providerConnects).toBe(0);
    expect((await opened.chats.listChats()).chats.map((chat) => chat.id).sort()).toEqual([coreChat.id, legacyChat.id, hostPendingChat.id, createdScene!.id].sort());
    expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual({ count: coreEntriesBefore.count + 3 });
    expect((await opened.chats.readMessages(legacyTake.id, { limit: 10 })).messages.map((message) => message.swipes[message.current]?.content)).toEqual(["legacy extension message"]);
  } finally { releaseHeader(); stores.core.forHostSceneCreation = originalHostCreate; await hostStart?.catch(() => undefined); await runtime.close(); }
  let desktopPreviewCalls = 0;
  const desktop = createExtensionRouteOwner(library, () => "http://127.0.0.1", undefined, async (sceneId, draft) => {
    desktopPreviewCalls++;
    return { sceneId, label: "Local prompt preview; no model called; unshaped and unbudgeted.", messages: [{ role: "user", content: draft }] };
  });
  const desktopService = await desktop.get();
  if (!desktopService) throw new Error("Desktop extension service did not start");
  try {
    await expect(desktopService.previewPrompts(coreChat.id, "Core preview without a saved provider", new AbortController().signal)).rejects.toThrow("the scene's Kit connection is gone");
    expect(desktopPreviewCalls).toBe(0);
    await desktopService.previewPrompts(legacyChat.id, "legacy", new AbortController().signal);
    expect(desktopPreviewCalls).toBe(1);
    const beforeDesktopCreate = (await opened.chats.listChats()).chats.length;
    let pendingEffect: { id: string } | undefined;
    const creating = desktopService.activate("demo.core-scene-guard", "command", "create", null);
    for (let attempt = 0; attempt < 300 && !pendingEffect; attempt++) {
      pendingEffect = (await desktopService.pendingEffects())[0];
      if (!pendingEffect) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!pendingEffect) throw new Error("Desktop scene creation did not request user approval");
    expect((await opened.chats.listChats()).chats).toHaveLength(beforeDesktopCreate);
    expect(await desktopService.answerEffect(pendingEffect.id, true)).toBe(true);
    const desktopCreated = await creating;
    expect(desktopCreated).toMatchObject({ status: "completed", output: { title: "Extension Core scene", characterId: "fixture-character" } });
    const desktopScene = desktopCreated.status === "completed" ? desktopCreated.output as { id: string; activeTakeId: string } : null;
    if (!desktopScene) throw new Error("Desktop scene creation returned no scene");
    const desktopChat = await opened.chats.getChat(desktopScene.id);
    expect(desktopChat?.cast.character).toMatchObject({ id: "fixture-character", version: 1 });
    expect(await opened.chats.castSnapshot(desktopScene.id)).toMatchObject({ character: { kind: "character", id: "fixture-character", body: { identity: { name: "Fixture" } } } });
    expect(await stores.core.sceneFor(desktopScene.id)).toMatchObject({ branchId: desktopScene.activeTakeId, sessionId: expect.any(String) });
    expect((await opened.chats.listChats()).chats).toHaveLength(beforeDesktopCreate + 1);
  } finally { await desktop.close(); }
}, 15_000);
