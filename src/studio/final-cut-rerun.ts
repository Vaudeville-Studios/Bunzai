/**
 * Re-running a scene's Final Cut passes over a reply that is already saved (RoleCall's "Rerun N enabled passes" in the activity
 * dialog, rc app/api/chat/post-gen-actions/run/route.ts). It reads the reply's shown version and the messages before it, runs the same
 * stage the turn runs, and answers the result without writing anything: the person looks at it and applies it as an edit, which keeps
 * the text it replaces in the edit history. RoleCall appends a re-run to the message's saved run; here a re-run is a preview, because
 * a saved reply's trace is written once, with the reply. Applying a preview (applyFinalCutRerun) is an edit of the shown version, so the
 * text it replaces stays in the edit history, and the run is added to the reply's run (ChatStore rule 46). The preview is held here,
 * in memory, so what is applied is exactly what the server ran and never what a page sends.
 */
import { randomUUID } from "node:crypto";
import { runOwnedTask } from "./scene-turn-runtime";
import { readTrace, type PassTrace } from "../core/final-cut/trace";
import { activePasses } from "../core/final-cut/pass";
import type { Bank } from "../core/final-cut/banks";
import { resolveReasoning } from "../core/reasoning-capture";
import type { ChatStore, JsonObject, Message } from "../stage/contracts/chat-store";
import { StudioConflictError, StudioNotFoundError } from "./errors";

import { finalCutStage } from "./scene-turn-final-cut";
import type { ReadPreset } from "./scene-turn-load";
import { WHOLE_BRANCH } from "./scene-branch";
import type { TurnDeps } from "./scene-turn";

interface Pending { chatId: string; messageId: string; swipeId: string; before: string; after: string; at: number; ms: number; passes: PassTrace[]; made: number }
const PENDING = new Map<string, Pending>();
const PENDING_MAX = 30;
const PENDING_TTL_MS = 30 * 60_000;

export interface Rerun {
  /** Names this preview for applyFinalCutRerun. */
  rerunId: string;
  messageId: string;
  swipeId: string;
  /** The text the re-run left; equal to the shown text when nothing changed. */
  text: string;
  /** The run in the shape a reply's trace keeps it (scene-turn-final-cut.ts). */
  run: JsonObject;
  summary: { passes: number; changed: boolean; failed: number };
}

export async function rerunFinalCut(
  deps: Pick<TurnDeps, "connect" | "now" | "readRegex" | "runtime"> & { chats: ChatStore; readPreset: ReadPreset; finalCutBanks?(): Promise<Record<string, Bank>> },
  input: { chatId: string; messageId: string },
  signal: AbortSignal,
): Promise<Rerun> {
  return runOwnedTask(deps.runtime, async () => {
    const chat = await deps.chats.getChat(input.chatId);
    if (!chat) throw new StudioNotFoundError("that scene does not exist");
    if (!chat.connection) throw new StudioConflictError("this scene has no connection; pick one in the AI wing");
    if (activePasses(chat.finalCut?.passes).length === 0) throw new StudioConflictError("Enable at least one Final Cut pass before rerunning.");
    const { messages } = await deps.chats.readMessages(chat.activeBranchId, { limit: WHOLE_BRANCH });
    const live = messages.filter((m) => !m.cut);
    const at = live.findIndex((m) => m.id === input.messageId);
    const message = live[at];
    if (!message || message.role !== "assistant") throw new StudioNotFoundError("that reply is gone");
    const swipe = message.swipes[message.current]!;
    const history = live.slice(0, at).map((m) => ({ role: m.role, content: m.swipes[m.current]!.content }));
    const preset = chat.preset ? await deps.readPreset(chat.preset.id, chat.preset.kind).catch(() => null) : null;
    const out = await finalCutStage({
      deps, chat: { ...chat, finalCut: { ...chat.finalCut, on: true } }, text: swipe.content, history, format: resolveReasoning(preset?.reasoning, chat.prompting), signal, emit: () => undefined,
      ...(deps.finalCutBanks ? { userBanks: deps.finalCutBanks } : {}),
    });
    if (!out) throw new StudioConflictError("There is nothing to rerun on this reply.");
    if ("stop" in out) throw new StudioConflictError(out.stop.type === "failed" ? out.stop.message : "Final Cut was stopped.");
    const now = deps.now();
    for (const [id, p] of PENDING) if (now - p.made > PENDING_TTL_MS) PENDING.delete(id);
    while (PENDING.size >= PENDING_MAX) PENDING.delete(PENDING.keys().next().value!);
    const rerunId = randomUUID();
    PENDING.set(rerunId, { chatId: chat.id, messageId: message.id, swipeId: swipe.id, before: swipe.content, after: out.text, at: now, ms: readTrace(out.trace)?.ms ?? 0, passes: readTrace(out.trace)?.passes ?? [], made: now });
    return { rerunId, messageId: message.id, swipeId: swipe.id, text: out.text, run: out.trace, summary: out.summary };
  });
}

/** Writes a previewed re-run over the reply as an edit and keeps it in the reply's run. `recorded` is false when the reply has no run to add it to. */
export async function applyFinalCutRerun(
  deps: { chats: ChatStore; now(): number; /** A Core scene's edit goes through rp-core's journal (CoreTurnOwner.hostMessage). */ edit?(messageId: string, swipeId: string, text: string, expectedVersion: number): Promise<Message | null> },
  input: { chatId: string; rerunId: string; expectedVersion: number },
): Promise<{ message: Message; recorded: boolean }> {
  const p = PENDING.get(input.rerunId);
  if (!p || p.chatId !== input.chatId || deps.now() - p.made > PENDING_TTL_MS) throw new StudioNotFoundError("that re-run preview is gone; run it again");
  if (p.after === p.before) throw new StudioConflictError("The re-run changed nothing, so there is nothing to apply.");
  const chat = await deps.chats.getChat(input.chatId);
  if (!chat) throw new StudioNotFoundError("that scene does not exist");
  const { messages } = await deps.chats.readMessages(chat.activeBranchId, { limit: WHOLE_BRANCH });
  const shown = messages.find((m) => m.id === p.messageId && !m.cut);
  const swipe = shown ? shown.swipes[shown.current] : undefined;
  if (!shown || !swipe || swipe.id !== p.swipeId || swipe.content !== p.before) throw new StudioConflictError("This reply changed since the re-run. Run it again.");
  const message = deps.edit
    ? await deps.edit(p.messageId, p.swipeId, p.after, input.expectedVersion)
    : await deps.chats.editSwipe(p.messageId, p.swipeId, p.after, { expectedVersion: input.expectedVersion });
  if (!message) throw new StudioNotFoundError("that reply is gone");
  PENDING.delete(input.rerunId);
  const recorded = await deps.chats.appendFinalCutRerun(p.messageId, p.swipeId, { at: p.at, ms: p.ms, before: p.before, after: p.after, passes: p.passes }).catch(() => false);
  return { message, recorded };
}
