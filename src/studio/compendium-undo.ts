/**
 * Undo of a filing or mirror receipt (04b D7, F4): a guarded reverse patch per entry from the receipt's field-level values, sent
 * through the one book writer. An entry changed since the pass is skipped and listed (RoleCall's conflict rule), a created entry
 * is retired and never deleted, an entry already as it was or gone is nothing to do and not an error, and the original receipt
 * is marked `undone` only after every patch has landed; a partial or failed undo leaves it `filed` so the person can try again.
 * The undo is its own receipt, so Activity shows it. Callers run these in the scene's lane (`compendium-queue.ts`).
 */
import { toErrorMessage } from "../error-message";
import { heldFields, planUndo, readEntry, setFields } from "../core/compendium";
import type { CompendiumReceipt, ReceiptKind, ReceiptWrite } from "../stage/contracts/chat-store";
import type { CompendiumDeps } from "./compendium-deps";
import { StudioConflictError, StudioNotFoundError } from "./errors";

import { writeBook } from "./world-book-writer";

const UNDOABLE = new Set(["filed", "partly_filed"]);
/** The receipts that wrote into books and can be taken back; an ingest is taken back from its own run, not with a take's filings. */
const REVERSIBLE = new Set(["filing", "mirror", "historian", "ingest", "standardize", "refine"]);

export async function undoReceipt(deps: CompendiumDeps, chatId: string, receiptId: string): Promise<CompendiumReceipt> {
  const r = await deps.chats.receipt(receiptId);
  if (!r || r.chatId !== chatId) throw new StudioNotFoundError("that receipt is gone");
  if (r.damaged) throw new StudioConflictError("that receipt is damaged, so what it filed cannot be undone from it");
  if (r.status === "undone") return (r.undoneBy ? await deps.chats.receipt(r.undoneBy) : null) ?? r;
  if (!REVERSIBLE.has(r.kind) || !UNDOABLE.has(r.status)) throw new StudioConflictError(`a ${r.status} ${r.kind} receipt has nothing to undo`);

  const undo = (await deps.chats.appendReceipt(chatId, { branchId: r.branchId, kind: "undo", status: "running", undoes: r.id, ...(r.messageId ? { messageId: r.messageId } : {}), ...(r.swipeId ? { swipeId: r.swipeId } : {}) }, deps.extensionCommit))!;
  const restored: ReceiptWrite[] = [];
  const skipped: string[] = [];
  try {
    const byBook = Map.groupBy(r.writes, (w) => w.bookId);
    for (const [bookId, writes] of byBook) {
      let mine: { restored: ReceiptWrite[]; skipped: string[] } = { restored: [], skipped: [] };
      const result = await writeBook(deps.store, bookId, (entries) => {
        mine = { restored: [], skipped: [] };
        let next = entries;
        for (const w of writes) {
          const entry = next.find((e) => e.id === w.entryId);
          const verdict = planUndo(w, entry, r.id, deps.now());
          if (verdict.kind === "changed") mine.skipped.push(`${entry ? readEntry(entry, 0).name : w.entryId} was edited since it was filed`);
          if (verdict.kind !== "restore" || !entry) continue;
          const keys = [...Object.keys(verdict.set), ...verdict.remove];
          mine.restored.push({ bookId, entryId: w.entryId, op: w.op === "create" ? "retire" : "update", fields: { before: heldFields(entry, keys) as ReceiptWrite["fields"]["before"], after: verdict.set as ReceiptWrite["fields"]["after"] } });
          next = next.map((e) => (e.id === w.entryId ? setFields(entry, verdict.set, verdict.remove) : e));
        }
        return next;
      }, deps.extensionCommit);
      if (result.status === "conflict") skipped.push(`a book changed while undoing (${result.ids.join(", ")}); nothing was written to it`);
      else {
        restored.push(...mine.restored);
        skipped.push(...mine.skipped);
      }
    }
  } catch (error) {
    return (await deps.chats.settleReceipt(undo.id, { status: "failed", reason: toErrorMessage(error, "undo failed").slice(0, 1500), writes: restored }, deps.extensionCommit))!;
  }
  const status = skipped.length === 0 ? "filed" : restored.length > 0 ? "partly_filed" : "failed";
  const settled = (await deps.chats.settleReceipt(undo.id, { status, writes: restored, ...(skipped.length > 0 ? { reason: `skipped: ${skipped.join("; ")}`.slice(0, 1500) } : {}) }, deps.extensionCommit))!;
  if (status === "filed") await deps.chats.settleReceipt(r.id, { status: "undone", undoneBy: undo.id }, deps.extensionCommit);
  return settled;
}

export interface UndoSummary { undone: number; failed: string[] }

/**
 * The receipts of a take (or of every take, with no branch) that could still be undone, newest first, optionally narrowed. By default
 * only filings and mirrors: "Undo this take's filings" must never reach a Standardize run, which has its own Revert.
 */
export async function undoableReceipts(deps: CompendiumDeps, chatId: string, branchId: string | undefined, keep: (r: CompendiumReceipt) => boolean, kinds: readonly ReceiptKind[] = ["filing", "mirror", "historian"]): Promise<CompendiumReceipt[]> {
  const out: CompendiumReceipt[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await deps.chats.listReceipts(chatId, { ...(branchId ? { branchId } : {}), limit: 200, ...(before ? { before } : {}) });
    out.push(...page.filter((r) => kinds.includes(r.kind) && UNDOABLE.has(r.status) && !r.damaged && keep(r)));
    if (page.length < 200) return out;
    before = page[page.length - 1]!.id;
  }
}

/**
 * Undoes each of these receipts in turn and never throws: a cut or a regenerate must go ahead whether or not its filings could be
 * taken back, and what could not be is reported (it is also in the failed undo receipt, which Activity shows).
 */
export async function undoAll(deps: CompendiumDeps, chatId: string, receipts: readonly CompendiumReceipt[]): Promise<UndoSummary> {
  const summary: UndoSummary = { undone: 0, failed: [] };
  for (const r of receipts) {
    try {
      const undo = await undoReceipt(deps, chatId, r.id);
      if (undo.status === "filed") summary.undone++;
      else summary.failed.push(`${r.id}: ${undo.reason ?? undo.status}`);
    } catch (error) {
      summary.failed.push(`${r.id}: ${toErrorMessage(error, "undo failed")}`);
    }
  }
  return summary;
}
