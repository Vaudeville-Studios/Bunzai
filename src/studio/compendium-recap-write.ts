/**
 * The one write the Historian and Import chat history share: a parsed answer of entries, recaps and plot overviews becomes one
 * revision-checked patch to one book through the book writer, and the receipt writes that undo it. Recaps get their range stamped and
 * a plot made for any plot they name that the book lacks; an overview is written only for a plot some recap of this write names.
 * Items the book refuses are reported alone; a book edited under the write is not written at all and says so.
 */
import { prepareItems, readBook, stageArcs, stageItems, type Arc, type FilingItem, type Window } from "../core/compendium";
import { normalizeName } from "../core/compendium/relationships";
import type { ReceiptWrite } from "../stage/contracts/chat-store";
import type { CompendiumDeps } from "./compendium-deps";
import { writeBook } from "./world-book-writer";

/** The most JSON one receipt records (a receipt holds 64 KB; the rest is its reason and links). */
export const RECEIPT_BUDGET = 48_000;

export type RecapWrite =
  | { status: "saved"; writes: ReceiptWrite[]; notes: string[] }
  | { status: "unchanged"; writes: []; notes: string[] }
  | { status: "conflict" | "missing"; writes: []; notes: string[] };

export async function writeRecaps(deps: CompendiumDeps, bookId: string, parsed: { items: readonly FilingItem[]; arcs: readonly Arc[] }, w: Window): Promise<RecapWrite> {
  let writes: ReceiptWrite[] = [];
  let notes: string[] = [];
  const result = await writeBook(deps.store, bookId, (entries) => {
    const items = prepareItems(parsed.items, readBook(entries), w);
    const staged = stageItems(entries, items, { bookId, newId: deps.newId, budgetBytes: RECEIPT_BUDGET });
    const plots = new Set(items.filter((i) => i.type === "summary").map((i) => normalizeName(String(i.data["parent_plot"]))));
    const arc = stageArcs(staged.entries, parsed.arcs, plots, bookId, deps.newId);
    writes = [...staged.writes, ...arc.writes];
    notes = staged.rejected.map((r) => `item ${r.position}: ${r.reason}`);
    return arc.entries;
  }, deps.extensionCommit);
  if (result.status === "conflict" || result.status === "missing") return { status: result.status, writes: [], notes: [] };
  return result.status === "saved" && writes.length > 0 ? { status: "saved", writes, notes } : { status: "unchanged", writes: [], notes };
}
