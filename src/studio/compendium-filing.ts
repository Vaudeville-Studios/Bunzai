/**
 * The filing pass (04b D5, F13, F14): one model call that answers with a JSON filing plan for a settled reply, parsed once at the
 * boundary, then one revision-checked patch per writable book. Every pass that runs ends in a receipt with a status, never an
 * empty success: `filed`, `partly_filed` (some books and not others), `nothing_to_file`, `skipped: <reason>` (no model call) or
 * `failed: <reason>`. Items the schema or a book rejected are named in the receipt's reason, and a book that changed under the
 * pass is written not at all and named too. The model call is the scene's own connection (or the Compendium's model) in a single
 * non-streaming request; at most one repair call, and only when the whole answer would not parse. No content is logged (F12).
 */
import { toErrorMessage } from "../error-message";
import { filingMessages, parseFilingAnswer, repairMessages, stageItems, writeBookOf, resolveCompendium, buildSnapshot, type FilingItem, type Rejection } from "../core/compendium";
import { splitReasoning } from "../core/reasoning-tags";
import type { CompendiumReceipt, ReceiptWrite } from "../stage/contracts/chat-store";
import { ProviderError } from "../stage/contracts/provider";
import { type CompendiumDeps, sceneBooks } from "./compendium-deps";
import { selectedGuides } from "./guides";
import { writeBook } from "./world-book-writer";

/** What a pass files: one settled reply, and the person's message(s) it answered. */
export interface FileTarget {
  chatId: string;
  branchId: string;
  messageId: string;
  swipeId: string;
  reply: string;
  covered: readonly string[];
}

/** The most JSON a pass may record (a receipt holds 64 KB; the rest is its reason and links). */
const RECEIPT_BUDGET = 48_000;
const REASON_MAX = 1_500;
const MODEL_OPTIONS = { temperature: 0.3, max_tokens: 4096 } as const;

const bounded = (text: string): string => (text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}...` : text);

async function settle(deps: CompendiumDeps, id: string, status: CompendiumReceipt["status"], extra: { reason?: string; writes?: ReceiptWrite[]; model?: string } = {}): Promise<CompendiumReceipt> {
  const done = await deps.chats.settleReceipt(id, { status, ...(extra.reason ? { reason: bounded(extra.reason) } : {}), ...(extra.writes ? { writes: extra.writes } : {}), ...(extra.model ? { model: extra.model } : {}) }, deps.extensionCommit);
  if (!done) throw new Error("the scene is gone");
  return done;
}

const describe = (rejected: readonly Rejection[]) => rejected.map((r) => `item ${r.position}: ${r.reason}`).join("; ");

/**
 * Files one reply. Null when nothing ran: the Compendium or filing is off, or this reply already has a filing receipt (a reply is
 * filed once; "File again" passes `again`). Callers run this inside the scene's lane (`compendium-queue.ts`).
 */
export async function fileReply(deps: CompendiumDeps, target: FileTarget, opts: { again?: boolean } = {}): Promise<CompendiumReceipt | null> {
  const scene = await sceneBooks(deps, target.chatId);
  if (!scene) return null;
  const settings = resolveCompendium(scene.chat.compendium);
  if (!settings.on || !settings.filing.on) return null;
  if (!opts.again) {
    const had = await deps.chats.listReceipts(target.chatId, { branchId: target.branchId, messageId: target.messageId, limit: 200 });
    if (had.some((r) => r.kind === "filing" && r.swipeId === target.swipeId)) return null;
  }
  const receipt = (await deps.chats.appendReceipt(target.chatId, { branchId: target.branchId, messageId: target.messageId, swipeId: target.swipeId, kind: "filing" }, deps.extensionCommit))!;
  if (!receipt) return null;
  try {
    return await run(deps, target, receipt.id, scene, settings);
  } catch (error) {
    // Unexpected: whatever was written was recorded by the run that wrote it; this only closes the receipt so nothing stays in flight.
    const current = await deps.chats.receipt(receipt.id);
    if (current && (current.status === "queued" || current.status === "running")) await deps.chats.settleReceipt(receipt.id, { status: "failed", reason: bounded(toErrorMessage(error, "filing failed")) }, deps.extensionCommit).catch(() => undefined);
    return (await deps.chats.receipt(receipt.id)) ?? null;
  }
}

async function run(deps: CompendiumDeps, target: FileTarget, id: string, scene: NonNullable<Awaited<ReturnType<typeof sceneBooks>>>, settings: ReturnType<typeof resolveCompendium>): Promise<CompendiumReceipt> {
  const writable = scene.books.filter((b) => b.writable);
  if (writable.length === 0) return settle(deps, id, "skipped", { reason: "no enabled book allows writes" });
  if (settings.filing.allow.length === 0) return settle(deps, id, "skipped", { reason: "every entry type is switched off for filing" });
  const connection = settings.model ?? scene.chat.connection;
  if (!connection) return settle(deps, id, "skipped", { reason: "this scene has no connection" });
  const connected = await deps.connect(connection);
  if (!connected) return settle(deps, id, "failed", { reason: "the connection is gone from Kit" });
  await settle(deps, id, "running", { model: connection.model });

  const defaultId = writeBookOf(scene.chat.compendium) ?? (writable.length === 1 ? writable[0]!.id : undefined);
  const guide = settings.filing.guide ? (await selectedGuides(deps.state, [settings.filing.guide]))[0]?.content ?? "" : "";
  const first = filingMessages({
    books: writable.map((b) => ({ id: b.id, name: b.name, isDefault: b.id === defaultId })),
    allow: settings.filing.allow,
    snapshot: buildSnapshot(scene.books.filter((b) => b.readable && b.writable).map((b) => ({ id: b.id, name: b.name, entries: b.view }))),
    guidance: [guide, settings.filing.guidance].filter(Boolean).join("\n\n"), language: settings.language, reply: target.reply, covered: target.covered,
  });

  const ask = async (m: { system: string; user: string }): Promise<string> => {
    const done = await connected.provider.send({ model: connection.model, messages: [{ role: "system", content: m.system }, { role: "user", content: m.user }], options: { ...MODEL_OPTIONS } }, {});
    return splitReasoning(done.content).reply;
  };
  let parsed;
  try {
    let text = await ask(first);
    parsed = parseFilingAnswer(text, settings.filing.allow);
    if (!parsed.ok) {
      text = await ask(repairMessages(first, text, parsed.error));
      parsed = parseFilingAnswer(text, settings.filing.allow);
    }
  } catch (error) {
    return settle(deps, id, "failed", { reason: error instanceof ProviderError ? error.message : toErrorMessage(error, "the model did not answer") });
  }
  if (!parsed.ok) return settle(deps, id, "failed", { reason: `the model's answer could not be read: ${parsed.error}` });

  // Each item goes to the book it named, else the default write book; one that names no writable book is rejected alone.
  const rejected: Rejection[] = [...parsed.rejected];
  const perBook = new Map<string, FilingItem[]>();
  for (const item of parsed.items) {
    const bookId = item.bookId ?? defaultId;
    if (!bookId || !writable.some((b) => b.id === bookId)) rejected.push({ position: item.position, reason: bookId ? "that book is not one this scene may write" : "no default write book is set and the item named none" });
    else perBook.set(bookId, [...(perBook.get(bookId) ?? []), item]);
  }

  const writes: ReceiptWrite[] = [];
  const changed: string[] = [];
  let used = 0;
  for (const [bookId, items] of perBook) {
    let last: ReturnType<typeof stageItems> | undefined;
    const result = await writeBook(deps.store, bookId, (entries) => {
      last = stageItems(entries, items, { bookId, newId: deps.newId, budgetBytes: RECEIPT_BUDGET - used });
      return last.entries;
    }, deps.extensionCommit);
    const name = writable.find((b) => b.id === bookId)!.name;
    if (result.status === "conflict" || result.status === "missing") {
      changed.push(`"${name}" ${result.status === "missing" ? "is gone" : "changed while filing (entries it touches were edited), so nothing was written to it"}; not filed: ${items.map((i) => `${i.type} ${i.name}`).join(", ")}`);
      continue;
    }
    if (last) rejected.push(...last.rejected);
    if (result.status === "saved" && last) {
      writes.push(...last.writes);
      used += last.bytes;
    }
  }
  const notes = [describe(rejected), ...changed].filter(Boolean).join("; ");
  const model = connection.model;
  if (writes.length > 0) return settle(deps, id, changed.length > 0 ? "partly_filed" : "filed", { writes, model, ...(notes ? { reason: notes } : {}) });
  if (changed.length > 0) return settle(deps, id, "failed", { model, reason: notes });
  return settle(deps, id, "nothing_to_file", { model, ...(notes ? { reason: notes } : {}) });
}

