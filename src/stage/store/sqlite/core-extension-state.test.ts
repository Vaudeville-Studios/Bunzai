/** Package state crosses the real runtime service and encrypted Core/ChatStore commit boundaries. */
import { afterEach, expect, test } from "bun:test";
import { Engine, type Entry } from "rp-core";
import { makeRig, type Rig } from "../fake-snapshot-rig";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import type { ExtensionCommitContext, StoredExtensionControl } from "../../contracts/extension-store";
import type { CoreStateTurnBinding } from "../../contracts/core-extension-state";
import { sqliteCoreRecordStore } from "./core-record-store";
import { sqliteExtensionStore } from "./extension-store";
import { createExtensionSceneStateServices } from "../../../extensions/runtime/scene-state-services";
import { sqliteChatStore } from "../sqlite-chat-store";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "../../../kit/extensions/owner";
import { sqliteStateStore } from "./state-store";
import { installDom } from "../../../ui/_shared/test-dom";

const rigs: Rig[] = [];
afterEach(() => { for (const rig of rigs.splice(0)) rig.close(); });
async function fixture() {
  const rig = await makeRig(); rigs.push(rig);
  let now = 1_000;
  rig.chats = sqliteChatStore(rig.d, rig.cipher, () => now);
  const records = sqliteCoreRecordStore(rig.d, rig.cipher, () => now);
  const chat = await rig.chats.createChat({ title: "Core state", cast: CAST, snapshot: SNAP });
  const engine = await Engine.openWithRecordStore({ home: rig.dir, recordStore: records, lane: "manual" });
  const session = await engine.createSession({ character: { name: "Fixture", description: "Guide", greetings: [] } });
  const sent = await session.send({ text: "A question", expectedVersion: await session.version() });
  const sessionId = session.id; await engine.close(); await records.link(chat.id, sessionId, chat.activeBranchId);
  const proof = await records.hostProjection(sessionId, 1);
  if (!rig.chats.projectCoreMessage) throw new Error("missing atomic projection");
  const messageId = await rig.chats.projectCoreMessage({ operationId: proof.operationId, sessionId, takeId: chat.activeBranchId, coreMessageId: sent.messageId,
    throughSeq: proof.lastSeq, role: "user", content: "A question", expectedVersion: 1 });
  const scope = [{ kind: "scene", id: chat.id }, { kind: "take", id: chat.activeBranchId }];
  const access = { resources: scope, fields: ["state"], methods: [], destinations: [] };
  const extensions = sqliteExtensionStore(rig.d, rig.cipher, () => now);
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", now, 30_000);
  if (!lease) throw new Error("missing runtime fence");
  const control: StoredExtensionControl = { id: "fixture.state", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "state.write.apply", ...access, duration: "persistent", budget: { requests: 20, bytes: 256_000, tokens: 0 } },
      ...["turns.start", "turns.regenerate"].map((operation) => ({ operation, resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "script" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:script"], duration: "persistent" as const, budget: { requests: 20, bytes: 256_000, tokens: 16_000 } }))],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  await extensions.compareAndSaveControl(control, -1, lease);
  const commit: ExtensionCommitContext = { ...lease, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: 1, operation: "state.write.apply", access, invocationId: "state-receipt-1", now: () => now };
  const delta = [{ slot: `ext:${control.id}:memory`, path: ["saved"], value: "yes", at: now }];
  let active: CoreStateTurnBinding | null = null;
  const service = createExtensionSceneStateServices(rig.chats, async () => true, { ownedTurn: (packageId, sceneId, turnId) =>
    packageId === control.id && sceneId === chat.id && active?.turnId === turnId ? active : null });
  return { rig, records, chat, sessionId, messageId, scope, extensions, control, lease, commit, delta, service,
    setActive(value: CoreStateTurnBinding | null) { active = value; }, tick() { now++; } };
}
async function ownedTurn(f: Awaited<ReturnType<typeof fixture>>, kind: "reply" | "swipe" = "reply") {
  const turnCommit: ExtensionCommitContext = { ...f.commit, invocationId: "turn-receipt", operation: kind === "reply" ? "turns.start" : "turns.regenerate", access: {
    resources: [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "script" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:script"],
  } };
  const scoped = f.records.forExtension(turnCommit, { operationId: turnCommit.invocationId!, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
  const lease = await scoped.acquire(f.sessionId);
  let seq = await f.records.journalRevision(f.sessionId);
  const source = (await Array.fromAsync(f.records.read(f.sessionId))).find((entry) => entry.t === "msg");
  if (!source || source.t !== "msg") throw new Error("missing Core question");
  const binding: CoreStateTurnBinding = { sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId,
    turnId: "turn0001", turnOperationId: turnCommit.invocationId!, kind, expectedVersion: (await f.rig.chats.listBranches(f.chat.id)).find((branch) => branch.id === f.chat.activeBranchId)!.version };
  await scoped.append(lease, [{ t: "turn", seq: ++seq, ts: "2026-10-31T12:00:00Z", turn: binding.turnId, kind, parent: source.id,
    ...(kind === "swipe" ? { target: "aaaa0001" } : {}),
    msgId: "feed0001", seed: 1, now: "2026-10-31T12:00:00Z", base: 1, hostPolicy: "extension-owned" }], true);
  f.setActive(binding);
  const final = (finish: "end" | "stopped" | "interrupted" = "end"): Entry => ({ t: "msg", seq: seq + 1, ts: "2026-10-31T12:00:01Z", id: "feed0001", parent: source.id,
    role: "assistant", turn: binding.turnId, blocks: [{ k: "text", text: "Answer" }], gen: { kind: "model", finish } });
  return { scoped, lease, binding, final, async append(entry: Entry) { await scoped.append(lease, [entry], true); seq = entry.seq; } };
}

test("a Core state write uses the exact committed UI swipe and its existing state fold", async () => {
  const f = await fixture();
  expect(await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { messageId: f.messageId }, 1, f.delta, f.scope, f.commit)).toBe("stale");
  expect(await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { messageId: f.messageId }, 2, f.delta, f.scope, f.commit)).toBe("applied");
  expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${f.control.id}:memory`, value: { saved: "yes" } }]);
});

test("pending owned Core state accepts with the exact message, repairs after revoke, and applies once", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    expect(await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit)).toBe("pending");
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([]);
    await turn.append(turn.final());
    expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toEqual({ phase: "accepted" });
    await f.extensions.compareAndSaveControl({ ...f.control, revision: 1, enabled: false }, 0, f.lease);
    const proof = (await f.records.pendingProjection(f.sessionId)).find((row) => row.operationId === turn.binding.turnOperationId)!;
    if (!f.rig.chats.projectCoreMessage || !f.rig.chats.applyCoreExtensionState) throw new Error("missing Core state projection");
    const messageId = await f.rig.chats.projectCoreMessage({ operationId: proof.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId,
      coreMessageId: "feed0001", throughSeq: proof.lastSeq, role: "assistant", content: "Answer", expectedVersion: 2 });
    await f.rig.chats.applyCoreExtensionState(f.sessionId, "feed0001");
    await f.rig.chats.applyCoreExtensionState(f.sessionId, "feed0001");
    await f.rig.chats.discardCorePendingState?.(turn.binding.turnOperationId, turn.binding.turnId);
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${f.control.id}:memory`, value: { saved: "yes" } }]);
    const identity = await f.records.messageIdentityFor(f.sessionId, "feed0001", f.chat.activeBranchId);
    expect(f.rig.d.statement("SELECT message_id, swipe_id FROM message_deltas WHERE message_id = ?").all(messageId)).toEqual([{ message_id: messageId, swipe_id: identity!.swipeId }]);
    expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toEqual({ phase: "applied" });
  } finally { await turn.lease.release(); }
});

test("revoking only the pending state grant while final Core SQL waits rolls back the message and acceptance", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit);
    const before = await f.records.journalRevision(f.sessionId);
    let unblock!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; }), reached = new Promise<void>((resolve) => { entered = resolve; });
    const original = f.rig.d.patiently; let hold = true;
    f.rig.d.patiently = async (work, limit) => { if (hold) { hold = false; entered(); await gate; } return original(work, limit); };
    const finish = turn.append(turn.final()).then(() => null, (error: unknown) => error);
    await reached;
    await f.extensions.compareAndSaveControl({ ...f.control, revision: 1, grants: f.control.grants.filter((grant) => grant.operation !== "state.write.apply") }, 0, f.lease);
    unblock();
    expect(await finish).toBeInstanceOf(Error);
    expect(await f.records.journalRevision(f.sessionId)).toBe(before);
    expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toEqual({ phase: "staged" });
    await f.rig.chats.discardCorePendingState?.(turn.binding.turnOperationId, turn.binding.turnId);
    expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toBeNull();
  } finally { await turn.lease.release(); }
});

test("stopped and interrupted Core answers discard staged state rather than accepting it", async () => {
  for (const reason of ["stopped", "interrupted"] as const) {
    const f = await fixture(), turn = await ownedTurn(f);
    try {
      await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit);
      await turn.append(turn.final(reason));
      expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toBeNull();
      expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([]);
    } finally { await turn.lease.release(); }
  }
});

test("unknown, other-package and continue turn identities cannot stage Core package state", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    expect(await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 1, f.delta, f.scope, f.commit)).toBe("stale");
    await expect(f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { messageId: f.messageId }, 2, f.delta, f.scope, f.commit)).rejects.toThrow("session is active");
    await expect(f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: "unknown" }, 2, f.delta, f.scope, f.commit)).rejects.toThrow("active Core reply");
    await expect(f.service.write("other.package", f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit)).rejects.toThrow("authority");
    if (!f.rig.chats.stageCoreExtensionState) throw new Error("missing Core pending writer");
    // @ts-expect-error The storage decoder must reject an invalid runtime turn kind too.
    await expect(f.rig.chats.stageCoreExtensionState(f.commit, { ...turn.binding, kind: "continue" }, f.delta)).rejects.toThrow();
    await expect(f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2,
      [{ ...f.delta[0]!, slot: "ext:other.package:memory" }], f.scope, f.commit)).rejects.toThrow("namespace");
    expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toBeNull();
  } finally { await turn.lease.release(); }
});

test("regenerate state follows the new exact swipe while the old swipe retains its own state", async () => {
  const f = await fixture();
  const source = (await Array.fromAsync(f.records.read(f.sessionId))).find((entry) => entry.t === "msg");
  if (!source || source.t !== "msg") throw new Error("missing question");
  const seq = await f.records.journalRevision(f.sessionId), lease = await f.records.acquire(f.sessionId);
  try { await f.records.append(lease, [{ t: "msg", seq: seq + 1, ts: "2026-10-31T12:00:00Z", id: "aaaa0001", parent: source.id,
    role: "assistant", blocks: [{ k: "text", text: "Old answer" }], gen: { kind: "model", finish: "end" } }], true); } finally { await lease.release(); }
  const host = await f.records.hostProjection(f.sessionId, 2);
  if (!f.rig.chats.projectCoreMessage || !f.rig.chats.applyCoreExtensionState) throw new Error("missing projection");
  const messageId = await f.rig.chats.projectCoreMessage({ operationId: host.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId,
    coreMessageId: "aaaa0001", throughSeq: host.lastSeq, role: "assistant", content: "Old answer", expectedVersion: 2 });
  await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { messageId }, 3, [{ ...f.delta[0]!, value: "old" }], f.scope, f.commit);
  const turn = await ownedTurn(f, "swipe");
  try {
    expect(await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 3, f.delta, f.scope, { ...f.commit, invocationId: "regenerate-state" })).toBe("pending");
    await turn.append(turn.final());
    const proof = (await f.records.pendingProjection(f.sessionId)).find((row) => row.operationId === turn.binding.turnOperationId)!;
    expect(await f.rig.chats.projectCoreMessage({ operationId: proof.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId, coreMessageId: "feed0001",
      throughSeq: proof.lastSeq, role: "assistant", content: "Answer", expectedVersion: 3, mode: "swipe", targetCoreMessageId: "aaaa0001" })).toBe(messageId);
    await f.rig.chats.applyCoreExtensionState(f.sessionId, "feed0001");
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${f.control.id}:memory`, value: { saved: "yes" } }]);
    await f.rig.chats.selectSwipe(messageId, 0, { expectedVersion: 4 });
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${f.control.id}:memory`, value: { saved: "old" } }]);
  } finally { await turn.lease.release(); }
});

test("pending Core proposals are bounded and a failed terminal discards them without applying", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    await expect(f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2,
      [{ ...f.delta[0]!, value: "é".repeat(130_000) }], f.scope, f.commit)).rejects.toThrow("buffer limit");
    for (let index = 0; index < 64; index++) await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2,
      f.delta, f.scope, { ...f.commit, invocationId: `state-${index}` });
    await expect(f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, { ...f.commit, invocationId: "one-too-many" })).rejects.toThrow("buffer limit");
    const seq = await f.records.journalRevision(f.sessionId);
    await turn.append({ t: "end", seq: seq + 1, ts: "2026-10-31T12:00:02Z", turn: turn.binding.turnId, outcome: "failed" });
    expect(f.rig.d.statement("SELECT COUNT(*) AS n FROM core_pending_extension_state").get()).toEqual({ n: 0 });
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([]);
  } finally { await turn.lease.release(); }
});

test("snapshot restores accepted pending state and crash repair never replays an unaccepted proposal", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit);
  await turn.append(turn.final()); await turn.lease.release();
  const snapshot = await f.rig.snapshots.take();
  const proof = (await f.records.pendingProjection(f.sessionId)).find((row) => row.operationId === turn.binding.turnOperationId)!;
  if (!f.rig.chats.projectCoreMessage || !f.rig.chats.applyCoreExtensionState) throw new Error("missing state repair");
  const projection = { operationId: proof.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId, coreMessageId: "feed0001", throughSeq: proof.lastSeq,
    role: "assistant" as const, content: "Answer", expectedVersion: 2 };
  await f.rig.chats.projectCoreMessage(projection); await f.rig.chats.applyCoreExtensionState(f.sessionId);
  await f.rig.snapshots.restore(snapshot.id);
  expect(f.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toEqual({ phase: "accepted" });
  await f.extensions.compareAndSaveControl({ ...f.control, enabled: false, revision: 1 }, 0, f.lease);
  await f.rig.chats.projectCoreMessage(projection); await f.rig.chats.applyCoreExtensionState(f.sessionId);
  expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${f.control.id}:memory`, value: { saved: "yes" } }]);

  const abandoned = await fixture(), active = await ownedTurn(abandoned);
  await abandoned.service.write(abandoned.control.id, abandoned.chat.id, abandoned.chat.activeBranchId, { turnId: active.binding.turnId }, 2, abandoned.delta, abandoned.scope, abandoned.commit);
  await active.lease.release();
  await abandoned.rig.chats.applyCoreExtensionState?.(abandoned.sessionId);
  expect(abandoned.rig.d.statement("SELECT phase FROM core_pending_extension_state").get()).toBeNull();
  expect(await abandoned.service.read(abandoned.control.id, abandoned.chat.id, abandoned.chat.activeBranchId, abandoned.scope)).toEqual([]);
});

test("damaged pending data is preserved and refuses Core commit or cleanup", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId, { turnId: turn.binding.turnId }, 2, f.delta, f.scope, f.commit);
    const damaged = f.rig.cipher.seal("core_pending_extension_state.body_cell", JSON.stringify({ unknown: "damaged" }));
    f.rig.d.statement("UPDATE core_pending_extension_state SET body_cell = ?").run(damaged);
    const seq = await f.records.journalRevision(f.sessionId);
    await expect(turn.append(turn.final())).rejects.toThrow();
    await expect(f.rig.chats.discardCorePendingState?.(turn.binding.turnOperationId, turn.binding.turnId)).rejects.toThrow();
    expect(await f.records.journalRevision(f.sessionId)).toBe(seq);
    expect(f.rig.d.statement("SELECT body_cell FROM core_pending_extension_state").get()).toEqual({ body_cell: damaged });
  } finally { await turn.lease.release(); }
});

test("pending assignments keep SQL admission order even when receipt hash order is reversed", async () => {
  const f = await fixture(), turn = await ownedTurn(f);
  try {
    const ids = ["receipt-order-A", "receipt-order-B"];
    const first = f.rig.cipher.index(ids[0]!) > f.rig.cipher.index(ids[1]!) ? ids[0]! : ids[1]!;
    const second = first === ids[0] ? ids[1]! : ids[0]!;
    expect(f.rig.cipher.index(first) > f.rig.cipher.index(second)).toBe(true);
    for (const [invocationId, value] of [[first, "A"], [second, "B"]]) await f.service.write(f.control.id, f.chat.id, f.chat.activeBranchId,
      { turnId: turn.binding.turnId }, 2, [{ ...f.delta[0]!, value }], f.scope, { ...f.commit, invocationId });
    await turn.append(turn.final());
    const proof = (await f.records.pendingProjection(f.sessionId)).find((row) => row.operationId === turn.binding.turnOperationId)!;
    if (!f.rig.chats.projectCoreMessage || !f.rig.chats.applyCoreExtensionState) throw new Error("missing state projection");
    await f.rig.chats.projectCoreMessage({ operationId: proof.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId, coreMessageId: "feed0001",
      throughSeq: proof.lastSeq, role: "assistant", content: "Answer", expectedVersion: 2 });
    await f.rig.chats.applyCoreExtensionState(f.sessionId);
    const expected = [{ slot: `ext:${f.control.id}:memory`, value: { saved: "B" } }];
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual(expected);
    await f.rig.chats.applyCoreExtensionState(f.sessionId);
    expect(await f.service.read(f.control.id, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual(expected);
  } finally { await turn.lease.release(); }
});

test("an actual QuickJS command crosses broker review into exact Core message state", async () => {
  const installedDom = installDom(undefined, { globals: { window: undefined, document: undefined, navigator: undefined } });
  let openedRuntime: Awaited<ReturnType<typeof createTerminalExtensionRuntime>> | undefined;
  try {
    const f = await fixture();
    await f.extensions.removeInstalled(f.control.id, 0, f.lease);
    await f.extensions.releaseRuntimeFence(f.lease);
    let serial = 1;
    const runtime = await createTerminalExtensionRuntime({ store: f.extensions, content: f.rig.library, stateStore: sqliteStateStore(f.rig.d, f.rig.cipher),
    chats: f.rig.chats, storeId: f.rig.dir, wasmBinary: await readTerminalQuickJsWasm(), now: () => 1_000,
      id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`, isCoreScene: async (sceneId) => (await f.records.sceneFor(sceneId)) !== null });
    openedRuntime = runtime;
    const packageId = "demo.core-state";
    const pkg = { manifest: { schemaVersion: 1, id: packageId, version: "1.0.0", name: "Core state fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "state.write.apply", resources: ["scene", "take"], fields: ["state"], methods: [], destinations: [], purpose: "write own scene metadata", required: true }],
      contributions: [{ type: "command" as const, id: "write", label: "Write state", operation: "test.run" }] },
      files: { "main.js": `bunzai.extension.define({commands:{write:async()=>bunzai.call("state.write.apply",${JSON.stringify({ sceneId: f.chat.id, takeId: f.chat.activeBranchId,
        messageId: f.messageId, expectedVersion: 2, deltas: [{ slot: `ext:${packageId}:memory`, path: ["saved"], value: "QuickJS", at: 1_000 }] })})}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "state.write.apply", resources: f.scope, fields: ["state"], methods: [], destinations: [],
      duration: "persistent", budget: { requests: 10, bytes: 256_000, tokens: 0 } }], [], preview.expectedRevision);
    const installed = (await runtime.list()).find((item) => item.id === packageId)!;
    await runtime.enable(packageId, installed.revision);
    let done = false;
    const activation = runtime.activate(packageId, "command", "write", null).then((value) => { done = true; return { ok: true, value }; }, (error: unknown) => { done = true; return { ok: false, error }; });
    for (let index = 0; index < 300 && !done; index++) {
      for (const effect of await runtime.pendingEffects()) await runtime.answerEffect(effect.id, true);
      if (!done) await new Promise((resolve) => setTimeout(resolve, 3));
    }
    expect(await activation).toMatchObject({ ok: true, value: { status: "completed", output: { status: "applied" } } });
    expect(await f.service.read(packageId, f.chat.id, f.chat.activeBranchId, f.scope)).toEqual([{ slot: `ext:${packageId}:memory`, value: { saved: "QuickJS" } }]);
  } finally {
    try { await openedRuntime?.close(); } finally { await installedDom.teardown(); }
  }
});
