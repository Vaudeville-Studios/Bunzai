/**
 * The memory ChatStore's scene state (rule 17): the deltas each version carries (kept by swipe id, so a fork's copy of a message
 * shares its prefix's deltas without copying them), the deltas a message carries whichever version shows (kept by message id, so
 * they belong to one take and a fork copies them), the tip cache of each branch, and the keyframes. A message's own deltas fold
 * after its shown version's, so they win on that message. Every method that changes what a branch shows calls `refresh` from the first message it changed, so
 * the tip cache is rebuilt in the same synchronous step and no caller can forget it. A write made after a commit that names a version (recordDeltas) is kept with the message too, tied to that version: it applies only while the version is shown on that message, folds after the version own deltas and before the person, and a fork copies it with the message.
 */
import type { Delta, SceneState } from "../../../core/scene-state/types";
import type { ChatStore } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { EXTENSION_BACKGROUND_FIELDS } from "../../../extensions/contracts/background-fields";
import { requireCommitResource } from "../extension-commit-access";
import { GLOBAL_SLOT, baseState, changed, checkExtensionDeltas, checkImportedDeltas, rebuildState, requireHeld, sliceShown } from "../scene-state-rules";
import { checkGuard } from "../chat-rules";
import type { ChatRecord, MessageRecord } from "./chat-records";

export interface StateDeps {
  messages: Map<string, MessageRecord>;
  branchOrder: Map<string, string[]>;
  liveChatOfBranch(branchId: string): ChatRecord | null;
  requireVersion(branchId: string, expected: number | undefined): void;
  authorizeExtensionCommit?(context: ExtensionCommitContext): void;
  branchTurnOpen?(branchId: string): boolean;
}

export interface MemoryState {
  api: Pick<ChatStore, "sceneState" | "sceneStateBefore" | "sceneDeltas" | "recordMessageDeltas" | "recordExtensionMessageDeltas" | "recordExtensionSummaryDeltas" | "recordDeltas" | "setBranchBase" | "globalOps">;
  /** Rebuilds the branch's tip cache; keyframes at or after `fromSeq` are dropped first. */
  refresh(branchId: string, fromSeq?: number): void;
  /** Forgets a branch's cache and keyframes. */
  drop(branchId: string): void;
  /** Keeps a turn's deltas with the version it stored. */
  stamp(swipeId: string, deltas: readonly Delta[]): void;
  /** Gives a new take its own copy of another's base and rebuilds it. */
  copyBase(fromBranchId: string, toBranchId: string): void;
  /** Gives a copy of a message (a fork's, a restored take's) its own copy of what the original carries. */
  copyMessageDeltas(fromId: string, toId: string): void;
}

export function stateMethods(d: StateDeps): MemoryState {
  const swipeDeltas = new Map<string, Delta[]>();
  /** What each message carries: a person's edit (no version) or a generated write tied to the version it is about. */
  const messageDeltas = new Map<string, { delta: Delta; swipe: string | null }[]>();
  const bases = new Map<string, SceneState>();
  const tips = new Map<string, SceneState>();
  const keyframes = new Map<string, Map<string, { seq: number; state: SceneState }>>();
  type Shown = { messageId: string; swipeId: string | null };

  /** The versions a branch shows, oldest first: live messages only, each with the version it points at. */
  const shownPath = (branchId: string, beforeSeq = Number.POSITIVE_INFINITY): Shown[] =>
    (d.branchOrder.get(branchId) ?? []).map((id) => d.messages.get(id)!).filter((m) => !m.cut && m.seq < beforeSeq).map((m) => ({ messageId: m.id, swipeId: m.swipes[m.current]!.id }));
  /** Each message's deltas for a path in three layers, in fold order: its shown version's own, then this take's generated writes for that version, then the person's (they win). */
  const layersOf = (shown: readonly Shown[]): Map<string, [Delta[], Delta[], Delta[]]> =>
    new Map(shown.map((p) => {
      const mine = messageDeltas.get(p.messageId) ?? [];
      return [p.messageId, [
        p.swipeId === null ? [] : (swipeDeltas.get(p.swipeId) ?? []),
        p.swipeId === null ? [] : mine.filter((x) => x.swipe === p.swipeId).map((x) => x.delta),
        mine.filter((x) => x.swipe === null).map((x) => x.delta),
      ]];
    }));
  const deltasOf = (shown: readonly Shown[]): Map<string, Delta[]> => new Map([...layersOf(shown)].map(([id, layers]) => [id, layers.flat()]));
  const build = (branchId: string, path: Shown[]) =>
    rebuildState({
      path,
      ...(bases.has(branchId) ? { base: bases.get(branchId)! } : {}),
      keyframes: new Map([...(keyframes.get(branchId) ?? [])].map(([id, k]) => [id, k.state])),
      deltasOf,
    });
  /** The state a message builds from: everything shown before it, and its own message-level deltas. */
  const stateBefore = (branchId: string, m: MessageRecord): SceneState => build(branchId, [...shownPath(branchId, m.seq), { messageId: m.id, swipeId: null }]).state;

  /** The state the message shows: everything shown before it, then its shown version's deltas and its own. */
  const stateThrough = (branchId: string, m: MessageRecord): SceneState => build(branchId, shownPath(branchId, m.seq + 1)).state;

  const refresh = (branchId: string, fromSeq = 0): void => {
    const kept = keyframes.get(branchId) ?? new Map();
    for (const [id, k] of kept) if (k.seq >= fromSeq) kept.delete(id);
    const { state, fresh } = build(branchId, shownPath(branchId));
    for (const [id, s] of fresh) kept.set(id, { seq: d.messages.get(id)!.seq, state: s });
    keyframes.set(branchId, kept);
    tips.set(branchId, state);
  };
  const writeDeltas = async (branchId: string, swipeId: string, raw: Delta[], guard?: Parameters<ChatStore["recordDeltas"]>[3], context?: ExtensionCommitContext): Promise<boolean> => {
    if (context) {
      const chat = d.liveChatOfBranch(branchId);
      if (!chat || !d.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory ChatStore");
      requireCommitResource(context, { kind: "scene", id: chat.chat.id }, [EXTENSION_BACKGROUND_FIELDS.summaryAutomatic]);
      d.authorizeExtensionCommit(context);
      if (raw.some((delta) => delta.slot !== "summary")) throw new Error("extension follow-on may write only the summary slot");
    }
    const deltas = checkImportedDeltas(raw, "background");
    const expected = checkGuard(guard);
    if (!d.liveChatOfBranch(branchId)) return false;
    const m = (d.branchOrder.get(branchId) ?? []).map((id) => d.messages.get(id)!).find((x) => !x.cut && x.swipes.some((s) => s.id === swipeId && s.cutAt === undefined));
    if (!m) return false;
    d.requireVersion(branchId, expected);
    const through = build(branchId, [...shownPath(branchId, m.seq), { messageId: m.id, swipeId }]).state;
    requireHeld(through, guard?.expect);
    const added = changed(through, deltas);
    if (added.length > 0) {
      messageDeltas.set(m.id, [...(messageDeltas.get(m.id) ?? []), ...structuredClone(added).map((delta) => ({ delta, swipe: swipeId }))]);
      refresh(branchId, m.seq);
    }
    return true;
  };

  return {
    refresh,
    drop: (branchId) => {
      tips.delete(branchId);
      keyframes.delete(branchId);
    },
    stamp: (swipeId, add) => {
      if (add.length > 0) swipeDeltas.set(swipeId, [...(swipeDeltas.get(swipeId) ?? []), ...structuredClone(add)]);
    },
    copyBase: (fromBranchId, toBranchId) => {
      const base = bases.get(fromBranchId);
      if (base) bases.set(toBranchId, structuredClone(base));
      refresh(toBranchId);
    },
    copyMessageDeltas: (fromId, toId) => {
      const own = messageDeltas.get(fromId);
      if (own) messageDeltas.set(toId, structuredClone(own));
    },
    api: {
      async globalOps(exceptSwipeIds = []) {
        // A version counts while any live take shows it; a version a fork shares is counted once. Write order: time, then version, then the order written (as the SQLite store sorts).
        const except = new Set(exceptSwipeIds);
        const seen = new Set<string>();
        const out: { delta: Delta; swipe: string; i: number }[] = [];
        for (const [branchId, ids] of d.branchOrder) {
          if (!d.liveChatOfBranch(branchId)) continue;
          for (const id of ids) {
            const m = d.messages.get(id);
            const shown = m && !m.cut ? m.swipes[m.current] : undefined;
            const swipe = shown && shown.cutAt === undefined ? shown.id : undefined;
            if (!swipe || seen.has(swipe) || except.has(swipe)) continue;
            seen.add(swipe);
            (swipeDeltas.get(swipe) ?? []).forEach((delta, i) => { if (delta.slot === GLOBAL_SLOT) out.push({ delta, swipe, i }); });
          }
        }
        out.sort((a, b) => a.delta.at - b.delta.at || (a.swipe < b.swipe ? -1 : a.swipe > b.swipe ? 1 : 0) || a.i - b.i);
        return structuredClone(out.map((x) => x.delta));
      },

      async sceneState(branchId) {
        if (!d.liveChatOfBranch(branchId)) return null;
        return structuredClone(tips.get(branchId) ?? build(branchId, shownPath(branchId)).state);
      },

      async sceneStateBefore(branchId, messageId) {
        const m = d.messages.get(messageId);
        if (!m || m.branchId !== branchId || m.cut || !d.liveChatOfBranch(branchId)) return null;
        return structuredClone(stateBefore(branchId, m));
      },

      async sceneDeltas(branchId, fromMessageId, toMessageId, slotPrefixes) {
        if (!d.liveChatOfBranch(branchId)) return null;
        const split = sliceShown(shownPath(branchId), fromMessageId, toMessageId);
        if (!split) return null;
        const layers = layersOf(split.range);
        const wanted = (x: Delta): boolean => slotPrefixes === undefined || slotPrefixes.some((s) => x.slot.startsWith(s));
        return structuredClone({
          before: build(branchId, split.before).state,
          messages: split.range.map((p) => {
            const [own, generated, person] = (layers.get(p.messageId) ?? [[], [], []]).map((l) => l.filter(wanted));
            return { messageId: p.messageId, deltas: [...own!, ...generated!, ...person!], generatedFrom: own!.length, personFrom: own!.length + generated!.length };
          }),
        });
      },

      async setBranchBase(branchId, raw) {
        const deltas = checkImportedDeltas(raw, "import");
        if (!d.liveChatOfBranch(branchId)) return false;
        if (deltas.length === 0) bases.delete(branchId);
        else bases.set(branchId, baseState(deltas));
        refresh(branchId);
        return true;
      },

      recordDeltas: (branchId, swipeId, raw, guard) => writeDeltas(branchId, swipeId, raw, guard),
      recordExtensionSummaryDeltas: (context, branchId, swipeId, raw, guard) => writeDeltas(branchId, swipeId, raw, guard, context),

      async recordMessageDeltas(branchId, messageId, raw, guard) {
        checkImportedDeltas(raw, "person");
        const expected = checkGuard(guard);
        const m = d.messages.get(messageId);
        if (!m || m.branchId !== branchId || m.cut || !d.liveChatOfBranch(branchId)) return false;
        d.requireVersion(branchId, expected);
        const own = messageDeltas.get(messageId) ?? [];
        const shown = stateThrough(branchId, m);
        requireHeld(shown, guard?.expect);
        const added = changed(shown, checkImportedDeltas(raw, "person"));
        if (added.length > 0) {
          messageDeltas.set(messageId, [...own, ...added.map((delta) => ({ delta, swipe: null }))]);
          refresh(branchId, m.seq);
        }
        return true;
      },

      async recordExtensionMessageDeltas(context, branchId, messageId, raw, guard) {
        if (!d.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory ChatStore");
        d.authorizeExtensionCommit(context);
        const deltas = checkExtensionDeltas(raw, context.packageId);
        const expected = checkGuard(guard);
        const m = d.messages.get(messageId);
        if (!m || m.branchId !== branchId || m.cut || !d.liveChatOfBranch(branchId)) return false;
        if (d.branchTurnOpen?.(branchId)) throw new Error("extension scene state cannot be applied while a turn is active");
        d.requireVersion(branchId, expected);
        const shown = stateThrough(branchId, m);
        requireHeld(shown, guard?.expect);
        const added = changed(shown, deltas);
        if (added.length > 0) {
          const own = messageDeltas.get(messageId) ?? [];
          messageDeltas.set(messageId, [...own, ...added.map((delta) => ({ delta, swipe: null }))]);
          refresh(branchId, m.seq);
        }
        return true;
      },
    },
  };
}
