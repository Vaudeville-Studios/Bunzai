/** Reproduces that linked Core turns bypass the installed extension prompt and event owners. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeComputer } from "../stage/crypto/fake-device-vault";
import { saveProvider } from "../kit/providers/vault";
import { Engine } from "rp-core";
import { createLibrary, type LibraryHandle } from "./library-root";
import { libraryFor } from "../studio/library-content";
import { StudioStore } from "../studio/store";
import { SettingsStore } from "../studio/settings";
import { testCharacter } from "../studio/test-character";
import { createExtensionRouteOwner } from "./server-extension-owner";
import { createHandler } from "./server-handler";
import { openCoreScene } from "../studio/core-scene";
import { EXTENSION_BUDGET_PRESETS } from "../extensions/contracts/operation";
import type { JsonValue } from "../extensions/contracts/value";
import { apiReq, filledSec } from "./server-test-rig";

const roots: string[] = [];
const libraries: LibraryHandle[] = [];
const handlers: Array<{ close(): Promise<void> }> = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const priorHome = process.env.BUNZAI_HOME;
afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  await Promise.all(libraries.splice(0).map((library) => library.close()));
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (priorHome === undefined) delete process.env.BUNZAI_HOME;
  else process.env.BUNZAI_HOME = priorHome;
});

test("a granted prompt contribution reaches the real linked Core provider request", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunzai-core-extension-red-")); roots.push(root);
  process.env.BUNZAI_HOME = join(root, "kit");
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const provider = Bun.serve({ port: 0, async fetch(req) {
    requests.push(await req.json() as typeof requests[number]);
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    return new Response(frame({ choices: [{ delta: { content: "The harbor is calm." }, finish_reason: "stop" }], model: "fixture" })
      + frame({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 4 } }) + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } }); servers.push(provider);
  const connection = await saveProvider({ kind: "local", name: "Core extension fixture", model: "fixture", baseURL: `http://127.0.0.1:${provider.port}/v1` }, { passphrase: "core-extension-test" });
  const connectionId = connection.id;
  if (!connectionId) throw new Error("fixture provider did not receive an id");
  const library = createLibrary(root, { vault: fakeComputer(), sessionsDir: join(root, "sessions"), coreSceneIntegration: true }); libraries.push(library);
  const opened = await library.open();
  if (!opened || opened.state !== "unlocked") throw new Error("isolated Core library did not open");
  const studio = new StudioStore(root);
  const settings = new SettingsStore(root);
  const security = filledSec();
  const extensionOwner = createExtensionRouteOwner(library, () => "http://127.0.0.1:0");
  const handler = createHandler(studio, settings, undefined, security, undefined, undefined, undefined, undefined, undefined, undefined, undefined, library, undefined, undefined, extensionOwner); handlers.push(handler);
  const manager = await extensionOwner.get();
  if (!manager) throw new Error("extension runtime did not start");
  await studio.save(testCharacter("core-hook-character", [], { name: "Mira", firstMessage: "Welcome." }));
  const started = await handler(apiReq("/api/chats/start", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ characterId: "core-hook-character" }) }));
  const scene = await started.json() as { id: string };
  const manifest = { schemaVersion: 1, id: "demo.core-prompt-hook", version: "1.0.0", name: "Core prompt hook", description: "fixture", author: "tests",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
    requirements: [
      { operation: "prompts.contribute", resources: ["scene"], fields: ["system.append"], methods: [], destinations: [], purpose: "append a bounded fixture prompt candidate", required: true },
      { operation: "events.subscribe", resources: ["event", "scene"], fields: ["payload"], methods: [], destinations: [], purpose: "observe the linked Core turn lifecycle", required: true },
      { operation: "logs.write", resources: [], fields: ["logs"], methods: [], destinations: [], purpose: "record the bounded lifecycle fixture", required: true },
      { operation: "turns.start", resources: ["scene", "host-connection"], fields: ["turn.run", "model.prompt"], methods: [], destinations: [`connection:${connectionId}`], purpose: "run one approved linked Core turn", required: true },
      { operation: "messages.send", resources: ["scene", "take"], fields: ["message.content"], methods: [], destinations: [], purpose: "append a message to the linked Core journal", required: true },
    ],
    contributions: [
      { type: "prompt", id: "append", label: "Append fixture note", stage: "system.append", required: true },
      { type: "panel", id: "lifecycle", title: "Core lifecycle fixture", events: ["scene.turn.started"] },
      { type: "command", id: "configure", label: "Subscribe to lifecycle", operation: "events.subscribe" },
      { type: "command", id: "sendUser", label: "Append without running the provider", operation: "messages.send" },
      { type: "command", id: "run", label: "Run Core turn", operation: "turns.start" },
    ] };
  const pkg = { manifest, files: { "main.js": `bunzai.extension.define({
    events:{
      append:async({sceneId,stage})=>{await bunzai.call("prompts.contribute",{sceneId,stage,text:"Extension candidate reaches the narrator."})},
      "scene.turn.started":async()=>{await bunzai.call("logs.write",{level:"info",message:"Core lifecycle event received"})}
    },
    commands:{
      configure:async({sceneId})=>await bunzai.call("events.subscribe",{scope:"scene",event:"scene.turn.started",sceneId}),
      sendUser:async(input)=>await bunzai.call("messages.send",input),
      run:async(input)=>await bunzai.call("turns.start",input)
    }
  });` } };
  const preview = await manager.preview(pkg);
  const grant = { operation: "prompts.contribute", resources: [{ kind: "scene", id: scene.id }], fields: ["system.append"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata };
  const grants = [grant,
    { operation: "events.subscribe", resources: [{ kind: "event", id: "scene.turn.started" }, { kind: "scene", id: scene.id }], fields: ["payload"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
    { operation: "logs.write", resources: [], fields: ["logs"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata },
    { operation: "turns.start", resources: [{ kind: "scene", id: scene.id }, { kind: "host-connection", id: connectionId }], fields: ["turn.run", "model.prompt"], methods: [], destinations: [`connection:${connectionId}`], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.external },
    { operation: "messages.send", resources: [{ kind: "scene", id: scene.id }, { kind: "take", id: (await opened.chats.listBranches(scene.id))[0]!.id }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
  ];
  const installed = await manager.install(preview.challenge, grants, [], preview.expectedRevision);
  await manager.enable(installed.id, installed.revision);
  await handler(apiReq("/api/chats/connection", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ chatId: scene.id, connection: { id: connectionId, model: "fixture" } }) }));
  const coreStores = libraryFor(root);
  const coreLink = await coreStores?.core?.sceneFor(scene.id), selectedChat = await opened.chats.getChat(scene.id);
  if (!coreStores?.core || !coreLink || !selectedChat?.connection) throw new Error("linked Core connection fixture is unavailable");
  const configRows = async () => (await Array.fromAsync(coreStores.core!.read(coreLink.sessionId))).filter((entry) => entry.t === "config").length;
  const beforeBinding = await configRows();
  const firstOpen = await openCoreScene(coreStores.core, root, coreLink.sessionId, selectedChat.connection);
  await firstOpen.engine.close();
  const afterBinding = await configRows();
  const secondOpen = await openCoreScene(coreStores.core, root, coreLink.sessionId, selectedChat.connection);
  await secondOpen.engine.close();
  expect(await configRows()).toBe(afterBinding);
  expect(afterBinding - beforeBinding).toBeLessThanOrEqual(1);
  const entriesBeforePreview = opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get() as { count: number };
  const branchBeforePreview = (await opened.chats.listBranches(scene.id))[0]!;
  const localPreview = await manager.previewPrompts(scene.id, "A local draft for the extension preview.");
  expect(localPreview.label).toBe("RP-Core prompt preview; local only; canonical shaping and budget applied.");
  expect(localPreview.messages.some((item) => item.content.includes("Extension candidate reaches the narrator."))).toBe(true);
  expect(opened.database.db.query("SELECT COUNT(*) AS count FROM core_entries").get()).toEqual(entriesBeforePreview);
  expect((await opened.chats.listBranches(scene.id))[0]!.version).toBe(branchBeforePreview.version);
  expect(requests).toHaveLength(0);
  const activateAndApprove = async (contributionId: string, input: JsonValue, packageId = installed.id) => {
    let settled = false;
    const activation = manager.activate(packageId, "command", contributionId, input).finally(() => { settled = true; });
    for (let i = 0; i < 400 && !settled; i++) {
      for (const effect of await manager.pendingEffects()) await manager.answerEffect(effect.id, true);
      if (!settled) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!settled) throw new Error(`extension command ${contributionId} did not settle`);
    return activation;
  };
  const configured = await activateAndApprove("configure", { sceneId: scene.id });
  expect(configured).toMatchObject({ status: "completed", output: { status: "subscribed" } });
  const sent = await handler(apiReq("/api/chats/send", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ chatId: scene.id, content: "What is beyond the harbor?", greetingIndex: 0, expectedVersion: 1 }) }));
  const message = await sent.json() as { branchVersion: number };
  const turn = await handler(apiReq("/api/chats/turn", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ chatId: scene.id, kind: "reply", expectedVersion: message.branchVersion }) }));
  await turn.text();
  const logsBefore = await opened.extensionStore.listLogs(installed.id, null, 10);
  const firstPartyLogCount = logsBefore.records.filter((item) => item.message === "Core lifecycle event received").length;
  expect(firstPartyLogCount).toBe(1);
  const beforeFollowup = (await opened.chats.listBranches(scene.id))[0]!;
  const followup = await handler(apiReq("/api/chats/send", { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify({ chatId: scene.id, content: "Queue the Compendium task.", greetingIndex: 0, expectedVersion: beforeFollowup.version }) }));
  expect(followup.status).toBe(200);
  const stores = libraryFor(root);
  const linked = await stores?.core?.sceneFor(scene.id);
  if (!stores?.core || !linked) throw new Error("Core Compendium fixture lost its scene link");
  const laneEngine = await Engine.openWithRecordStore({ home: root, recordStore: stores.core, lane: "manual" });
  try {
    const session = await laneEngine.session(linked.sessionId);
    const answer = [...(await session.view()).path].reverse().find((message) => message.role === "assistant");
    if (!answer || answer.role !== "assistant") throw new Error("Core Compendium backlog needs a committed answer");
    let lane = await session.memoryStatus();
    if (!lane.queued.length) {
      await session.memoryRefile({ messageId: answer.id, task: "file" });
      lane = await session.memoryStatus();
    }
    expect(lane.queued.length).toBeGreaterThan(0);
  } finally { await laneEngine.close(); }
  const appendBranch = (await opened.chats.listBranches(scene.id))[0]!;
  const beforeManualAppend = requests.length;
  const extensionAppend = await activateAndApprove("sendUser", { sceneId: scene.id, takeId: appendBranch.id, content: "Append while Compendium work is queued", expectedVersion: appendBranch.version });
  expect(extensionAppend).toMatchObject({ status: "completed", output: { role: "user" } });
  expect(requests).toHaveLength(beforeManualAppend);
  expect(requests).toHaveLength(1);
  const turnBranch = (await opened.chats.listBranches(scene.id))[0]!;
  const stalePreview = await manager.preview({ ...pkg, manifest: { ...manifest, id: "demo.core-prompt-stale", name: "Core stale-selection fixture" } });
  const staleInstalled = await manager.install(stalePreview.challenge, grants, [], stalePreview.expectedRevision);
  await manager.enable(staleInstalled.id, staleInstalled.revision);
  const applyPrompts = manager.applyPromptContributions.bind(manager);
  manager.applyPromptContributions = async (sceneId, messages, signal) => {
    await opened.chats.setConnection(sceneId, { id: connectionId, model: "unreviewed" });
    return applyPrompts(sceneId, messages, signal);
  };
  const refusedTurn = await activateAndApprove("run", { sceneId: scene.id, connectionId, expectedVersion: turnBranch.version }, staleInstalled.id);
  expect(refusedTurn).toMatchObject({ status: "completed", output: { status: "failed" } });
  expect(requests).toHaveLength(1);
  manager.applyPromptContributions = applyPrompts;
  await opened.chats.setConnection(scene.id, { id: connectionId, model: "fixture" });
  const extensionTurn = await activateAndApprove("run", { sceneId: scene.id, connectionId, expectedVersion: turnBranch.version });
  expect(extensionTurn).toMatchObject({ status: "completed", output: { status: "completed" } });

  expect(requests).toHaveLength(2);
  expect(requests.every((request) => request.messages.some((item) => item.content.includes("Extension candidate reaches the narrator.")))).toBe(true);
  const logsAfter = await opened.extensionStore.listLogs(installed.id, null, 10);
  expect(logsAfter.records.filter((item) => item.message === "Core lifecycle event received")).toHaveLength(firstPartyLogCount + 1);
});
