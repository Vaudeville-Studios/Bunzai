/** Reusable core isolation, shutdown and request parity through real turns on isolated memory stores. */
import { expect, test } from "bun:test";
import { createRoleplayCore, type Connected, type Provider, type ProviderRequest, type ProviderRequestGuard, type TurnEvent } from "./rp-core";
import { ProviderError } from "./stage/contracts/provider";
import { memoryChatStore } from "./stage/store/chat-store";
import { memoryStateStore } from "./stage/store/memory/state-store";
import { runTurn } from "./studio/scene-turn";
import { createTurnRuntime } from "./studio/scene-turn-runtime";
import { DIRECTOR_PROP_ID } from "./core/director/settings";
import type { ExtensionCommitContext } from "./stage/contracts/extension-store";
import type { ChatConnection } from "./stage/contracts/chat-store";

async function scene(connect?: (connection: ChatConnection) => Promise<Connected | null>, authorizeExtensionCommit?: (context: ExtensionCommitContext) => void) {
  let id = 0, now = 1_000;
  const chats = memoryChatStore(() => now, () => `id-${++id}`, authorizeExtensionCommit ? { authorizeExtensionCommit } : {});
  const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: { kind: "character", id: "vera", body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } } } });
  await chats.setConnection(chat.id, { id: "conn", model: "model" });
  await chats.appendMessage(chat.activeBranchId, { role: "user", content: "Any storms?" });
  const requests: ProviderRequest[] = [];
  const provider: Provider = { id: "conn", async send(request) { requests.push(structuredClone(request)); return { content: "Rain soon.", finish_reason: "stop", raw: {} }; } };
  const deps = { chats, state: memoryStateStore(), connect: connect ? (connection: ChatConnection) => connect(connection) : async () => ({ provider, kind: "openrouter", context: 32_000 }), readPreset: async () => null, readLorebook: async () => null, now: () => ++now, randomSeed: () => 7 };
  const core = createRoleplayCore(deps);
  const input = { chatId: chat.id, kind: "reply" as const, expectedVersion: (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion! };
  const events: TurnEvent[] = [];
  let reviewed!: (event: Extract<TurnEvent, { type: "review" }>) => void;
  const review = new Promise<Extract<TurnEvent, { type: "review" }>>((resolve) => { reviewed = resolve; });
  const emit = (event: TurnEvent) => { events.push(event); if (event.type === "review") reviewed(event); };
  const messages = async () => (await chats.readMessages(chat.activeBranchId, { limit: 20 })).messages;
  return { core, chats, chat, deps, input, events, emit, review, requests, messages };
}

test("independent cores own colliding review/turn ids; stopping one leaves the other waiting", async () => {
  const a = await scene(), b = await scene();
  const first = a.core.runTurn({ ...a.input, inspect: true }, a.emit);
  const second = b.core.runTurn({ ...b.input, inspect: true }, b.emit);
  try {
    const [ar, br] = await Promise.all([Promise.race([a.review, first.then(() => { throw new Error(JSON.stringify(a.events)); })]), Promise.race([b.review, second.then(() => { throw new Error(JSON.stringify(b.events)); })])]);
    expect(a.chat.id).toBe(b.chat.id);
    expect(ar.turnId).toBe(br.turnId);
    expect(a.core.stop(a.chat.id, ar.turnId)).toBe(true);
    await first;
    expect(a.requests).toHaveLength(0);
    expect(b.core.isRunning(b.chat.id)).toBe(true);
    expect(b.events.at(-1)?.type).toBe("review");
    expect(b.core.answerReview(b.chat.id, br.turnId, { kind: "send", edits: {} })).toBe(true);
    await second;
    expect(b.requests).toHaveLength(1);
    expect((await b.messages()).at(-1)?.swipes[0]?.content).toBe("Rain soon.");
  } finally { await Promise.all([a.core.close(), b.core.close()]); }
});

test("recovery uses its own store even when another core owns the same checkpoint id", async () => {
  const a = await scene(), b = await scene();
  const work = a.core.runTurn({ ...a.input, inspect: true }, a.emit);
  try {
    const reviewed = await Promise.race([a.review, work.then(() => { throw new Error(JSON.stringify(a.events)); })]);
    const abandoned = (await b.chats.beginTurn(b.chat.activeBranchId, { kind: "reply" }))!;
    expect(abandoned.id).toBe(reviewed.turnId);
    await b.chats.saveCheckpoint(abandoned.id, { content: "Recovered rain." });
    expect(await b.core.resume(b.chat.id)).toBe(1);
    expect((await b.messages()).at(-1)?.swipes[0]?.content).toBe("Recovered rain.");
    expect(a.core.isRunning(a.chat.id)).toBe(true);
  } finally { await Promise.all([a.core.close(), b.core.close(), work]); }
});

test("close during connection startup awaits the turn and prevents checkpoint/provider writes", async () => {
  let release!: (connected: Connected | null) => void;
  let entered!: () => void;
  const enteredConnection = new Promise<void>((resolve) => { entered = resolve; });
  const connection = new Promise<Connected | null>((resolve) => { release = resolve; });
  let sent = 0;
  const s = await scene(() => { entered(); return connection; });
  const work = s.core.runTurn(s.input, s.emit);
  await enteredConnection;
  let closed = false;
  const closing = s.core.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release({ provider: { id: "conn", async send() { sent++; return { content: "late", finish_reason: "stop", raw: {} }; } }, kind: "openrouter", context: 32_000 });
  await Promise.all([work, closing]);
  expect(sent).toBe(0);
  expect(await s.messages()).toHaveLength(1);
  expect(await s.chats.resumeIncomplete()).toEqual([]);
  expect(s.core.isRunning(s.chat.id)).toBe(false);
  const error = await s.core.runTurn(s.input, s.emit).then(() => null, (e: Error) => e);
  expect(error?.message).toContain("closed");
});

test("the reusable API sends the canonical engine's request and commits the same reply", async () => {
  const desktop = await scene(), terminal = await scene();
  await runTurn({ ...desktop.deps, runtime: createTurnRuntime() }, desktop.input, desktop.emit);
  await terminal.core.runTurn(terminal.input, terminal.emit);
  expect(terminal.requests).toEqual(desktop.requests);
  expect(await terminal.messages()).toEqual(await desktop.messages());
  await Promise.all([desktop.core.close(), terminal.core.close()]);
});

test("a turn carries its trusted commit fence across a paused provider and refuses a stale commit", async () => {
  let release!: () => void, entered!: () => void;
  const providerGate = new Promise<void>((resolve) => { release = resolve; });
  const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
  let live = true;
  const s = await scene(async () => ({
    provider: { id: "conn", async send() { entered(); await providerGate; return { content: "Must not commit.", finish_reason: "stop", raw: {} }; } },
    kind: "openrouter", context: 32_000,
  }), (context) => {
    expect(context.packageId).toBe("bunzai.extension.test");
    if (!live) throw new Error("extension commit fence is stale");
  });
  const commit: ExtensionCommitContext = {
    owner: "runtime-owner", epoch: 7, packageId: "bunzai.extension.test", packageDigest: "a".repeat(64),
    policyFingerprint: "b".repeat(64), grantRevision: 3, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: s.chat.id }], fields: [], methods: [], destinations: [] }, now: () => 1_000,
  };
  const work = s.core.runTurn(s.input, s.emit, commit);
  try {
    await providerEntered;
    live = false;
    release();
    await work;
    expect(await s.messages()).toHaveLength(1);
    expect((await s.chats.resumeIncomplete()).map(({ content }) => content)).toEqual([""]);
    expect(s.events.some((event) => event.type === "done")).toBe(false);
  } finally {
    release();
    await s.core.close();
  }
});

test("an extension turn remains admitted until its approved after-turn jobs settle", async () => {
  let entered!: () => void, release!: () => void;
  const jobStarted = new Promise<void>((resolve) => { entered = resolve; });
  const jobGate = new Promise<void>((resolve) => { release = resolve; });
  const s = await scene(undefined, () => undefined);
  const core = createRoleplayCore({ ...s.deps, afterEvent: async (_input, event) => {
    if (event.type !== "done") return;
    entered();
    await jobGate;
  } });
  const commit: ExtensionCommitContext = {
    owner: "runtime-owner", epoch: 9, packageId: "bunzai.extension.test", packageDigest: "a".repeat(64),
    policyFingerprint: "b".repeat(64), grantRevision: 3, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: s.chat.id }], fields: [], methods: [], destinations: [] }, now: () => 1_000,
  };
  let settled = false;
  const work = core.runTurn(s.input, s.emit, commit).then(() => { settled = true; });
  try {
    await jobStarted;
    expect(settled).toBe(false);
  } finally {
    release();
    await work;
    await core.close();
  }
  expect(settled).toBe(true);
});

test("package state written during a provider pause stays on the checkpoint and commits with that reply", async () => {
  let release!: () => void, entered!: () => void;
  const providerGate = new Promise<void>((resolve) => { release = resolve; });
  const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
  const s = await scene(async () => ({
    provider: { id: "conn", async send() { entered(); await providerGate; return { content: "The reply commits.", finish_reason: "stop", raw: {} }; } },
    kind: "openrouter", context: 32_000,
  }), () => undefined);
  const turnCommit: ExtensionCommitContext = {
    owner: "runtime-owner", epoch: 10, packageId: "bunzai.extension.test", packageDigest: "a".repeat(64),
    policyFingerprint: "b".repeat(64), grantRevision: 3, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: s.chat.id }, { kind: "host-connection", id: "conn" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:conn"] }, now: () => 1_001,
  };
  const stateCommit: ExtensionCommitContext = {
    ...turnCommit, operation: "state.write.apply",
    access: { resources: [{ kind: "scene", id: s.chat.id }, { kind: "take", id: s.chat.activeBranchId }], fields: ["state"], methods: [], destinations: [] },
  };
  const work = s.core.runTurn(s.input, s.emit, turnCommit);
  try {
    await providerEntered;
    const turnId = s.events.find((event): event is Extract<TurnEvent, { type: "start" }> => event.type === "start")?.turnId;
    if (!turnId) throw new Error("turn checkpoint was not opened");
    expect(await s.chats.appendPendingExtensionDeltas(turnId, stateCommit.packageId, s.input.expectedVersion,
      [{ slot: "ext:bunzai.extension.test:notes", path: ["draft"], value: "approved", at: 1_001 }], stateCommit)).toBe(true);
    release();
    await work;
    expect(await s.chats.sceneState(s.chat.activeBranchId)).toMatchObject({ "ext:bunzai.extension.test:notes": { draft: { value: "approved" } } });
  } finally {
    release();
    await work;
    await s.core.close();
  }
});

test("an extension provider guard blocks an unreviewed fallback connection before its send", async () => {
  let fallbackSends = 0;
  const primary: Provider = { id: "conn", async send() { throw new ProviderError("temporary", { category: "service_unavailable", code: "service_unavailable", status: 503 }); } };
  const fallback: Provider = { id: "fallback", async send() { fallbackSends++; return { content: "unreviewed", finish_reason: "stop", raw: {} }; } };
  const s = await scene(async (connection) => ({ provider: connection.id === "conn" ? primary : fallback, kind: "openrouter", context: 32_000 }));
  const attempted: string[] = [];
  const guard: ProviderRequestGuard = async (connection, request, _io, send) => {
    attempted.push(`${connection.id}:${connection.model}:${request.model}`);
    if (connection.id !== "conn" || connection.model !== "model" || request.model !== "model") throw new Error("fallback is not in the review");
    return send(request);
  };
  try {
    await s.core.runTurn({ ...s.input, fallback: { id: "fallback", model: "other-model" } }, s.emit, undefined, guard);
    expect(fallbackSends).toBe(0);
    expect(attempted).toContain("fallback:other-model:other-model");
  } finally { await s.core.close(); }
});

test("close during checkpoint creation never starts a narrator or Director call", async () => {
  const s = await scene();
  await s.chats.setProps(s.chat.id, { on: [DIRECTOR_PROP_ID] });
  let entered!: () => void, release!: () => void;
  const checkpoint = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const begin = s.chats.beginTurn.bind(s.chats);
  s.chats.beginTurn = async (...args) => { const result = await begin(...args); entered(); await gate; return result; };
  const work = s.core.runTurn(s.input, s.emit);
  await checkpoint;
  const closing = s.core.close();
  release();
  await Promise.all([work, closing]);
  expect(s.requests).toHaveLength(0);
  expect(s.events.map((e) => e.type)).toEqual(["stopped"]);
  expect(await s.chats.resumeIncomplete()).toEqual([]);
});

test("closed cores refuse recovery mutations and leave checkpoints intact", async () => {
  const s = await scene();
  const abandoned = (await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" }))!;
  await s.chats.saveCheckpoint(abandoned.id, { content: "Keep for the next open." });
  await s.core.close();
  for (const operation of [() => s.core.resume(s.chat.id), () => s.core.commitAnyway(s.chat.id, abandoned.id), () => s.core.discardWaiting(s.chat.id, abandoned.id)]) {
    const error = await operation().then(() => null, (e: Error) => e);
    expect(error?.message).toContain("closed");
  }
  expect(await s.messages()).toHaveLength(1);
  expect((await s.chats.resumeIncomplete()).map((c) => c.content)).toEqual(["Keep for the next open."]);
});

test("close awaits a recovery write admitted before shutdown", async () => {
  const s = await scene();
  const abandoned = (await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" }))!;
  await s.chats.saveCheckpoint(abandoned.id, { content: "Recovered." });
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const commit = s.chats.commitTurn.bind(s.chats);
  s.chats.commitTurn = async (...args) => { entered(); await gate; return commit(...args); };
  const recovering = s.core.resume(s.chat.id);
  await writing;
  let closed = false;
  const closing = s.core.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  expect(await recovering).toBe(1);
  await closing;
  expect((await s.messages()).at(-1)?.swipes[0]?.content).toBe("Recovered.");
});

test("a host hook that initiates shutdown is registered before its code runs", async () => {
  const s = await scene();
  await s.core.close();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let closing: Promise<void> | undefined;
  let closed = false;
  const core = createRoleplayCore({ ...s.deps, afterEvent: async (_input, event) => {
    if (event.type !== "done") return;
    closing = core.close().then(() => { closed = true; });
    entered();
    await gate;
  } });
  const work = core.runTurn(s.input, s.emit);
  await started;
  await work;
  await Bun.sleep(0);
  expect(closed).toBe(false);
  release();
  await closing;
  expect(closed).toBe(true);
});

test("the headless API bundles for the browser without a host runtime", async () => {
  const build = await Bun.build({ entrypoints: [import.meta.dir + "/rp-core.ts"], target: "browser" });
  expect(build.logs).toEqual([]);
  expect(build.success).toBe(true);
});

test("recovery cannot touch a live checkpoint whose asynchronous startup has not returned", async () => {
  const s = await scene();
  let entered!: (id: string) => void, release!: () => void;
  const starting = new Promise<string>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const begin = s.chats.beginTurn.bind(s.chats);
  s.chats.beginTurn = async (...args) => { const checkpoint = await begin(...args); entered(checkpoint!.id); await gate; return checkpoint; };
  const work = s.core.runTurn(s.input, s.emit);
  try {
    const id = await starting;
    expect(await s.core.resume(s.chat.id)).toBe(0);
    expect(await s.core.commitAnyway(s.chat.id, id)).toBeNull();
    expect(await s.core.discardWaiting(s.chat.id, id)).toBe(false);
    expect((await s.chats.resumeIncomplete()).map((c) => c.id)).toEqual([id]);
    release();
    await work;
    expect(s.requests).toHaveLength(1);
    expect((await s.messages()).at(-1)?.swipes[0]?.content).toBe("Rain soon.");
  } finally { release(); await work; await s.core.close(); }
});

test("after startup, a live take does not prevent recovery of another take's abandoned reply", async () => {
  const s = await scene();
  const abandoned = (await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" }))!;
  await s.chats.saveCheckpoint(abandoned.id, { content: "Recover the other take." });
  const user = (await s.messages())[0]!;
  const take = (await s.chats.fork(s.chat.activeBranchId, user.id))!;
  const version = (await s.chats.readMessages(take.id, { limit: 1 })).branchVersion!;
  const work = s.core.runTurn({ ...s.input, expectedVersion: version, inspect: true }, s.emit);
  try {
    await Promise.race([s.review, work.then(() => { throw new Error(JSON.stringify(s.events)); })]);
    expect(await s.core.resume(s.chat.id)).toBe(1);
    expect(s.core.isRunning(s.chat.id)).toBe(true);
    const recovered = await s.chats.readMessages(s.chat.activeBranchId, { limit: 20 });
    expect(recovered.messages.at(-1)?.swipes[0]?.content).toBe("Recover the other take.");
  } finally { await s.core.close(); await work; }
});
