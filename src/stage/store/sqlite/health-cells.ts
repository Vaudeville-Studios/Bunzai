/**
 * What "this row's cells are readable" means for each covered table: which columns hold sealed cells, the column each was sealed for, whether the opened text
 * is JSON, and the binding checks that tie a cell to its own row. Returns the damaged columns of one
 * row; any other error (a locked library, a real bug) still throws.
 */
import { foldId } from "../../contracts/content-store";
import { DamagedDataError } from "../../damaged-data-error";
import type { CellCipher } from "../../crypto/cell-cipher";
import { openBlobs } from "./blob-sql";
import { openPartCell } from "./piece-parts-sql";
import { extensionTurnOwnerSchema } from "../../contracts/extension-turn-owner";

type Row = Record<string, string | number | null>;

interface CellColumn {
  readonly column: string;
  /** The column the cell was sealed for, when it differs from `table.column` (graves keep live labels). */
  readonly where?: string;
  readonly json?: boolean;
}

const idCell: CellColumn = { column: "id_cell", where: "documents.id_cell" };
const GRAVE_REVISION: CellColumn = { column: "revision", where: "documents.revision" };

/** Plain cell columns; the three rows below the table are checked by `bound`. */
export const CELL_COLUMNS: Readonly<Record<string, readonly CellColumn[]>> = {
  documents: [{ column: "revision", where: "documents.revision" }],
  document_versions: [{ column: "revision" }],
  document_graves: [GRAVE_REVISION],
  grave_versions: [{ column: "revision", where: "document_versions.revision" }],
  document_summaries: [{ column: "summary_cell" }, { column: "revision_cell" }],
  grave_summaries: [
    { column: "summary_cell", where: "document_summaries.summary_cell" },
    { column: "revision_cell", where: "document_summaries.revision_cell" },
  ],
  chats: [
    { column: "title" },
    { column: "cast_json", json: true },
    { column: "previous_cast_json", json: true },
    { column: "connection_json", json: true },
    { column: "preset_json", json: true },
    { column: "lore_json", json: true },
    { column: "props_json", json: true },
    { column: "opening_json", json: true },
    { column: "prompting_json", json: true },
    { column: "backdrop_json", json: true },
    { column: "compendium_json", json: true },
    { column: "participants_json", json: true },
    { column: "regex_json", json: true },
    { column: "trackers_json", json: true },
    { column: "final_cut_json", json: true },
    { column: "summary_json", json: true },
    { column: "director_json", json: true },
  ],
  branches: [{ column: "name" }, { column: "last_request_json", json: true }],
  swipes: [{ column: "content" }, { column: "generation_json", json: true }],
  swipe_history: [{ column: "content" }],
  swipe_traces: [{ column: "trace_json", json: true }],
  director_states: [{ column: "cell", json: true }],
  turn_checkpoints: [{ column: "content" }, { column: "trace_json", json: true }, { column: "provider_request_id" }, { column: "deltas_json", json: true }, { column: "extension_owner_json", json: true }],
  swipe_deltas: [{ column: "path_json", json: true }, { column: "value_json", json: true }],
  message_deltas: [{ column: "path_json", json: true }, { column: "value_json", json: true }],
  state_keyframes: [{ column: "state_json", json: true }],
  branch_state: [{ column: "state_json", json: true }],
  branch_base: [{ column: "state_json", json: true }],
  branch_variables: [{ column: "variables_json", json: true }],
  scene_folders: [{ column: "name" }],
  extension_packages: [{ column: "body_cell", json: true }],
  extension_controls: [{ column: "body_cell", json: true }],
  extension_data: [{ column: "body_cell", json: true }],
  extension_receipts: [{ column: "body_cell", json: true }],
  extension_logs: [{ column: "body_cell", json: true }],
  extension_budget_usage: [{ column: "body_cell", json: true }],
  extension_budget_reservations: [{ column: "body_cell", json: true }],
  extension_runtime_lease: [{ column: "owner_cell" }],
};

/** The full AAD of a plain cell column, as the stores seal it. */
export const whereOf = (table: string, c: CellColumn): string => c.where ?? `${table}.${c.column}`;

const isDamage = (error: unknown): boolean => error instanceof DamagedDataError || error instanceof SyntaxError;

/** Documents and graves: the sealed id must hash back to the row's key (a swapped id_cell is damage). */
function checkId(cipher: CellCipher, row: Row): void {
  const id = cipher.open("documents.id_cell", String(row.id_cell));
  if (cipher.index(`${row.kind}\u0000${foldId(id)}`) !== row.id) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
}

/** Every damaged cell column of one row of `table`, by column name. */
export async function damagedColumns(cipher: CellCipher, table: string, row: Row): Promise<string[]> {
  const bad: string[] = [];
  const attempt = (column: string, work: () => void) => {
    try {
      work();
    } catch (error) {
      if (!isDamage(error)) throw error;
      bad.push(column);
    }
  };
  if (table === "documents" || table === "document_graves") attempt(idCell.column, () => checkId(cipher, row));
  if (table === "piece_parts") {
    attempt("cell", () => void openPartCell(cipher, { id: Number(row.id), kind: String(row.kind), part: String(row.part), cell: String(row.cell) }));
  } else if (table === "blobs") {
    try {
      await openBlobs(cipher, [{ key: String(row.key), cell: String(row.cell) }]);
    } catch (error) {
      if (!isDamage(error)) throw error;
      bad.push("cell");
    }
  }
  for (const c of CELL_COLUMNS[table] ?? []) {
    const cell = row[c.column];
    if (cell === null || cell === undefined) continue;
    attempt(c.column, () => {
      const text = cipher.open(whereOf(table, c), String(cell));
      if (c.json) {
        const value: unknown = JSON.parse(text);
        if (table === "turn_checkpoints" && c.column === "extension_owner_json" && !extensionTurnOwnerSchema.safeParse(value).success) {
          throw new DamagedDataError("turn_checkpoints.extension_owner_json", "the owner binding has an invalid shape");
        }
      }
    });
  }
  return bad;
}
