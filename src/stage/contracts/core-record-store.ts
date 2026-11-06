/** Invocation-scoped Core persistence and committed-journal projection identities. */
import type { Entry, RecordStore } from "rp-core";
import type { Delta } from "../../core/scene-state/types";
import type { ExtensionCommitContext } from "./extension-store";
import type { Generation } from "./chat-store-messages";
import type { JsonObject } from "./chat-store";

export interface CoreInvocationTarget { operationId: string; sceneId: string; takeId: string; sessionId: string | null; expectedJournalSeq?: number }
export interface CoreProjection {
  operationId: string; sceneId: string; takeId: string; sessionId: string;
  origin: "extension" | "host"; operation: string;
  firstSeq: number; lastSeq: number; projectedSeq: number;
  linked: boolean;
}
export interface CoreSceneBirth { origin: "host" | "extension"; operationId: string; packageId?: string }
export interface CoreMessageLink {
  operationId: string; sessionId: string; takeId: string; coreMessageId: string; chatMessageId: string; throughSeq: number;
  chatSwipeId?: string;
}
export interface CoreMessageIdentity { messageId: string; swipeId: string }
export interface CoreMessageProjection extends Omit<CoreMessageLink, "chatMessageId"> {
  role: "user" | "assistant"; content: string; generation?: Generation; expectedVersion: number;
  mode?: "append" | "swipe" | "continue" | "edit";
  targetCoreMessageId?: string;
  /** The new version's stored trace (rule 15), written with it: what Final Cut did to the reply. Append and swipe only. */
  trace?: JsonObject;
  /** The reply's own scene-state writes (its tools, a Props tracker's tick), stamped on the new version as a turn's are. Append and swipe only. */
  deltas?: readonly Delta[];
}
export interface CoreSceneRecords extends RecordStore {
  link(chatId: string, sessionId: string, branchId: string): Promise<void>;
  sceneFor(chatId: string): Promise<{ sessionId: string; branchId: string } | null>;
  sceneForBranch(branchId: string): Promise<string | null>;
  sceneForMessage(messageId: string): Promise<string | null>;
  /** A new take forked from the scene's linked take: its own session becomes the scene's link (core_take_links). */
  linkTake(chatId: string, fromTakeId: string, takeId: string, sessionId: string): Promise<void>;
  /** Puts a take on another rp-core session (a cut forks it; a restore puts the old one back), the scene's link with it when it is the active take. */
  relinkTake(chatId: string, takeId: string, sessionId: string): Promise<void>;
  /** The rp-core sessions a take's message was projected from, newest link first (a cut message's own session among them). */
  sessionsOfMessage(takeId: string, messageId: string): Promise<string[]>;
  /** Moves the scene's link onto another of its takes; false when that take has no rp-core session. */
  activateTake(chatId: string, takeId: string): Promise<boolean>;
  forExtension(commit: ExtensionCommitContext, target: CoreInvocationTarget): CoreSceneRecords;
  /** Core-first host scene birth: the session row, birth proof and scene link commit together. */
  forHostSceneCreation(sceneId: string, takeId: string): RecordStore;
  /** Durable journal revision, not the engine's message-only session.version(). */
  journalRevision(sessionId: string): Promise<number>;
  pendingProjection(sessionId: string): Promise<CoreProjection[]>;
  /** Stream only accepted durable entries, one row at a time, without guest action replay. */
  projectionEntries(operationId: string): AsyncIterable<Entry>;
  pendingCreation(sceneId: string): Promise<CoreProjection | null>;
  /** An authorized extension birth row that exists before the first Core journal operation commits. */
  unlinkedBirth(sceneId: string): Promise<CoreSceneBirth | null>;
  /** Locate an authorized but unlinked birth from take-only host routes without inventing a Core link. */
  unlinkedBirthForBranch(branchId: string): Promise<(CoreSceneBirth & { sceneId: string }) | null>;
  /** Snapshot a committed host journal only while its visible take revision still matches. */
  hostProjection(sessionId: string, expectedVersion: number): Promise<CoreProjection>;
  /** Finish only the persisted link of an already authorized Core scene birth. */
  recoverCreation(operationId: string): Promise<void>;
  messageFor(sessionId: string, coreMessageId: string, takeId: string): Promise<string | null>;
  messageIdentityFor(sessionId: string, coreMessageId: string, takeId: string): Promise<CoreMessageIdentity | null>;
  /** The reverse of messageIdentityFor: every Core sibling a scene message's versions project from. */
  coreMessagesFor(sessionId: string, takeId: string, messageId: string): Promise<{ coreMessageId: string; swipeId: string }[]>;
  linkMessage(input: CoreMessageLink, expectedVersion: number): Promise<void>;
  linkMessages(inputs: readonly CoreMessageLink[], expectedVersion: number): Promise<void>;
  markProjected(operationId: string, throughSeq: number): Promise<void>;
  /** Trusted synchronous projection callback; its message write and identity commit together. */
  projectMessage(input: CoreMessageProjection, project: (target: CoreMessageIdentity | null) => string): Promise<string>;
  projectMessages(inputs: readonly CoreMessageProjection[], project: (input: CoreMessageProjection, target: CoreMessageIdentity | null) => string): Promise<string[]>;
}
