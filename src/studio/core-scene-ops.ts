/**
 * The host's own scene operations on a Core scene, outside a turn (CoreTurnOwner wraps each: refused while a
 * turn owns the scene, awaited when the library closes). Each writes rp-core's journal first, then the scene,
 * then checks the projection: takes (one rp-core session each), cuts and their restores, cast changes, and an
 * answer rp-core held.
 */
import { Engine, Refusal } from "rp-core";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import { checkCoreProjection, syncCoreCast } from "./core-scene";
import { reconcileCoreProjection } from "./core-scene-projection";
import type { CoreTurnOwner } from "./core-turn-owner";
import { StudioConflictError, StudioValidationError } from "./errors";
import { WHOLE_BRANCH } from "./scene-branch";

export async function forkCoreTake(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["forkTake"]>[0]): Promise<void> {
  const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
  if (!linked || chat?.activeBranchId !== linked.branchId) throw new StudioConflictError("The scene or its active take changed; reload it and try again.");
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  let sessionId: string;
  try {
    const session = await engine.session(linked.sessionId);
    if (await checkCoreProjection(chats, records, input.sceneId, session) !== input.expectedVersion) throw new StudioConflictError("The scene changed; reload it and try again.");
    const versions = await records.coreMessagesFor(linked.sessionId, linked.branchId, input.messageId);
    const at = (await session.view()).path.find((message) => versions.some((version) => version.coreMessageId === message.id));
    if (!at) throw new StudioValidationError("that message is not part of this scene");
    sessionId = await session.fork({ at: at.id, versions: true });
  } finally { await engine.close(); }
  const take = await chats.fork(linked.branchId, input.messageId, { name: input.name, expectedVersion: input.expectedVersion });
  if (!take) throw new StudioConflictError("that message is gone");
  await records.linkTake(input.sceneId, linked.branchId, take.id, sessionId);
  const forked = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try { await reconcileCoreProjection(chats, records, input.sceneId, sessionId, await forked.session(sessionId)); }
  finally { await forked.close(); }
}

export async function switchCoreTake(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["switchTake"]>[0]): Promise<void> {
  if (!(await chats.listBranches(input.sceneId)).some((take) => take.id === input.takeId)) throw new StudioValidationError("that take is gone");
  if (!await records.activateTake(input.sceneId, input.takeId)) throw new StudioConflictError("that take has no rp-core history to continue from");
  if (!await chats.setActiveBranch(input.sceneId, input.takeId)) throw new StudioConflictError("that take is gone");
}

export async function cutCoreScene(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["cut"]>[0]): Promise<void> {
  const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
  if (!linked || chat?.activeBranchId !== linked.branchId) throw new StudioConflictError("The scene or its active take changed; reload it and try again.");
  let forked: string;
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(linked.sessionId);
    if (await checkCoreProjection(chats, records, input.sceneId, session) !== input.expectedVersion) throw new StudioConflictError("The scene changed; reload it and try again.");
    const versions = await records.coreMessagesFor(linked.sessionId, linked.branchId, input.messageId);
    const path = (await session.view()).path;
    const at = path.findIndex((message) => versions.some((version) => version.coreMessageId === message.id));
    if (at < 0) throw new StudioValidationError("that message is not part of this scene");
    if (input.scope === "one" && at !== path.length - 1) throw new StudioValidationError("only the newest message can be cut on its own here; cut from this message instead");
    if (at === 0) throw new StudioValidationError("the opening message cannot be cut from this scene");
    forked = await session.fork({ at: path[at - 1]!.id, versions: true });
  } finally { await engine.close(); }
  // The take moves onto a session that ends before the cut; the old one keeps the cut for a restore.
  // Relinked first, so a crash leaves a scene ahead of its journal (refused), never cut messages replayed.
  await records.relinkTake(input.sceneId, linked.branchId, forked);
  if (!await chats.cutMessages(linked.branchId, input.messageId, "from", { expectedVersion: input.expectedVersion })) throw new StudioConflictError("that message is gone");
  const take = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try { await reconcileCoreProjection(chats, records, input.sceneId, forked, await take.session(forked)); }
  finally { await take.close(); }
}

export async function restoreCoreCut(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["restoreCut"]>[0]): Promise<void> {
  const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
  if (!linked || chat?.activeBranchId !== linked.branchId) throw new StudioConflictError("The scene or its active take changed; reload it and try again.");
  const all = (await chats.readMessages(linked.branchId, { limit: WHOLE_BRANCH })).messages;
  const end = all.filter((message) => message.cut?.id === input.cutId).sort((a, b) => a.seq - b.seq).at(-1);
  if (!end) throw new StudioValidationError("the Trash no longer holds that cut");
  const kept = (await records.sessionsOfMessage(linked.branchId, end.id)).find((id) => id !== linked.sessionId);
  if (!kept) throw new StudioConflictError("that cut has no rp-core history to put back");
  const inPlace = !all.some((message) => !message.cut && message.seq > end.seq);
  const branchVersion = (await chats.listBranches(input.sceneId)).find((take) => take.id === linked.branchId)?.version;
  if (branchVersion !== input.expectedVersion) throw new StudioConflictError("The scene changed; reload it and try again.");
  if (inPlace) await records.relinkTake(input.sceneId, linked.branchId, kept);
  const back = await chats.restoreCut(linked.branchId, input.cutId, { expectedVersion: input.expectedVersion });
  if (!back) throw new StudioConflictError("the Trash no longer holds that cut");
  // Restored on a new take: that take continues on the session that kept the cut.
  if (!inPlace) await records.linkTake(input.sceneId, linked.branchId, back.branchId, kept);
  const take = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try { await reconcileCoreProjection(chats, records, input.sceneId, kept, await take.session(kept)); }
  finally { await take.close(); }
}

export async function syncCoreSceneCast(chats: ChatStore, records: CoreSceneRecords, home: string, sceneId: string): Promise<void> {
  const linked = await records.sceneFor(sceneId);
  if (!linked) return;
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try { await syncCoreCast(chats, sceneId, await engine.session(linked.sessionId)); }
  finally { await engine.close(); }
}

export async function deleteCoreTake(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["deleteTake"]>[0]): Promise<boolean> {
  if (!(await chats.listBranches(input.sceneId)).some((take) => take.id === input.takeId)) return false;
  if (!await chats.deleteBranch(input.takeId)) return false;
  const chat = await chats.getChat(input.sceneId);
  if (chat && !await records.activateTake(input.sceneId, chat.activeBranchId)) throw new StudioConflictError("the take the scene moved to has no rp-core history");
  return true;
}

export async function resolveCoreHeld(chats: ChatStore, records: CoreSceneRecords, home: string, input: Parameters<CoreTurnOwner["resolveHeld"]>[0]): ReturnType<CoreTurnOwner["resolveHeld"]> {
  const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
  if (!linked || chat?.activeBranchId !== linked.branchId) throw new StudioConflictError("The scene or its active take changed; reload it and try again.");
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(linked.sessionId);
    try {
      if (input.action === "discard") { await session.discard(input.turnId); return { discarded: true as const }; }
      const added = await session.commitAnyway(input.turnId);
      if (added.outcome !== "committed") return null;
    } catch (error) {
      // rp-core refuses an unknown or already settled turn; that reply is simply no longer waiting.
      if (error instanceof Refusal && error.code === "not_found") return null;
      throw error;
    }
    await reconcileCoreProjection(chats, records, input.sceneId, linked.sessionId, session);
    const tail = (await chats.readMessagesBefore(linked.branchId, { limit: 1, liveOnly: true })).messages[0];
    return tail ? { message: tail } : null;
  } finally { await engine.close(); }
}
