/**
 * The plain words of the health check: which item a row belongs
 * to, and what a damaged column holds. Naming an item is best effort: a name that will not open
 * becomes "whose name could not be read", and nothing here ever throws or reveals a keyed hash.
 */
import type { Statement } from "bun:sqlite";
import { foldId } from "../../contracts/content-store";
import type { CellCipher } from "../../crypto/cell-cipher";

type Stmt = (sql: string) => Statement;
type Row = Record<string, string | number | null>;

/** What each sealed column holds, for "the title of your chat would not open". */
export const COLUMN_WORDS: Readonly<Record<string, string>> = {
  "documents.id_cell": "the name of this piece",
  "documents.revision": "the saved state of this piece",
  "document_versions.revision": "the saved state of this version",
  "document_summaries.summary_cell": "the shelf summary of this piece",
  "document_summaries.revision_cell": "the shelf summary of this piece",
  "piece_parts.cell": "a part of this piece's content",
  "blobs.cell": "an image or file stored in the library",
  "chats.title": "the title of this chat",
  "chats.cast_json": "who is in this chat",
  "chats.previous_cast_json": "the cast this chat had before",
  "chats.connection_json": "this chat's remembered connection",
  "chats.preset_json": "this chat's remembered preset",
  "chats.lore_json": "this chat's lorebook choices",
  "chats.props_json": "this chat's switched-on props",
  "chats.opening_json": "this chat's edited opening messages",
  "chats.prompting_json": "this chat's switched-on guides and scene note",
  "chats.backdrop_json": "this chat's backdrop",
  "chats.compendium_json": "this chat's Compendium settings",
  "chats.participants_json": "this chat's participants",
  "chats.regex_json": "this chat's regex sets",
  "chats.trackers_json": "this chat's trackers",
  "chats.final_cut_json": "this chat's Final Cut settings",
  "chats.summary_json": "this chat's summary",
  "chats.director_json": "this chat's Story Director settings",
  "branches.name": "the name of this take",
  "branches.last_request_json": "this take's last request",
  "swipes.content": "the text of this reply",
  "swipes.generation_json": "the details of how this reply was made",
  "swipe_history.content": "an earlier version of this reply",
  "swipe_traces.trace_json": "the record of how this reply was built",
  "director_states.cell": "the Story Director's story as of this reply",
  "turn_checkpoints.content": "a reply that was still being written",
  "turn_checkpoints.trace_json": "the record of a reply that was still being written",
  "turn_checkpoints.provider_request_id": "a reply that was still being written",
  "turn_checkpoints.deltas_json": "what a reply that was still being written changed in the scene",
  "turn_checkpoints.extension_owner_json": "the extension authority that owns pending scene state",
  "swipe_deltas.path_json": "what this reply changed in the scene",
  "swipe_deltas.value_json": "what this reply changed in the scene",
  "message_deltas.path_json": "what this message carries into the scene",
  "message_deltas.value_json": "what this message carries into the scene",
  "state_keyframes.state_json": "a saved point of this take's scene state",
  "branch_state.state_json": "this take's scene state",
  "branch_base.state_json": "what this take starts with",
  "branch_variables.variables_json": "this take's variables",
  "scene_folders.name": "the name of this story folder",
  "extension_packages.body_cell": "an installed extension package",
  "extension_controls.body_cell": "an extension's approved grants and state",
  "extension_data.body_cell": "an extension's private settings or data",
  "extension_receipts.body_cell": "an extension operation receipt",
  "extension_logs.body_cell": "an extension's private operational log",
  "extension_budget_usage.body_cell": "an extension's usage limits",
  "extension_budget_reservations.body_cell": "reserved extension operation budget",
  "extension_runtime_lease.owner_cell": "the current extension runtime owner",
};

const TABLE_WORDS: Readonly<Record<string, string>> = {
  documents: "a saved piece",
  document_versions: "a saved version of a piece",
  document_graves: "a deleted piece",
  grave_versions: "a version of a deleted piece",
  document_summaries: "a piece's shelf summary",
  grave_summaries: "a deleted piece's shelf summary",
  piece_parts: "a part",
  blobs: "an image or file",
  blob_refs: "a link from a piece to an image or file",
  chats: "a chat",
  branches: "a take of a chat",
  messages: "a message",
  swipes: "a reply",
  swipe_history: "an earlier version of a reply",
  swipe_traces: "a reply's build record",
  director_states: "a reply's Story Director state",
  turn_checkpoints: "an unfinished reply",
  swipe_deltas: "what a reply changed in the scene",
  message_deltas: "what a message carries into the scene",
  state_keyframes: "a saved point of a take's scene state",
  branch_state: "a take's scene state",
  branch_base: "what a take starts with",
  branch_variables: "a take's variables",
  scene_folders: "a story folder",
  extension_packages: "an installed extension package",
  extension_controls: "an installed extension's access record",
  extension_data: "an extension's private data",
  extension_receipts: "an extension operation receipt",
  extension_logs: "an extension's private operational log",
  extension_budget_usage: "an extension's usage budget",
  extension_budget_reservations: "a reserved extension budget",
  extension_runtime_lease: "the extension runtime owner",
};
export const tableWords = (table: string): string => TABLE_WORDS[table] ?? "a stored row";

export interface Labels {
  /** Words naming the item a row belongs to. Never throws. */
  item(table: string, row: Row): string;
  /** The real id and kind of the live piece owning part rows keyed `doc`, when its name opens. */
  livePiece(kind: string, docKey: string): { kind: string; id: string } | null;
}

export function createLabels(statement: Stmt, cipher: CellCipher): Labels {
  const open = (where: string, cell: unknown): string | null => {
    try {
      return typeof cell === "string" ? cipher.open(where, cell) : null;
    } catch {
      return null;
    }
  };
  const get = (sql: string, ...params: (string | number)[]) => (statement(sql).get(...params) as Row | null) ?? null;

  /** A piece's id, only when it hashes back to the row's own key (a swapped id cell names the wrong piece). */
  const idOf = (kind: string, idCell: unknown, key: unknown): string | null => {
    const id = open("documents.id_cell", idCell);
    return id !== null && cipher.index(`${kind}\u0000${foldId(id)}`) === key ? id : null;
  };
  const pieceName = (kind: string, idCell: unknown, key: unknown, buried = false): string => {
    const id = idOf(kind, idCell, key);
    const base = id === null ? `a ${kind} whose name could not be read` : `the ${kind} "${id}"`;
    return buried ? `${base} (deleted)` : base;
  };
  const documentOf = (kind: string, id: string): string => {
    const doc = get("SELECT id_cell FROM documents WHERE kind = ? AND id = ?", kind, id);
    if (doc) return pieceName(kind, doc.id_cell, id);
    const grave = get("SELECT id_cell FROM document_graves WHERE kind = ? AND id = ?", kind, id);
    return grave ? pieceName(kind, grave.id_cell, id, true) : `a ${kind} that is no longer in the library`;
  };
  const chatNamed = (chatId: unknown): string => {
    const chat = typeof chatId === "string" ? get("SELECT title FROM chats WHERE id = ?", chatId) : null;
    const title = chat ? open("chats.title", chat.title) : null;
    return title === null ? "a chat whose title could not be read" : `the chat "${title}"`;
  };
  const chatOfBranch = (branchId: unknown): string => {
    const branch = typeof branchId === "string" ? get("SELECT chat_id FROM branches WHERE id = ?", branchId) : null;
    return chatNamed(branch?.chat_id);
  };
  const messageIn = (messageId: unknown): { seq: number | null; chat: string } => {
    const message = typeof messageId === "string" ? get("SELECT seq, branch_id FROM messages WHERE id = ?", messageId) : null;
    return { seq: (message?.seq as number | undefined) ?? null, chat: chatOfBranch(message?.branch_id) };
  };
  const ownerOfParts = (kind: string, doc: string): string => {
    if (kind === "snapshot") {
      for (const chat of statement("SELECT id FROM chats").all() as { id: string }[]) {
        if (cipher.index(chat.id) === doc) return chatNamed(chat.id);
      }
      return "a chat that is no longer in the library";
    }
    return documentOf(kind, doc);
  };

  const livePiece: Labels["livePiece"] = (kind, docKey) => {
    const doc = get("SELECT id_cell FROM documents WHERE kind = ? AND id = ?", kind, docKey);
    const id = doc ? idOf(kind, doc.id_cell, docKey) : null;
    return id === null ? null : { kind, id };
  };

  const item: Labels["item"] = (table, row) => {
    try {
      switch (table) {
        case "documents":
          return pieceName(String(row.kind), row.id_cell, row.id);
        case "document_graves":
          return pieceName(String(row.kind), row.id_cell, row.id, true);
        case "document_versions":
          return `version ${row.version} of ${documentOf(String(row.kind), String(row.id))}`;
        case "document_summaries":
          return `the shelf summary of ${documentOf(String(row.kind), String(row.id))}`;
        case "grave_versions":
        case "grave_summaries": {
          const grave = get("SELECT kind, id, id_cell FROM document_graves WHERE grave_id = ?", String(row.grave_id));
          return grave ? pieceName(String(grave.kind), grave.id_cell, grave.id, true) : "a deleted piece";
        }
        case "piece_parts":
          return `${tableWords(table)} of ${ownerOfParts(String(row.kind), String(row.doc))}`;
        case "blobs": {
          const owner = get(
            "SELECT p.kind, p.doc FROM blob_refs r JOIN piece_parts p ON p.id = r.part_id WHERE r.blob = ? LIMIT 1",
            String(row.key),
          );
          return owner ? `an image or file used by ${ownerOfParts(String(owner.kind), String(owner.doc))}` : "an image or file no piece uses";
        }
        case "chats":
          return chatNamed(row.id);
        case "branches":
          return `a take of ${chatNamed(row.chat_id)}`;
        case "messages":
          return `message ${row.seq} of ${chatOfBranch(row.branch_id)}`;
        case "swipes":
        case "swipe_history":
        case "swipe_traces":
        case "director_states": {
          const m = messageIn(row.message_id);
          const reply = table === "swipes" ? `reply ${Number(row.position) + 1}` : table === "swipe_history" ? "an earlier version of a reply" : table === "director_states" ? "a reply's Story Director state" : "a reply's build record";
          return `${reply} on message ${m.seq ?? "?"} of ${m.chat}`;
        }
        case "turn_checkpoints":
        case "branch_variables":
        case "state_keyframes":
        case "branch_state":
        case "branch_base":
          return `${tableWords(table)} in ${chatOfBranch(row.branch_id ?? row.id)}`;
        case "scene_folders": {
          const name = open("scene_folders.name", row.name);
          return name === null ? "a story folder whose name could not be read" : `the story folder "${name}"`;
        }
        default:
          return tableWords(table);
      }
    } catch {
      return tableWords(table);
    }
  };
  return { item, livePiece };
}
