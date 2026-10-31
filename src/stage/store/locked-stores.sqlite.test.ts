/**
 * Locked means refused: while the keyring is locked, every store
 * method rejects with LockedError before touching anything, including the ones that need no key
 * (delete, restore, switching branch, purge). Proven by comparing the raw database before and after.
 */
import { afterEach, expect, test } from "bun:test";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import { cellCipher } from "../crypto/cell-cipher";
import { newDataKey, subkeys } from "../crypto/crypto";
import { LockedError } from "../crypto/keyring";
import { createContentStore } from "./content-store";
import { openStageDatabase, type StageDatabase } from "./sqlite/database";
import { sqliteChatStore } from "./sqlite-chat-store";
import { sqliteStateStore } from "./sqlite/state-store";
import { sqliteExtensionStore } from "./sqlite/extension-store";
import { sqliteDocumentBackend } from "./sqlite/document-backend";
import { MIGRATIONS } from "./sqlite/migrations";
import { sha256HexBytes } from "../../core/sha256";

const open: StageDatabase[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
});

/**
 * Every row of every table, as text: if this is unchanged, nothing was written. Prepared and finalized
 * one by one: Bun's `db.query` cache drops statements past about twenty without finalizing them, and
 * the database then refuses to close.
 */
const rowsOf = (d: StageDatabase, sql: string): unknown[] => {
  const prepared = d.db.prepare(sql);
  try {
    return prepared.all();
  } finally {
    prepared.finalize();
  }
};
const snapshot = (d: StageDatabase) =>
  JSON.stringify(
    (rowsOf(d, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") as { name: string }[]).map((t) => [
      t.name,
      rowsOf(d, `SELECT * FROM "${t.name}"`),
    ]),
  );

test("every store method refuses while locked, and nothing in the database changes", async () => {
  const d = openStageDatabase(":memory:", MIGRATIONS);
  open.push(d);
  let locked = false;
  const keys = subkeys(newDataKey());
  const cipher = cellCipher(() => {
    if (locked) throw new LockedError();
    return keys;
  });
  const backend = sqliteDocumentBackend(d, cipher);
  const library = createContentStore(backend);
  const chats = sqliteChatStore(d, cipher);
  const state = sqliteStateStore(d, cipher);
  const extensions = sqliteExtensionStore(d, cipher, () => 1_000);
  const card = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "character",
    id: "vera",
    body: { identity: { name: "Vera" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} },
  };
  await library.save(card);
  await library.delete("character", "vera");
  await library.save({ ...card, id: "mira" });
  const chat = await chats.createChat({ title: "T", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: card } });
  const m = await chats.appendMessage(chat.activeBranchId, { role: "user", content: "hi" });
  const extensionLease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1_000, 30_000);
  if (!extensionLease) throw new Error("extension store fixture lease unavailable");
  const extensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "state.write.apply", resources: [{ kind: "scene", id: chat.activeBranchId }], fields: ["scene.extension-state"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  await extensions.compareAndSaveControl(extensionControl, -1, extensionLease);
  const extensionCommit = { ...extensionLease, packageId: extensionControl.id, packageDigest: extensionControl.packageDigest, policyFingerprint: extensionControl.policyFingerprint,
    grantRevision: extensionControl.grantRevision, operation: "state.write.apply", access: { resources: [{ kind: "scene", id: chat.activeBranchId }], fields: ["scene.extension-state"], methods: [], destinations: [] }, now: () => 1_000 };
  const readVersioned = state.readVersioned;
  const compareAndWrite = state.compareAndWrite;
  if (!readVersioned || !compareAndWrite) throw new Error("fixture state store lacks extension CAS support");
  const gone = await chats.createChat({ title: "Gone", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: card } });
  await chats.deleteChat(gone.id);
  const swipe = m!.swipes[0]!.id;
  const turn = await chats.beginTurn(chat.activeBranchId, { kind: "reply" });

  locked = true;
  const before = snapshot(d);
  const calls: [string, () => Promise<unknown>][] = [
    ["list", () => library.list()],
    ["read", () => library.read("character", "mira")],
    ["backend.summaries", () => backend.summaries()],
    ["backend.rewriteSummary", () => backend.rewriteSummary("character", "mira", 1, { text: "x", derivedVersion: "1" }, 1)],
    ["backend.parts", () => backend.parts("character", "mira")],
    ["save", () => library.save({ ...card, id: "new" })],
    ["delete", () => library.delete("character", "mira")],
    ["restore", () => library.restore("any-grave")],
    ["purge", () => library.purge(Number.MAX_SAFE_INTEGER)],
    ["versions", () => library.versions("character", "mira")],
    ["createChat", () => chats.createChat({ title: "X", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: {} } })],
    ["getChat", () => chats.getChat(chat.id)],
    ["listChats", () => chats.listChats()],
    ["renameChat", () => chats.renameChat(chat.id, "Y")],
    ["deleteChat", () => chats.deleteChat(chat.id)],
    ["chatGraveyard", () => chats.chatGraveyard()],
    ["restoreChat", () => chats.restoreChat(gone.id)],
    ["purgeChats", () => chats.purgeChats(Number.MAX_SAFE_INTEGER)],
    ["listBranches", () => chats.listBranches(chat.id)],
    ["setActiveBranch", () => chats.setActiveBranch(chat.id, chat.activeBranchId)],
    ["fork", () => chats.fork(chat.activeBranchId, m!.id)],
    ["appendMessage", () => chats.appendMessage(chat.activeBranchId, { role: "user", content: "x" })],
    ["readMessages", () => chats.readMessages(chat.activeBranchId, { limit: 5 })],
    ["addSwipe", () => chats.addSwipe(m!.id, { content: "x" })],
    ["selectSwipe", () => chats.selectSwipe(m!.id, 0)],
    ["editSwipe", () => chats.editSwipe(m!.id, swipe, "x")],
    ["swipeHistory", () => chats.swipeHistory(m!.id, swipe)],
    ["setPinned", () => chats.setPinned(m!.id, swipe, true)],
    ["setHidden", () => chats.setHidden(m!.id, true)],
    ["cutSwipe", () => chats.cutSwipe(m!.id, swipe)],
    ["restoreSwipe", () => chats.restoreSwipe(m!.id, swipe)],
    ["swipeGraveyard", () => chats.swipeGraveyard()],
    ["castSnapshot", () => chats.castSnapshot(chat.id)],
    ["castSnapshotVersioned", () => chats.castSnapshotVersioned(chat.id)],
    ["lightCastSnapshot", () => chats.lightCastSnapshot(chat.id)],
    ["castPortraitRef", () => chats.castPortraitRef(chat.id)],
    ["readMessagesBefore", () => chats.readMessagesBefore(chat.activeBranchId, { limit: 5 })],
    ["readMessagesAt", () => chats.readMessagesAt(chat.activeBranchId, [0])],
    ["searchMessages", () => chats.searchMessages(chat.activeBranchId, { words: ["hi"], limit: 5 })],
    ["readMessageSwipe", () => chats.readMessageSwipe(chat.activeBranchId, m!.id, 0)],
    ["selectTranscriptSwipe", () => chats.selectTranscriptSwipe(chat.id, chat.activeBranchId, m!.id, 0)],
    ["countMessages", () => chats.countMessages(chat.activeBranchId)],
    ["appendMessages", () => chats.appendMessages(chat.activeBranchId, [{ role: "user", content: "x" }])],
    ["cutMessages", () => chats.cutMessages(chat.activeBranchId, m!.id, "one")],
    ["restoreCut", () => chats.restoreCut(chat.activeBranchId, "any-cut")],
    ["renameBranch", () => chats.renameBranch(chat.activeBranchId, "Y")],
    ["deleteBranch", () => chats.deleteBranch(chat.activeBranchId)],
    ["branchGraveyard", () => chats.branchGraveyard()],
    ["restoreBranch", () => chats.restoreBranch(chat.activeBranchId)],
    ["setCast", () => chats.setCast(chat.id, { cast: { character: { id: "mira", version: 2 } }, snapshot: { character: card } })],
    ["revertCast", () => chats.revertCast(chat.id)],
    ["setPersona", () => chats.setPersona(chat.id, { persona: null, snapshot: null })],
    ["swipeTrace", () => chats.swipeTrace(m!.id, swipe)],
    ["beginTurn", () => chats.beginTurn(chat.activeBranchId, { kind: "reply" })],
    ["saveCheckpoint", () => chats.saveCheckpoint(turn!.id, { content: "x" })],
    ["commitTurn", () => chats.commitTurn(turn!.id, { content: "x" })],
    ["dropTurn", () => chats.dropTurn(turn!.id)],
    ["resumeIncomplete", () => chats.resumeIncomplete()],
    ["sceneState", () => chats.sceneState(chat.activeBranchId)],
    ["sceneStateBefore", () => chats.sceneStateBefore(chat.activeBranchId, m!.id)],
    ["sceneDeltas", () => chats.sceneDeltas(chat.activeBranchId, m!.id)],
    ["setBranchBase", () => chats.setBranchBase(chat.activeBranchId, [{ slot: "vars", path: ["a"], value: 1, at: 1 }])],
    ["recordMessageDeltas", () => chats.recordMessageDeltas(chat.activeBranchId, m!.id, [{ slot: "vars", path: ["a"], value: 1, at: 1 }])],
    ["recordDeltas", () => chats.recordDeltas(chat.activeBranchId, m!.swipes[0]!.id, [{ slot: "vars", path: ["a"], value: 1, at: 1 }])],
    ["recordExtensionMessageDeltas", () => chats.recordExtensionMessageDeltas(extensionCommit, chat.activeBranchId, m!.id,
      [{ slot: "ext:fixture.extension:state", path: ["value"], value: 1, at: 1 }], { expectedVersion: 0 })],
    ["state.readVersioned", () => readVersioned("collections")],
    ["state.write", () => state.write("collections", "{}")],
    ["state.compareAndWrite", () => compareAndWrite("collections", "{}", -1, extensionCommit)],
    ["extension.readControl", () => extensions.readControl(extensionControl.id)],
    ["extension.compareAndSaveData", () => extensions.compareAndSaveData(extensionControl.id, "prefs", { safe: true }, -1, extensionCommit)],
    ["extension.acquireRuntimeFence", () => extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000002", 1_001, 30_000)],
    ["extension.renewRuntimeFence", () => extensions.renewRuntimeFence(extensionLease, 1_001, 30_000)],
    ["extension.releaseRuntimeFence", () => extensions.releaseRuntimeFence(extensionLease)],
    ["extension.savePackage", () => extensions.savePackage({ digest: sha256HexBytes(new Uint8Array([1])), bytes: new Uint8Array([1]) }, extensionLease)],
    ["extension.readPackage", () => extensions.readPackage("a".repeat(64))],
    ["extension.listControls", () => extensions.listControls()],
    ["extension.compareAndSaveControl", () => extensions.compareAndSaveControl({ ...extensionControl, revision: 1 }, 0, extensionLease)],
    ["extension.readData", () => extensions.readData(extensionControl.id, "prefs")],
    ["extension.listDataKeys", () => extensions.listDataKeys(extensionControl.id, 10)],
    ["extension.deleteData", () => extensions.deleteData(extensionControl.id, "prefs", -1, extensionCommit)],
    ["extension.reserveBudget", () => extensions.reserveBudget({ packageId: extensionControl.id, operation: "state.write.apply", grantRevision: 1, id: "locked-reserve", bytes: 1, tokens: 0 }, { requests: 1, bytes: 1, tokens: 0 }, extensionLease)],
    ["extension.settleBudget", () => extensions.settleBudget(extensionControl.id, "locked-reserve", 0, 0, extensionLease)],
    ["extension.finalizeAbandonedBudget", () => extensions.finalizeAbandonedBudget(extensionControl.id, extensionLease)],
    ["extension.appendReceipt", () => extensions.appendReceipt({ id: "locked-receipt", packageId: extensionControl.id, operation: "state.write.apply", effect: "write", status: "admitted", createdAt: 1_000, resourceCount: 1 }, extensionLease)],
    ["extension.listReceipts", () => extensions.listReceipts(extensionControl.id, null, 10)],
    ["setConnection", () => chats.setConnection(chat.id, { id: "c", model: "m" })],
    ["setPreset", () => chats.setPreset(chat.id, { kind: "preset", id: "p", toggles: {}, samplers: {} })],
    ["setLore", () => chats.setLore(chat.id, { added: [], off: [] })],
    ["setProps", () => chats.setProps(chat.id, { on: [] })],
    ["setOpening", () => chats.setOpening(chat.id, { edits: [{ index: 0, text: "x" }] })],
    ["setPrompting", () => chats.setPrompting(chat.id, { guides: ["g"] })],
    ["setBackdrop", () => chats.setBackdrop(chat.id, { pack: "p", item: "i" })],
    ["setCompendium", () => chats.setCompendium(chat.id, { on: true })],
    ["appendReceipt", () => chats.appendReceipt(chat.id, { branchId: chat.activeBranchId, kind: "filing" })],
    ["settleReceipt", () => chats.settleReceipt("any-receipt", { status: "running" })],
    ["receipt", () => chats.receipt("any-receipt")],
    ["listReceipts", () => chats.listReceipts(chat.id)],
    ["sweepReceipts", () => chats.sweepReceipts(chat.id)],
    ["appendTree", () => chats.appendTree(chat.id, "any-book", {} as never)],
    ["currentTree", () => chats.currentTree(chat.id, "any-book")],
    ["undoTree", () => chats.undoTree(chat.id, "any-book")],
    ["updateParticipants", () => chats.updateParticipants(chat.id, { op: "main", id: null })],
    ["setRegex", () => chats.setRegex(chat.id, { sets: ["x"] })],
    ["setFinalCut", () => chats.setFinalCut(chat.id, { on: true })],
    ["appendFinalCutRerun", () => chats.appendFinalCutRerun("any-message", "any-swipe", { at: 1, ms: 1, before: "", after: "", passes: [] })],
    ["setTracker", () => chats.setTracker(chat.id, "resources", { context: "never" })],
    ["setSummarySettings", () => chats.setSummarySettings(chat.id, { auto: true })],
    ["setSummaryError", () => chats.setSummaryError(chat.id, "x")],
    ["recordExtensionSummaryDeltas", () => chats.recordExtensionSummaryDeltas(extensionCommit, chat.activeBranchId, "any-message", [])],
    ["appendPendingExtensionDeltas", () => chats.appendPendingExtensionDeltas("any-turn", "fixture.extension", 0, [], extensionCommit)],
    ["readSceneSetting", () => chats.readSceneSetting(chat.id, { group: "connection" })],
    ["previewSceneSetting", () => chats.previewSceneSetting(chat.id, { group: "connection" }, { group: "connection", value: { id: "c", model: "m" } })],
    ["applySceneSetting", () => chats.applySceneSetting(chat.id, { group: "connection" }, { group: "connection", value: { id: "c", model: "m" } }, "0".repeat(64), extensionCommit)],
    ["summaryOf", () => chats.summaryOf(chat.activeBranchId)],
    ["setSummary", () => chats.setSummary(chat.activeBranchId, { text: "x", through: 1 })],
    ["setDirectorSettings", () => chats.setDirectorSettings(chat.id, { personality: "the-oracle" })],
    ["archiveDirector", () => chats.archiveDirector(chat.id, { notes: [] })],
    ["getDirector", () => chats.getDirector(chat.id, "any-message")],
    ["putDirector", () => chats.putDirector(chat.id, "any-message", {} as never, { expectedVersion: null })],
    ["getDramaturg", () => chats.getDramaturg(chat.id)],
    ["setDramaturgSettings", () => chats.setDramaturgSettings(chat.id, { temperature: 1 })],
    ["appendDramaturg", () => chats.appendDramaturg(chat.id, [{ role: "user", text: "x" }], { expectedRevision: 0 })],
    ["clearDramaturg", () => chats.clearDramaturg(chat.id)],
    ["setVariant", () => chats.setVariant(chat.id, "storm")],
    ["personaStats", () => chats.personaStats("nuit")],
    ["backfillPersonaStats", () => chats.backfillPersonaStats()],
    ["lastRequest", () => chats.lastRequest(chat.activeBranchId)],
    ["setFavorite", () => chats.setFavorite(chat.id, true)],
    ["listFolders", () => chats.listFolders()],
    ["createFolder", () => chats.createFolder("Heists")],
    ["renameFolder", () => chats.renameFolder("any-folder", "Heists")],
    ["deleteFolder", () => chats.deleteFolder("any-folder")],
    ["setFolder", () => chats.setFolder(chat.id, null)],
    ["globalOps", () => chats.globalOps()],
  ];
  // Every chat store method is on the list, so a new one cannot skip the lock unnoticed.
  const listed = new Set(calls.map(([name]) => name));
  expect(Object.keys(chats).filter((name) => !listed.has(name))).toEqual([]);
  for (const [name, call] of calls) {
    const result = await call().then(
      () => "resolved",
      (error: unknown) => (error instanceof LockedError ? "locked" : String(error)),
    );
    expect(`${name}: ${result}`).toBe(`${name}: locked`);
  }
  expect(snapshot(d)).toBe(before);
});
