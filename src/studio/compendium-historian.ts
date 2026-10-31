/**
 * The Historian pass (04b Track D; RoleCall `summary-writer.ts`, worker `:7477-7531`): every `interval` of the person's turns, one model
 * call over the messages since the last summary (with `overlap` messages of lookback) that answers one JSON object of recaps and plot
 * overviews, written into the scene's writable book through the one book writer as a single revision-checked patch with a `historian`
 * receipt, so Undo takes it all back. It reads only up to the boundary the filing pass stops at (a held-back reply is not summarized),
 * reads a bounded tail of the transcript and never the whole of it, files nothing when the answer cannot be read after one repair call,
 * and ends every run that reached the model in a receipt. Callers run it inside the scene's lane.
 */
import { toErrorMessage } from "../error-message";
import { historianDigest, historianMessages, historianWindow, parseHistorian, resolveCompendium, summaryWatermark, writeBookOf, type Window } from "../core/compendium";
import type { CompendiumReceipt, Message, ReceiptWrite } from "../stage/contracts/chat-store";
import { ProviderError } from "../stage/contracts/provider";
import { askJson } from "./compendium-ask";
import { sceneBooks, type CompendiumDeps } from "./compendium-deps";
import { selectedGuides } from "./guides";
import { writeRecaps } from "./compendium-recap-write";

/** The live messages read from the tail of a take: more than a run ever uses. */
const TAIL = 400;
const REASON_MAX = 1_500;
const MODEL_OPTIONS = { temperature: 0.3, max_tokens: 4096 } as const;

const textOf = (m: Message): string => m.swipes[m.current]?.content ?? "";
const bounded = (t: string): string => (t.length > REASON_MAX ? `${t.slice(0, REASON_MAX - 1)}...` : t);

/**
 * Summarizes up to the reply `boundaryId` (the newest reply the filing pass may file; every message after it is held back). Null when
 * the Compendium or the Historian is off, a run is not yet due, or this reply already has a Historian receipt.
 */
export async function runHistorian(deps: CompendiumDeps, chatId: string, branchId: string, boundaryId: string): Promise<CompendiumReceipt | null> {
  const scene = await sceneBooks(deps, chatId);
  if (!scene) return null;
  const settings = resolveCompendium(scene.chat.compendium);
  if (!settings.on || settings.historian.interval <= 0) return null;
  const page = await deps.chats.readMessagesBefore(branchId, { limit: TAIL, liveOnly: true });
  const at = page.messages.findIndex((m) => m.id === boundaryId);
  const boundary = page.messages[at];
  const swipe = boundary?.swipes[boundary.current];
  if (!boundary || !swipe) return null;
  const tail = { first: page.beforeCount, messages: page.messages.slice(0, at + 1).map((m) => ({ role: m.role, text: textOf(m) })) };

  const writable = scene.books.filter((b) => b.writable);
  const target = scene.books.find((b) => b.id === writeBookOf(scene.chat.compendium)) ?? (writable.length === 1 ? writable[0] : undefined);
  // The watermark is read from the book the summaries are written to, so an undone or retired summary is covered again.
  const mark = summaryWatermark(target?.view ?? []);
  const window = historianWindow(tail, mark, settings.historian.interval, settings.historian.overlap);
  if (!window) return null;
  const had = await deps.chats.listReceipts(chatId, { branchId, messageId: boundaryId, limit: 200 });
  if (had.some((r) => r.kind === "historian" && r.swipeId === swipe.id)) return null;

  const receipt = (await deps.chats.appendReceipt(chatId, { branchId, messageId: boundaryId, swipeId: swipe.id, kind: "historian" }, deps.extensionCommit))!;
  const settle = async (status: CompendiumReceipt["status"], extra: { reason?: string; writes?: ReceiptWrite[]; model?: string } = {}): Promise<CompendiumReceipt> => {
    const done = await deps.chats.settleReceipt(receipt.id, { status, ...(extra.reason ? { reason: bounded(extra.reason) } : {}), ...(extra.writes ? { writes: extra.writes } : {}), ...(extra.model ? { model: extra.model } : {}) }, deps.extensionCommit);
    if (!done) throw new Error("the scene is gone");
    return done;
  };
  try {
    return await run();
  } catch (error) {
    const now = await deps.chats.receipt(receipt.id);
    if (now && (now.status === "queued" || now.status === "running")) await deps.chats.settleReceipt(receipt.id, { status: "failed", reason: bounded(toErrorMessage(error, "the historian failed")) }, deps.extensionCommit).catch(() => undefined);
    return (await deps.chats.receipt(receipt.id)) ?? null;
  }

  async function run(): Promise<CompendiumReceipt> {
    if (!target) return settle("skipped", { reason: writable.length > 1 ? "no default write book is set" : "no enabled book allows writes" });
    const connection = settings.model ?? scene!.chat.connection;
    if (!connection) return settle("skipped", { reason: "this scene has no connection" });
    const connected = await deps.connect(connection);
    if (!connected) return settle("failed", { reason: "the connection is gone from Kit" });
    await settle("running", { model: connection.model });

    const w: Window = window!;
    const lines = tail.messages.slice(w.start - tail.first, w.end - tail.first);
    const guide = settings.filing.guide ? (await selectedGuides(deps.state, [settings.filing.guide]))[0]?.content ?? "" : "";
    const first = historianMessages({ window: w, messages: lines, digest: historianDigest(target!.view), guidance: [guide, settings.filing.guidance].filter(Boolean).join("\n\n"), language: settings.language });
    let parsed;
    try {
      parsed = await askJson(connected, { model: connection.model, options: { ...MODEL_OPTIONS } }, first, (text) => { const p = parseHistorian(text); return p.ok ? { ok: true, value: p } : p; },
        (m, answer, error) => ({ system: m.system, user: `${m.user}\n\nYour previous answer could not be used (${error}):\n\n${answer.slice(0, 2000)}\n\nAnswer again with only the JSON object.` }));
    } catch (error) {
      return settle("failed", { reason: error instanceof ProviderError ? error.message : toErrorMessage(error, "the model did not answer") });
    }
    if (!parsed.ok) return settle("failed", { reason: parsed.error });
    const { items: rawItems, arcs, rejected } = parsed.value;
    const notes = rejected.map((r) => `item ${r.position}: ${r.reason}`);

    const result = await writeRecaps(deps, target!.id, { items: rawItems, arcs }, w);
    notes.push(...result.notes);
    const model = connection.model;
    if (result.status === "conflict" || result.status === "missing") return settle("failed", { model, reason: `"${target!.name}" ${result.status === "missing" ? "is gone" : "changed while the historian worked (entries it touches were edited), so nothing was written to it"}` });
    if (result.status === "saved") return settle("filed", { writes: result.writes, model, ...(notes.length > 0 ? { reason: notes.join("; ") } : {}) });
    return settle("nothing_to_file", { model, ...(notes.length > 0 ? { reason: notes.join("; ") } : {}) });
  }
}
