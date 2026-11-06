/**
 * One scene's turn, as the page sees it: Starting until the first text,
 * the text as it streams, then the scene reloaded from the store. Stop keeps what arrived; a failure
 * shows RoleCall's card with the draft; a reply the take moved past waits on the "scene changed" card.
 * Nothing here decides what is saved: the server's turn loop does, and the page reloads its answer.
 *
 * `setLive` for a "text" event is coalesced to at most once per animation frame: the raw text still accumulates on `turn` (a plain mutable object, so every token touches zero
 * React state by itself), and a single rAF flush copies it into state. Every other event type -
 * start, failed, conflict, done - flushes immediately, cancelling any pending frame first, so a
 * terminal outcome is never held behind a batched token.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppContext } from "../../app-contract";
import { toErrorMessage } from "../../_shared/error-message";
import type { TurnEvent } from "../../../studio/scene-turn";
import type { RequestParams } from "../../../studio/scene-turn-trace";
import type { PromptAttachmentInfo } from "../../../core/media/prompt-attachment";
import { FALLBACK_KEY, readFallback } from "./fallback-model";
import { INSPECTOR_KEY, readInspector } from "./inspector-core";
import { carryOpenChoices } from "./scene-reasoning-core";
import { answerPromptRegex } from "./scene-prompt-regex";
import { publishDirector } from "./props/story-director/director-live";
import { replyNotice } from "./reply-notice";

export interface LiveTurn {
  kind: "reply" | "swipe" | "continue";
  turnId?: string;
  /** The message a new version is being written into, or the reply a continue is adding to. */
  messageId: string | null;
  text: string;
  /** The model's native reasoning so far; it is not part of the reply. */
  reasoning: string;
  /** The Start Reply With text the reply opens with (Show Prefill in Chat shows it in front). */
  prefill?: string;
  /** The Final Cut pass running before the reply is saved (RoleCall's "Final Cut pass..."). */
  finalCut?: string;
  phase?: string;
}

/** A turn paused by the Prompt Inspector: the exact request, waiting for Send or Cancel. */
export interface Review { turnId: string; messages: { role: string; content: string }[]; files?: PromptAttachmentInfo[]; mediaEstimateIncomplete?: boolean; tokens: number; /** The tool definitions the request carries, shown read-only. */ tools?: { name: string; description: string; parameters: unknown }[]; /** The generation parameters the request sends and leaves out. */ params?: RequestParams }

export type HeldTurn =
  /** `anchor` is the message the failed turn was for: the one it answered, or the reply it re-wrote. */
  | { kind: "failed"; code: string; message: string; draft: string; turn: "reply" | "swipe" | "continue"; anchor: string | null; /** A guided re-roll's instruction, so Retry keeps it. */ guidance?: string }
  | { kind: "conflict"; turnId: string; draft: string };

/** `who` is the character the open scene is with (the page keeps it current); the optional desktop notice for a finished reply names them (reply-notice.ts). */
/** What a finished turn committed, from its own done or stopped event: the message and the version (swipe) that now shows, and the kind of turn. Null from the start of a turn until it commits one; a turn that saves nothing leaves it null. */
export interface CommittedTurn { kind: "reply" | "swipe" | "continue"; messageId: string; swipeId: string }

export function useSceneTurn(ctx: AppContext, chatId: string, reload: () => void, who?: { current: { characterId: string; name: string } | null }) {
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [held, setHeld] = useState<HeldTurn | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  /** The message whose newest version landed while another was showing: its counter says NEW. */
  const [landed, setLanded] = useState<string | null>(null);
  const [committed, setCommitted] = useState<CommittedTurn | null>(null);
  const turnRef = useRef<LiveTurn | null>(null);
  /** Stop pressed before the turn had an id: it stops the moment the start event names one. */
  const stopWanted = useRef(false);
  /** The pending rAF flush for "text" events, or null when none is scheduled. */
  const frameRef = useRef<number | null>(null);

  const cancelFrame = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);
  // Never let a frame outlive the component: a reply still streaming when the page unmounts must
  // not touch state afterward.
  useEffect(() => cancelFrame, [cancelFrame]);

  /** `messageId` is the reply a new version goes into (or a continue adds to); `answering` is the message a reply answers; `guidance` is a guided re-roll's instruction (a swipe's alone). */
  const start = useCallback(async (kind: "reply" | "swipe" | "continue", expectedVersion: number, messageId: string | null = null, answering: string | null = null, guidance?: string): Promise<void> => {
    if (turnRef.current) return;
    const turn: LiveTurn = { kind, messageId, text: "", reasoning: "" };
    turnRef.current = turn;
    stopWanted.current = false;
    setHeld(null);
    setCommitted(null);
    setLive({ ...turn });
    const flush = (): void => {
      frameRef.current = null;
      if (turnRef.current === turn) setLive({ ...turn });
    };
    const scheduleFlush = (): void => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
    };
    const onEvent = (e: TurnEvent): void => {
      if (e.type === "regex") { void answerPromptRegex(e, (answer) => ctx.api.answerSceneRegex(chatId, e.turnId, answer)); return; }
      if (e.type === "review") setReview({ turnId: e.turnId, messages: e.messages, ...(e.files ? { files: e.files } : {}), tokens: e.tokens, ...(e.tools ? { tools: e.tools } : {}), ...(e.params ? { params: e.params } : {}) });
      else if (e.type === "text" || e.type === "failed" || e.type === "done" || e.type === "stopped" || e.type === "conflict") setReview(null);
      if (e.type === "start") {
        turn.turnId = e.turnId;
        if (stopWanted.current) void ctx.api.stopSceneTurn(chatId, e.turnId).catch(() => undefined);
      } else if (e.type === "text") {
        turn.text = e.full ? e.delta : turn.text + e.delta;
        scheduleFlush();
        return;
      } else if (e.type === "prefill") {
        turn.prefill = e.text;
      } else if (e.type === "director") {
        publishDirector(chatId, e);
      } else if (e.type === "world") {
        if (e.status === "failed" && e.reason) ctx.setStatus(e.reason);
      } else if (e.type === "finalcut") {
        delete turn.phase;
        turn.finalCut = e.pass;
      } else if (e.type === "phase") {
        delete turn.finalCut;
        turn.phase = e.name;
      } else if (e.type === "reasoning") {
        turn.reasoning = e.full ? e.delta : turn.reasoning + e.delta;
        scheduleFlush();
        return;
      } else if (e.type === "failed") setHeld({ kind: "failed", code: e.code, message: e.message, draft: e.draft, turn: kind, anchor: kind === "reply" ? answering : messageId, ...(guidance ? { guidance } : {}) });
      else if (e.type === "conflict") setHeld({ kind: "conflict", turnId: e.turnId, draft: e.draft });
      else if (e.type === "done" && kind === "swipe" && e.message) setLanded(e.message.id);
      // The live turn becomes the saved version: a block closed by hand stays closed.
      if ((e.type === "done" || e.type === "stopped") && e.message && turn.turnId) carryOpenChoices(`turn:${turn.turnId}`, e.message.swipes[e.message.current]?.id ?? "");
      if ((e.type === "done" || e.type === "stopped") && e.message) setCommitted({ kind, messageId: e.message.id, swipeId: e.message.swipes[e.message.current]?.id ?? "" });
      if (e.type === "done" && kind === "reply") replyNotice(ctx.prefs, chatId, who?.current ?? null);
      // A non-text event never waits behind a batched token: flush whatever text already arrived,
      // then this event's own state, in the same tick.
      cancelFrame();
      flush();
    };
    try {
      const fallback = readFallback(ctx.prefs.get(FALLBACK_KEY));
      await ctx.api.runSceneTurn({ chatId, kind, expectedVersion, ...(guidance ? { guidance } : {}), ...(readInspector(ctx.prefs.get(INSPECTOR_KEY)) ? { inspect: true } : {}), ...(fallback.mode === "custom" ? { fallback: fallback.connection } : {}) }, onEvent);
    } catch (e) {
      // Refused before anything opened: no connection, or the take moved on. Nothing was sent.
      ctx.setStatus(toErrorMessage(e));
    } finally {
      cancelFrame();
      setReview(null);
      turnRef.current = null;
      setLive(null);
      reload();
    }
  }, [ctx, chatId, reload, cancelFrame, who]);

  const stop = useCallback((): void => {
    if (!turnRef.current) return;
    const id = turnRef.current.turnId;
    if (id) void ctx.api.stopSceneTurn(chatId, id).catch(() => undefined);
    else stopWanted.current = true;
  }, [ctx, chatId]);

  /** Send or Cancel the paused request; a request that could not be answered keeps the dialog open and says why. */
  const answer = useCallback(async (decision: { kind: "send"; edits: Record<number, string> } | { kind: "cancel" }): Promise<void> => {
    if (!review) return;
    try {
      await ctx.api.answerSceneReview(chatId, review.turnId, decision);
      setReview(null);
    } catch (e) {
      ctx.setStatus(`could not answer the Prompt Inspector: ${toErrorMessage(e)}`);
    }
  }, [ctx, chatId, review]);

  const settle = useCallback(async (keep: boolean): Promise<void> => {
    if (held?.kind !== "conflict") return;
    try {
      if (keep) await ctx.api.keepWaitingReply(chatId, held.turnId);
      else await ctx.api.discardWaitingReply(chatId, held.turnId);
    } catch (e) {
      ctx.setStatus(`could not ${keep ? "add" : "discard"} the reply: ${toErrorMessage(e)}`);
    }
    setHeld(null);
    reload();
  }, [ctx, chatId, held, reload]);

  return { live, held, review, answer, landed, committed, start, stop, dismiss: () => setHeld(null), keep: () => void settle(true), discard: () => void settle(false), seen: () => setLanded(null) };
}
