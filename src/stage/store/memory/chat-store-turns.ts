/**
 * The memory ChatStore's turn half ('s request
 * text): checkpoints, and the commit that stores a reply with its trace, the take's latest request
 * text and the scene-state deltas the turn made (rule 17). Nothing here awaits, so each method is atomic like the rest of
 * the memory store.
 */
import type { ChatStore, Message, TurnCheckpoint, WriteGuard } from "../../contracts/chat-store";
import type { Delta } from "../../../core/scene-state/types";
import { StudioConflictError } from "../../../studio/errors";
import { checkGuard, checkProgress, checkTurnResult, checkTurnTarget } from "../chat-rules";
import { continuedGeneration } from "../continue-rules";
import { checkRerun, traceWithRerun } from "../final-cut-rules";
import { publicMessage, type ChatRecord, type MessageRecord } from "./chat-records";
import type { MemoryState } from "./chat-store-state";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import type { PromptAttachmentInfo } from "../../../core/media/prompt-attachment";
import { requireCommitResource } from "../extension-commit-access";
import { checkExtensionDeltas } from "../scene-state-rules";
import { extensionTurnOwnerOf, sameExtensionTurnOwner } from "../extension-turn-owner";

export interface TurnDeps {
  clock: () => number;
  newId: () => string;
  messages: Map<string, MessageRecord>;
  branchVersion: (branchId: string) => number;
  liveChatOfBranch: (branchId: string) => ChatRecord | null;
  writableMessage: (messageId: string) => MessageRecord | null;
  requireVersion: (branchId: string, expected: number | undefined) => void;
  bump: (branchId: string) => void;
  appendMany: (branchId: string, inputs: unknown, guard: WriteGuard | undefined) => Message[] | null;
  state: Pick<MemoryState, "stamp" | "refresh">;
  authorizeExtensionCommit(context: ExtensionCommitContext): void;
}

type TurnMethods = Pick<
  ChatStore,
  "swipeTrace" | "appendFinalCutRerun" | "beginTurn" | "saveCheckpoint" | "appendPendingExtensionDeltas" | "commitTurn" | "dropTurn" | "resumeIncomplete" | "lastRequest"
>;

export function turnMethods(d: TurnDeps): TurnMethods & { turnOpen(chatId: string): boolean; branchTurnOpen(branchId: string): boolean } {
  const checkpoints = new Map<string, TurnCheckpoint>();
  /** The branch's latest committed reply's request text (rule 22); replaced whole on each commit. */
  const lastRequestOf = new Map<string, { messageId: string; swipeId: string; texts: string[]; files?: PromptAttachmentInfo[] }>();
  /** A checkpoint a caller may see or touch: its branch and chat are live (rule 16). */
  const open = (turnId: string): TurnCheckpoint | null => {
    const c = checkpoints.get(turnId);
    return c && d.liveChatOfBranch(c.branchId) ? c : null;
  };
  return {
    /** Whether a live take of the chat has an open checkpoint (rule 26). */
    turnOpen: (chatId) => [...checkpoints.values()].some((c) => c.chatId === chatId && d.liveChatOfBranch(c.branchId) !== null),
    branchTurnOpen: (branchId) => [...checkpoints.values()].some((c) => c.branchId === branchId && d.liveChatOfBranch(c.branchId) !== null),

    async appendFinalCutRerun(messageId, swipeId, entryRaw) {
      const entry = checkRerun(entryRaw);
      const m = d.messages.get(messageId);
      const swipe = m && d.liveChatOfBranch(m.branchId) ? m.swipes.find((s) => s.id === swipeId) : undefined;
      const next = swipe?.trace ? traceWithRerun(swipe.trace, entry) : null;
      if (!swipe || !next) return false;
      swipe.trace = next;
      return true;
    },

    async swipeTrace(messageId, swipeId) {
      const trace = d.messages.get(messageId)?.swipes.find((s) => s.id === swipeId)?.trace;
      return trace ? structuredClone(trace) : null;
    },

    async beginTurn(branchId, targetRaw, guard, extensionCommit) {
      if (extensionCommit) d.authorizeExtensionCommit(extensionCommit);
      const target = checkTurnTarget(targetRaw);
      const expected = checkGuard(guard);
      const record = d.liveChatOfBranch(branchId);
      if (!record) return null;
      if (target.kind !== "reply") {
        const m = d.writableMessage(target.messageId);
        if (m?.branchId !== branchId || m.role !== "assistant") return null;
      }
      d.requireVersion(branchId, expected);
      if ([...checkpoints.values()].some((c) => c.branchId === branchId)) {
        throw new StudioConflictError("a reply is already in progress on this branch");
      }
      const t = d.clock();
      const turn: TurnCheckpoint = {
        id: d.newId(),
        chatId: record.chat.id,
        branchId,
        kind: target.kind,
        messageId: target.kind === "reply" ? null : target.messageId,
        content: "",
        ...(extensionCommit ? { extensionOwner: extensionTurnOwnerOf(extensionCommit) } : {}),
        baseVersion: d.branchVersion(branchId),
        startedAt: t,
        savedAt: t,
      };
      checkpoints.set(turn.id, turn);
      return structuredClone(turn);
    },

    async saveCheckpoint(turnId, progressRaw, extensionCommit) {
      if (extensionCommit) d.authorizeExtensionCommit(extensionCommit);
      const progress = checkProgress(progressRaw);
      const c = open(turnId);
      if (!c) return null;
      // Omitted fields keep what an earlier save recorded: the request id arrives once, early.
      const next: TurnCheckpoint = {
        ...c,
        content: progress.content,
        ...(progress.trace ? { trace: progress.trace } : {}),
        ...(progress.providerRequestId === undefined ? {} : { providerRequestId: progress.providerRequestId }),
        ...(progress.deltas ? { deltas: [...progress.deltas.filter(({ slot }) => !slot.startsWith("ext:")), ...(c.deltas ?? []).filter(({ slot }) => slot.startsWith("ext:"))] } : {}),
        savedAt: d.clock(),
      };
      checkpoints.set(turnId, next);
      return structuredClone(next);
    },

    async appendPendingExtensionDeltas(turnId, packageId, expectedVersion, deltasRaw, extensionCommit) {
      d.authorizeExtensionCommit(extensionCommit);
      if (extensionCommit.operation !== "state.write.apply") throw new Error("extension checkpoint writes require state.write.apply");
      const c = open(turnId);
      if (!c || c.baseVersion !== expectedVersion || d.branchVersion(c.branchId) !== expectedVersion) return false;
      if (c.kind === "continue" || packageId !== extensionCommit.packageId || !sameExtensionTurnOwner(c.extensionOwner, extensionCommit)) return false;
      requireCommitResource(extensionCommit, { kind: "scene", id: c.chatId }, ["state"]);
      requireCommitResource(extensionCommit, { kind: "take", id: c.branchId }, ["state"]);
      const deltas = checkExtensionDeltas([...deltasRaw], packageId);
      if (deltas.length === 0) throw new Error("pending extension state must include at least one delta");
      checkpoints.set(turnId, { ...c, deltas: [...(c.deltas ?? []), ...deltas], savedAt: d.clock() });
      return true;
    },

    async commitTurn(turnId, resultRaw, guard, extensionCommit) {
      if (extensionCommit) d.authorizeExtensionCommit(extensionCommit);
      const { content, generation, trace, request } = checkTurnResult(resultRaw);
      const expected = checkGuard(guard);
      const c = open(turnId);
      if (!c) return null;
      if ((c.deltas ?? []).some(({ slot }) => slot.startsWith("ext:")) && (!extensionCommit || !sameExtensionTurnOwner(c.extensionOwner, extensionCommit))) throw new StudioConflictError("the extension that owns pending state is no longer authorized to commit it");
      let message: MessageRecord;
      if (c.kind === "reply") {
        // appendMany checks the version before it changes anything, so a conflict leaves the checkpoint.
        const appended = d.appendMany(c.branchId, [{ role: "assistant", content, generation }], guard);
        if (!appended) return null;
        message = d.messages.get(appended[0]!.id)!;
        if (trace) message.swipes[0]!.trace = trace;
      } else if (c.kind === "continue") {
        // Rule 31: more text on the current swipe, kept as an edit keeps it (rule 5).
        const m = d.writableMessage(c.messageId!);
        if (!m || m.branchId !== c.branchId) return null;
        d.requireVersion(m.branchId, expected);
        const swipe = m.swipes[m.current]!;
        swipe.history.push(swipe.content);
        swipe.content += content;
        const merged = continuedGeneration(swipe.generation, generation);
        if (merged) swipe.generation = merged;
        d.bump(m.branchId);
        message = m;
      } else {
        // A message moved to another take by a restore is not this turn's any more (rule 16).
        const m = d.writableMessage(c.messageId!);
        if (!m || m.branchId !== c.branchId) return null;
        d.requireVersion(m.branchId, expected);
        m.swipes.push({ id: d.newId(), content, createdAt: d.clock(), pinned: false, history: [], ...(generation ? { generation } : {}), ...(trace ? { trace } : {}) });
        m.current = m.swipes.length - 1;
        d.bump(m.branchId);
        message = m;
      }
      // The turn's scene-state deltas belong to the version it stored; a continue extends a version that already has its own (rule 17).
      if (c.kind !== "continue") {
        d.state.stamp(message.swipes[message.current]!.id, c.deltas ?? []);
        d.state.refresh(c.branchId, message.seq);
      }
      if (request && c.kind !== "continue") lastRequestOf.set(c.branchId, { messageId: message.id, swipeId: message.swipes[message.current]!.id, texts: request.texts, ...(request.files ? { files: request.files } : {}) });
      checkpoints.delete(turnId);
      return publicMessage(message);
    },

    async dropTurn(turnId, extensionCommit) {
      if (extensionCommit) d.authorizeExtensionCommit(extensionCommit);
      return open(turnId) !== null && checkpoints.delete(turnId);
    },

    async resumeIncomplete() {
      return [...checkpoints.values()]
        .filter((c) => d.liveChatOfBranch(c.branchId))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((c) => structuredClone(c));
    },

    async lastRequest(branchId) {
      if (!d.liveChatOfBranch(branchId)) return null;
      const r = lastRequestOf.get(branchId);
      return r ? structuredClone(r) : null;
    },
  };
}
