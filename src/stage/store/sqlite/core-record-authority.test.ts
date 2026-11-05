/** Real encrypted SQLite Core writes recheck live extension authority at commit. */
import { afterEach, expect, test } from "bun:test";
import { Engine } from "rp-core";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommitContext, StoredExtensionControl } from "../../contracts/extension-store";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { sqliteChatStore } from "../sqlite-chat-store";
import { sqliteExtensionStore } from "./extension-store";
import { sqliteCoreRecordStore } from "./core-record-store";
import { freshDatabase, testCipher } from "./test-support";
import { openStageDatabase, type StageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";
import { makeRig, type Rig } from "../fake-snapshot-rig";
import { resolveCoreScene } from "../../../studio/core-scene";
import { coreWriteGuard } from "../../../ui/server-core-guard";

const opened: StageDatabase[] = [];
const roots: string[] = [], rigs: Rig[] = [];
afterEach(() => { for (const rig of rigs.splice(0)) rig.close(); for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const db = freshDatabase(opened), cipher = testCipher(), now = () => 1_000;
  const chats = sqliteChatStore(db, cipher, now), records = sqliteCoreRecordStore(db, cipher, now);
  const chat = await chats.createChat({ title: "Fixture", cast: CAST, snapshot: SNAP });
  const home = mkdtempSync(join(tmpdir(), "core-authority-")); roots.push(home);
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  const session = await engine.createSession({ character: { name: "Fixture", description: "Guide", greetings: ["Hello"] } });
  const sessionId = session.id; await engine.close();
  await records.link(chat.id, sessionId, chat.activeBranchId);
  const extensions = sqliteExtensionStore(db, cipher, now);
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", now(), 30_000);
  if (!lease) throw new Error("missing fixture lease");
  const access = { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: chat.activeBranchId }], fields: ["message.content"], methods: [], destinations: [] };
  const control: StoredExtensionControl = { id: "fixture.core", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "messages.send", ...access, duration: "persistent", budget: { requests: 10, bytes: 10_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  await extensions.compareAndSaveControl(control, -1, lease);
  const commit: ExtensionCommitContext & { invocationId: string } = { ...lease, packageId: control.id, packageDigest: control.packageDigest,
    policyFingerprint: control.policyFingerprint, grantRevision: 1, operation: "messages.send", access, now, invocationId: "receipt-core-1" };
  return { db, cipher, chats, records, chat, sessionId, extensions, control, lease, commit };
}
async function acceptedMessage(f: Awaited<ReturnType<typeof fixture>>) {
  const scoped = f.records.forExtension(f.commit, { operationId: f.commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
  const lease = await scoped.acquire(f.sessionId);
  const rows = (await Array.fromAsync(f.records.read(f.sessionId))).filter((row) => row.t !== "session");
  const throughSeq = rows.length + 1;
  try { await scoped.append(lease, [{ t: "msg", seq: throughSeq, ts: "2026-10-31T12:00:00Z", id: "feed0001", parent: null, role: "user", blocks: [{ k: "text", text: "committed message" }] }], true); }
  finally { await lease.release(); }
  return { operationId: f.commit.invocationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId, coreMessageId: "feed0001", throughSeq, role: "user" as const, content: "committed message", expectedVersion: 1 };
}

test("revocation while a Core append waits prevents journal writes but permits lease cleanup", async () => {
  const f = await fixture();
  const scoped = f.records.forExtension(f.commit, { operationId: f.commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
  const lease = await scoped.acquire(f.sessionId);
  const previous = f.db.statement("SELECT COUNT(*) AS n FROM core_entries").get();
  let unblock!: () => void, entered!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const original = f.db.patiently;
  let hold = true;
  f.db.patiently = async (work, limit) => { if (hold) { hold = false; entered(); await gate; } return original(work, limit); };
  const rows = (await Array.fromAsync(f.records.read(f.sessionId))).filter((row) => row.t !== "session");
  const append = scoped.append(lease, [{ t: "msg", seq: rows.length + 1, ts: "2026-10-31T12:00:00Z", id: "feed0001", parent: null, role: "user", blocks: [{ k: "text", text: "must not commit" }] }], true).then(() => null, (error: unknown) => error);
  await reached;
  await f.extensions.compareAndSaveControl({ ...f.control, enabled: false, revision: 1 }, 0, f.lease);
  unblock();
  expect(await append).toBeInstanceOf(Error);
  expect(f.db.statement("SELECT COUNT(*) AS n FROM core_entries").get()).toEqual(previous);
  await lease.release();
  const again = await f.records.acquire(f.sessionId); await again.release();
});

test("an unlinked extension birth is durable before Core rows and remains distinguishable from legacy", async () => {
  const f = await fixture();
  const characterId = f.chat.cast.character.id;
  const birthResources = [{ kind: "character", id: characterId }, ...(CAST.persona ? [{ kind: "persona", id: CAST.persona.id }] : [])];
  const createGrant = { operation: "scenes.create", resources: birthResources, fields: ["scene.create"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 10_000, tokens: 0 } };
  await f.extensions.compareAndSaveControl({ ...f.control, revision: 1, grants: [...f.control.grants, createGrant] }, 0, f.lease);
  const invocationId = "birth-before-core-journal";
  const commit: ExtensionCommitContext = { ...f.lease, packageId: f.control.id, packageDigest: f.control.packageDigest, policyFingerprint: f.control.policyFingerprint,
    grantRevision: 1, operation: "scenes.create", invocationId, access: { resources: birthResources, fields: ["scene.create"], methods: [], destinations: [] }, now: () => 1_000 };
  if (!f.chats.createCoreChat) throw new Error("SQLite ChatStore lacks Core extension creation");
  const created = await f.chats.createCoreChat({ title: "Core birth pending", cast: CAST, snapshot: SNAP }, commit);
  expect(await f.records.sceneFor(created.id)).toBeNull();
  expect(await f.records.pendingCreation(created.id)).toBeNull();
  expect(await f.records.unlinkedBirth(created.id)).toEqual({ origin: "extension", operationId: invocationId, packageId: f.control.id });
  expect(await resolveCoreScene(f.records, created.id)).toEqual({ link: null, incomplete: true });
  expect((await coreWriteGuard("/api/chats/send", { chatId: created.id }, f.records))?.status).toBe(409);
  expect((await coreWriteGuard("/api/chats/turn", { chatId: created.id }, f.records))?.status).toBe(409);
  expect((await coreWriteGuard("/api/chats/connection", { chatId: created.id }, f.records))?.status).toBe(409);
});

test("legacy SQLite extension scene creation remains unmarked and writable", async () => {
  const f = await fixture();
  const resources = [{ kind: "character", id: CAST.character.id }, ...(CAST.persona ? [{ kind: "persona", id: CAST.persona.id }] : [])];
  const grant = { operation: "scenes.create", resources, fields: ["scene.create"], methods: [], destinations: [], duration: "persistent" as const,
    budget: { requests: 10, bytes: 10_000, tokens: 0 } };
  await f.extensions.compareAndSaveControl({ ...f.control, revision: 1, grantRevision: 2, grants: [grant] }, 0, f.lease);
  const commit: ExtensionCommitContext = { ...f.lease, packageId: f.control.id, packageDigest: f.control.packageDigest, policyFingerprint: f.control.policyFingerprint,
    grantRevision: 2, operation: "scenes.create", invocationId: "legacy-scene-create", access: { resources, fields: ["scene.create"], methods: [], destinations: [] }, now: () => 1_000 };
  const chat = await f.chats.createChat({ title: "Legacy extension scene", cast: CAST, snapshot: SNAP }, commit);
  expect(await f.records.unlinkedBirth(chat.id)).toBeNull();
  const branch = (await f.chats.listBranches(chat.id))[0]!;
  expect(await f.chats.appendMessages(branch.id, [{ role: "user", content: "legacy append" }], { expectedVersion: branch.version })).toBeTruthy();
  expect((await f.chats.readMessages(branch.id, { limit: 1 })).messages[0]?.swipes[0]?.content).toBe("legacy append");
});

test("first-party Core birth and initial header link commit through one trusted store create", async () => {
  const f = await fixture();
  if (!f.chats.createCoreChat) throw new Error("SQLite ChatStore lacks Core-first creation");
  const chat = await f.chats.createCoreChat({ title: "Host Core birth", cast: CAST, snapshot: SNAP });
  const birth = await f.records.unlinkedBirth(chat.id);
  if (!birth) throw new Error("host Core birth marker is missing");
  expect(birth).toMatchObject({ origin: "host", operationId: `host:create:${chat.id}` });
  expect(await f.records.unlinkedBirthForBranch(chat.activeBranchId)).toMatchObject({ sceneId: chat.id, origin: "host" });
  const home = mkdtempSync(join(tmpdir(), "core-host-birth-")); roots.push(home);
  const engine = await Engine.openWithRecordStore({ home, recordStore: f.records.forHostSceneCreation(chat.id, chat.activeBranchId), lane: "manual" });
  try { await engine.createSession({ character: { name: "Fixture", description: "Guide", greetings: ["Hello"] } }); }
  finally { await engine.close(); }
  const linked = await f.records.sceneFor(chat.id);
  expect(linked).toMatchObject({ branchId: chat.activeBranchId });
  expect(await f.records.unlinkedBirth(chat.id)).toBeNull();
  expect(f.db.statement("SELECT origin FROM core_scene_creation_bindings WHERE chat_id = ?").get(chat.id)).toEqual({ origin: "host" });
  expect(f.db.statement("SELECT COUNT(*) AS n FROM core_operation_projections WHERE operation_hash = ?").get(f.cipher.index(birth.operationId))).toEqual({ n: 1 });
});

test("an unrelated valid scene read grant cannot write Core journal entries", async () => {
  const f = await fixture();
  const readGrant = { operation: "scenes.read", resources: [{ kind: "scene", id: f.chat.id }], fields: ["scene.connection"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 10_000, tokens: 0 } };
  await f.extensions.compareAndSaveControl({ ...f.control, revision: 1, grantRevision: 2, grants: [...f.control.grants, readGrant] }, 0, f.lease);
  const commit: ExtensionCommitContext = { ...f.lease, packageId: f.control.id, packageDigest: f.control.packageDigest, policyFingerprint: f.control.policyFingerprint,
    grantRevision: 2, operation: "scenes.read", invocationId: "read-only-operation", access: { resources: readGrant.resources, fields: readGrant.fields, methods: [], destinations: [] }, now: () => 1_000 };
  const scoped = f.records.forExtension(commit, { operationId: "read-only-operation", sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
  const lease = await scoped.acquire(f.sessionId);
  const rows = (await Array.fromAsync(f.records.read(f.sessionId))).filter((row) => row.t !== "session");
  const previous = f.db.statement("SELECT COUNT(*) AS n FROM core_entries").get();
  try {
    await expect(scoped.append(lease, [{ t: "msg", seq: rows.length + 1, ts: "2026-10-31T12:00:00Z", id: "readwrite01", parent: null, role: "user", blocks: [{ k: "text", text: "must be refused" }] }], true)).rejects.toThrow("cannot write the RP-Core journal");
  } finally { await lease.release(); }
  expect(f.db.statement("SELECT COUNT(*) AS n FROM core_entries").get()).toEqual(previous);
});

test("Core message edits require the descriptor's exact take and complete field grant", async () => {
  const required = ["message.seq", "message.id", "message.content"];
  for (const access of [
    { resources: [{ kind: "scene", id: "scene" }], fields: required },
    { resources: [{ kind: "scene", id: "scene" }, { kind: "take", id: "take" }], fields: required.slice(1) },
  ]) {
    const f = await fixture();
    const scopedAccess = { ...access, resources: access.resources.map((resource) => ({ ...resource, id: resource.kind === "scene" ? f.chat.id : f.chat.activeBranchId })), methods: [], destinations: [] };
    const control = { ...f.control, revision: 1, grantRevision: 2, grants: [{ ...f.control.grants[0]!, operation: "messages.edit.apply", ...scopedAccess }] };
    await f.extensions.compareAndSaveControl(control, 0, f.lease);
    const commit = { ...f.commit, operation: "messages.edit.apply", invocationId: "receipt-edit", grantRevision: 2, access: scopedAccess };
    const scoped = f.records.forExtension(commit, { operationId: commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
    const lease = await scoped.acquire(f.sessionId);
    const rows = (await Array.fromAsync(f.records.read(f.sessionId))).filter((row) => row.t !== "session");
    await expect(scoped.append(lease, [{ t: "msg", seq: rows.length + 1, ts: "2026-10-31T12:00:00Z", id: "edit-denied", parent: null, role: "user", blocks: [{ k: "text", text: "must be refused" }] }], true)).rejects.toThrow("broker-resolved resource or field scope");
    await lease.release();
    expect(f.db.statement("SELECT COUNT(*) AS n FROM core_entries").get()).toEqual({ n: rows.length });
  }
});

test("accepted journal projection repairs after revocation atomically and replays without duplicate messages", async () => {
  const f = await fixture(), input = await acceptedMessage(f);
  expect(await f.records.pendingProjection(f.sessionId)).toMatchObject([{ operationId: input.operationId, lastSeq: input.throughSeq, projectedSeq: 0, linked: true }]);
  await f.extensions.compareAndSaveControl({ ...f.control, enabled: false, revision: 1 }, 0, f.lease);
  expect((await Array.fromAsync(f.records.projectionEntries(input.operationId))).map((entry) => entry.t === "msg" ? entry.id : entry.t)).toEqual([input.coreMessageId]);
  if (!f.chats.projectCoreMessage) throw new Error("SQLite lacks atomic Core projection");
  const id = await f.chats.projectCoreMessage(input);
  expect(await f.chats.projectCoreMessage(input)).toBe(id);
  expect(await f.records.messageFor(f.sessionId, input.coreMessageId, input.takeId)).toBe(id);
  expect((await f.chats.readMessages(input.takeId, { limit: 10 })).messages.map((m) => m.id)).toEqual([id]);
  await f.records.markProjected(input.operationId, input.throughSeq);
  expect(await f.records.pendingProjection(f.sessionId)).toEqual([]);
  expect(f.db.statement("SELECT body_cell FROM core_operation_projections").get()).not.toEqual({ body_cell: expect.stringContaining(f.control.id) });
  const wrong = { ...input, coreMessageId: "dead0000" };
  await expect(f.chats.projectCoreMessage(wrong)).rejects.toThrow("absent");
  await expect(f.records.markProjected(input.operationId, input.throughSeq + 1)).rejects.toThrow("accepted journal range");
});

test("a failed projection callback rolls back its inserted message and can be repaired once", async () => {
  const f = await fixture(), input = await acceptedMessage(f);
  await expect(f.records.projectMessage(input, () => {
    f.db.statement("INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at) VALUES ('partial', ?, 1, 'user', 0, 1)").run(input.takeId);
    throw new Error("projection fault");
  })).rejects.toThrow("projection fault");
  expect(f.db.statement("SELECT id FROM messages WHERE id = 'partial'").get()).toBeNull();
  expect(await f.records.messageFor(input.sessionId, input.coreMessageId, input.takeId)).toBeNull();
  if (!f.chats.projectCoreMessage) throw new Error("SQLite lacks atomic projection");
  expect(await f.chats.projectCoreMessage(input)).toBeString();
});

test("scene-scoped turns need no invented take grant and immutable targets are checked again inside SQL", async () => {
  const f = await fixture();
  const access = { resources: [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "fixture-provider" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: [] };
  const control = { ...f.control, revision: 1, grants: [{ ...f.control.grants[0]!, operation: "turns.start", ...access }] };
  await f.extensions.compareAndSaveControl(control, 0, f.lease);
  const target = { operationId: f.commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId };
  const scoped = f.records.forExtension({ ...f.commit, operation: "turns.start", access }, target);
  const lease = await scoped.acquire(f.sessionId);
  target.sessionId = "another-session";
  const rows = (await Array.fromAsync(scoped.read(f.sessionId))).filter((row) => row.t !== "session");
  await scoped.append(lease, [{ t: "name", seq: rows.length + 1, ts: "2026-10-31T12:00:00Z", title: "accepted" }], true);
  f.db.statement("DELETE FROM core_scene_links WHERE chat_id = ?").run(f.chat.id);
  const failed = await scoped.append(lease, [{ t: "name", seq: rows.length + 2, ts: "2026-10-31T12:00:00Z", title: "must not commit" }], true).then(() => null, (error: unknown) => error);
  expect(failed).toBeInstanceOf(Error);
  await lease.release();
});

test("snapshot restores committed operation cursors and message mappings with encrypted journal data", async () => {
  const rig = await makeRig(); rigs.push(rig);
  const records = sqliteCoreRecordStore(rig.d, rig.cipher);
  const chat = await rig.chats.createChat({ title: "Snapshot", cast: CAST, snapshot: SNAP });
  const engine = await Engine.openWithRecordStore({ home: rig.dir, recordStore: records, lane: "manual" });
  const session = await engine.createSession({ character: { name: "Fixture", description: "Guide", greetings: [] } });
  const sent = await session.send({ text: "Snapshot message", expectedVersion: await session.version() });
  const sessionId = session.id; await engine.close(); await records.link(chat.id, sessionId, chat.activeBranchId);
  const host = await records.hostProjection(sessionId, 1);
  if (!rig.chats.projectCoreMessage) throw new Error("missing projection");
  const input = { operationId: host.operationId, sessionId, takeId: chat.activeBranchId, coreMessageId: sent.messageId, throughSeq: host.lastSeq, role: "user" as const, content: "Snapshot message", expectedVersion: 1 };
  const messageId = await rig.chats.projectCoreMessage(input);
  const snapshot = await rig.snapshots.take();
  await records.markProjected(host.operationId, host.lastSeq);
  await rig.snapshots.restore(snapshot.id);
  expect(await records.messageFor(sessionId, sent.messageId, chat.activeBranchId)).toBe(messageId);
  expect(await records.pendingProjection(sessionId)).toMatchObject([{ operationId: host.operationId, projectedSeq: 0 }]);
  expect(await rig.chats.projectCoreMessage(input)).toBe(messageId);
});

test("zero-entry committed scene births recover their exact link after revocation without rerunning creation", async () => {
  const f = await fixture();
  const access = { resources: [{ kind: "character", id: CAST.character.id }, ...(CAST.persona ? [{ kind: "persona", id: CAST.persona.id }] : [])], fields: ["scene.create"], methods: [], destinations: [] };
  const control = { ...f.control, revision: 1, grants: [{ ...f.control.grants[0]!, operation: "scenes.create", ...access }] };
  await f.extensions.compareAndSaveControl(control, 0, f.lease);
  const commit = { ...f.commit, operation: "scenes.create", invocationId: "receipt-create", access };
  if (!f.chats.createCoreChat) throw new Error("SQLite ChatStore lacks Core extension creation");
  const born = await f.chats.createCoreChat({ title: "Born", cast: CAST, snapshot: SNAP }, commit);
  const scoped = f.records.forExtension(commit, { operationId: commit.invocationId, sceneId: born.id, takeId: born.activeBranchId, sessionId: null });
  const source = (await Array.fromAsync(f.records.read(f.sessionId)))[0]!;
  if (source.t !== "session") throw new Error("missing header");
  const header = { ...source, id: "birth-session" };
  await scoped.create(header, []);
  expect(await f.records.pendingCreation(born.id)).toMatchObject({ sessionId: header.id, linked: false, operationId: commit.invocationId });
  expect(await f.records.pendingProjection(header.id)).toMatchObject([{ linked: false, firstSeq: 0, lastSeq: 0 }]);
  await f.extensions.compareAndSaveControl({ ...control, enabled: false, revision: 2 }, 1, f.lease);
  await expect(scoped.create({ ...header, id: "revoked-birth" }, [])).rejects.toThrow("authority changed");
  await expect(scoped.link(born.id, header.id, born.activeBranchId)).rejects.toThrow("authority changed");
  await f.records.recoverCreation(commit.invocationId);
  await f.records.recoverCreation(commit.invocationId);
  expect(await f.records.sceneFor(born.id)).toEqual({ sessionId: header.id, branchId: born.activeBranchId });
  expect(await f.records.pendingProjection(header.id)).toEqual([]);
  expect(await f.records.pendingCreation(born.id)).toBeNull();
  expect(f.db.statement("SELECT COUNT(*) AS n FROM core_entries WHERE session_id = ?").get(header.id)).toEqual({ n: 0 });
  await expect(f.records.recoverCreation("never-accepted")).rejects.toThrow("never committed");
});

test("migration 52 preserves a real encrypted version51 Core journal and extension controls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "core-upgrade-")); roots.push(dir);
  const path = join(dir, "library.db"), cipher = testCipher();
  const before = openStageDatabase(path, MIGRATIONS.filter((migration) => migration.id <= 51)); opened.push(before);
  const records = sqliteCoreRecordStore(before, cipher);
  const engine = await Engine.openWithRecordStore({ home: dir, recordStore: records, lane: "manual" });
  const session = await engine.createSession({ character: { name: "Upgrade", description: "Preserve", greetings: ["Sealed greeting"] } });
  const sessionId = session.id; await engine.close();
  const original = before.statement("SELECT entry_cell FROM core_entries ORDER BY seq").all();
  const controls = sqliteExtensionStore(before, cipher, () => 1_000);
  const lease = await controls.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1_000, 30_000);
  if (!lease) throw new Error("missing fixture lease");
  const f = await fixture();
  await controls.compareAndSaveControl(f.control, -1, lease);
  const oldNames = before.statement("SELECT id, name FROM _migrations ORDER BY id").all();
  before.close(); opened.splice(opened.indexOf(before), 1);
  const upgraded = openStageDatabase(path, MIGRATIONS); opened.push(upgraded);
  expect(upgraded.statement("SELECT id, name FROM _migrations WHERE id <= 51 ORDER BY id").all()).toEqual(oldNames);
  expect(upgraded.statement("SELECT entry_cell FROM core_entries ORDER BY seq").all()).toEqual(original);
  expect((await Array.fromAsync(sqliteCoreRecordStore(upgraded, cipher).read(sessionId))).length).toBeGreaterThan(1);
  expect(await sqliteExtensionStore(upgraded, cipher).readControl(f.control.id)).toMatchObject({ enabled: true, revision: 0 });
});

test("greeting and user projection is one atomic batch and replay retains exact message IDs", async () => {
  const f = await fixture(), user = await acceptedMessage(f);
  const rows = await Array.fromAsync(f.records.read(f.sessionId));
  const greeting = rows.find((row) => row.t === "msg" && row.role === "assistant");
  if (!greeting || greeting.t !== "msg" || !f.chats.projectCoreMessages) throw new Error("fixture lacks greeting/batch projection");
  const host = await f.records.hostProjection(f.sessionId, 1);
  const first = { ...user, operationId: host.operationId, throughSeq: host.lastSeq, coreMessageId: greeting.id, role: "assistant" as const, content: "Hello" };
  const second = { ...user, operationId: host.operationId, throughSeq: host.lastSeq };
  await expect(f.chats.projectCoreMessages([first, { ...second, content: "invalid" }])).rejects.toThrow("contents differ");
  expect(await f.chats.countMessages(user.takeId)).toBe(0);
  expect(await f.records.messageFor(user.sessionId, greeting.id, user.takeId)).toBeNull();
  const ids = await f.chats.projectCoreMessages([first, second]);
  expect(await f.chats.projectCoreMessages([first, second])).toEqual(ids);
  expect(await f.chats.countMessages(user.takeId)).toBe(2);
});

test("identical Core siblings retain distinct UI swipe IDs and continue changes only its exact mapped swipe", async () => {
  const f = await fixture();
  if (!f.chats.projectCoreMessage) throw new Error("missing atomic projection");
  let seq = await f.records.journalRevision(f.sessionId);
  const append = async (entry: Parameters<typeof f.records.append>[1][number]) => {
    const lease = await f.records.acquire(f.sessionId);
    try { await f.records.append(lease, [entry], true); } finally { await lease.release(); }
  };
  await append({ t: "msg", seq: ++seq, ts: "2026-10-31T12:00:00Z", id: "aaaa0001", parent: null, role: "assistant", blocks: [{ k: "text", text: "same answer" }] });
  let host = await f.records.hostProjection(f.sessionId, 1);
  const first = { operationId: host.operationId, sessionId: f.sessionId, takeId: f.chat.activeBranchId, coreMessageId: "aaaa0001", throughSeq: host.lastSeq,
    role: "assistant" as const, content: "same answer", expectedVersion: 1 };
  const messageId = await f.chats.projectCoreMessage(first);
  const old = await f.records.messageIdentityFor(f.sessionId, first.coreMessageId, first.takeId);
  await append({ t: "msg", seq: ++seq, ts: "2026-10-31T12:00:01Z", id: "aaaa0002", parent: null, role: "assistant", blocks: [{ k: "text", text: "same answer" }] });
  host = await f.records.hostProjection(f.sessionId, 2);
  const second = { ...first, throughSeq: host.lastSeq, coreMessageId: "aaaa0002", mode: "swipe" as const, targetCoreMessageId: first.coreMessageId, expectedVersion: 2 };
  expect(await f.chats.projectCoreMessage(second)).toBe(messageId);
  const newer = await f.records.messageIdentityFor(f.sessionId, second.coreMessageId, second.takeId);
  expect(newer?.messageId).toBe(old?.messageId);
  expect(newer?.swipeId).not.toBe(old?.swipeId);
  expect(await f.chats.projectCoreMessage(second)).toBe(messageId);
  await append({ t: "edit", seq: ++seq, ts: "2026-10-31T12:00:02Z", target: second.coreMessageId, reason: "continue", blocks: [{ k: "text", text: "same answer continued" }] });
  host = await f.records.hostProjection(f.sessionId, 3);
  const continuation = { ...second, throughSeq: host.lastSeq, mode: "continue" as const, targetCoreMessageId: second.coreMessageId, content: "same answer continued", expectedVersion: 3 };
  expect(await f.chats.projectCoreMessage(continuation)).toBe(messageId);
  expect(await f.chats.projectCoreMessage(continuation)).toBe(messageId);
  const message = (await f.chats.readMessages(second.takeId, { limit: 10 })).messages[0]!;
  expect(message.swipes.map(({ id, content }) => ({ id, content }))).toEqual([
    { id: old!.swipeId, content: "same answer" }, { id: newer!.swipeId, content: "same answer continued" },
  ]);
  expect(await f.chats.swipeHistory(messageId, newer!.swipeId)).toEqual(["same answer"]);
  // A person's edit of a version that is not shown lands on that exact version; the shown one is untouched.
  await append({ t: "edit", seq: ++seq, ts: "2026-10-31T12:00:03Z", target: first.coreMessageId, reason: "user", blocks: [{ k: "text", text: "an earlier version, edited" }] });
  host = await f.records.hostProjection(f.sessionId, 4);
  expect(await f.chats.projectCoreMessage({ ...first, throughSeq: host.lastSeq, mode: "edit", content: "an earlier version, edited", expectedVersion: 4 })).toBe(messageId);
  const edited = (await f.chats.readMessages(second.takeId, { limit: 10 })).messages[0]!;
  expect(edited.current).toBe(1);
  expect(edited.swipes.map(({ id, content }) => ({ id, content }))).toEqual([
    { id: old!.swipeId, content: "an earlier version, edited" }, { id: newer!.swipeId, content: "same answer continued" },
  ]);
  f.db.statement("DELETE FROM swipes WHERE message_id = ? AND swipe_id = ?").run(messageId, old!.swipeId);
  expect(await f.records.messageIdentityFor(f.sessionId, first.coreMessageId, first.takeId)).toBeNull();
  expect(await f.records.messageIdentityFor(f.sessionId, second.coreMessageId, second.takeId)).toEqual(newer);
});

test("first SQL commit compares the reviewed journal revision and a creation grant cannot adopt an unrelated scene", async () => {
  const f = await fixture(), seq = await f.records.journalRevision(f.sessionId);
  const scoped = f.records.forExtension(f.commit, { operationId: f.commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId, expectedJournalSeq: seq - 1 });
  const lease = await scoped.acquire(f.sessionId);
  await expect(scoped.append(lease, [{ t: "name", seq: seq + 1, ts: "2026-10-31T12:00:00Z", title: "stale" }], true)).rejects.toThrow("reviewed invocation snapshot");
  await lease.release();
  expect(await f.records.pendingProjection(f.sessionId)).toEqual([]);
  const unrelated = await f.chats.createChat({ title: "Unrelated", cast: CAST, snapshot: SNAP });
  const commit = { ...f.commit, operation: "scenes.create", access: { resources: [{ kind: "character", id: CAST.character.id }], fields: ["scene.create"], methods: [], destinations: [] } };
  const changed = { ...f.control, revision: 1, grants: [{ ...f.control.grants[0]!, operation: commit.operation, ...commit.access }] };
  await f.extensions.compareAndSaveControl(changed, 0, f.lease);
  const creating = f.records.forExtension(commit, { operationId: commit.invocationId, sceneId: unrelated.id, takeId: unrelated.activeBranchId, sessionId: null });
  const header = (await Array.fromAsync(f.records.read(f.sessionId)))[0]!;
  if (header.t !== "session") throw new Error("missing header");
  await expect(creating.create({ ...header, id: "unrelated-birth" }, [])).rejects.toThrow("committed scene birth");
});

test("existing message identity batches check the exact take revision and roll back every binding on failure", async () => {
  const f = await fixture(), input = await acceptedMessage(f);
  const message = await f.chats.appendMessage(input.takeId, { role: "user", content: input.content }, { expectedVersion: 1 });
  if (!message) throw new Error("missing projected fixture message");
  const link = { ...input, chatMessageId: message.id, chatSwipeId: message.swipes[0]!.id };
  await expect(f.records.linkMessages([link], 1)).rejects.toThrow("snapshot revision changed");
  expect(await f.records.messageIdentityFor(input.sessionId, input.coreMessageId, input.takeId)).toBeNull();
  await expect(f.records.linkMessages([link, { ...link, coreMessageId: "dead0000" }], 2)).rejects.toThrow("absent");
  expect(await f.records.messageIdentityFor(input.sessionId, input.coreMessageId, input.takeId)).toBeNull();
  await f.extensions.compareAndSaveControl({ ...f.control, enabled: false, revision: 1 }, 0, f.lease);
  await f.records.linkMessages([link], 2);
  expect(await f.records.messageIdentityFor(input.sessionId, input.coreMessageId, input.takeId)).toEqual({ messageId: message.id, swipeId: message.swipes[0]!.id });
});

test("a scoped Core writer cannot upgrade itself into trusted recovery and cancellation cannot commit", async () => {
  const f = await fixture(), controller = new AbortController();
  const scoped = f.records.forExtension({ ...f.commit, signal: controller.signal }, { operationId: f.commit.invocationId, sceneId: f.chat.id, takeId: f.chat.activeBranchId, sessionId: f.sessionId });
  await expect(scoped.hostProjection(f.sessionId, 1)).rejects.toThrow("privileged projection recovery");
  const lease = await scoped.acquire(f.sessionId), seq = await scoped.journalRevision(f.sessionId);
  controller.abort();
  await expect(scoped.append(lease, [{ t: "name", seq: seq + 1, ts: "2026-10-31T12:00:00Z", title: "cancelled" }], true)).rejects.toThrow("cancelled");
  expect(await f.records.journalRevision(f.sessionId)).toBe(seq);
  await lease.release();
});
