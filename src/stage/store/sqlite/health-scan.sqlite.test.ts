/**
 * The health scan on real library files, damaged by plain
 * SQL the way a bad sector, a bad copy, or a bug would: a flipped byte, a swapped cell, a changed
 * value, a deleted part, an orphan, a broken pointer. Each case asserts the finding's code, the item
 * it names, and its plain words, and a healthy library must report nothing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blankDirector } from "../../contracts/chat-store.contract-director";
import { createCheckLane, LaneCancelled } from "./health-lane";
import { createScanner } from "./health-scan";
import { makeLibrary, type Library } from "./health-test-support";
import type { Finding, ScanReport } from "./health-types";

const libraries: Library[] = [];
afterEach(() => {
  for (const l of libraries.splice(0)) l.dispose();
});
const library = async () => {
  const l = await makeLibrary();
  libraries.push(l);
  return l;
};
const scan = (l: Library): Promise<ScanReport> => createScanner(l.database, l.cipher, l.path, l.lane).scan();
const run = (l: Library, sql: string, ...params: (string | number | null)[]) => l.database.statement(sql).run(...params);
const get = <T>(l: Library, sql: string, ...params: (string | number)[]) => l.database.statement(sql).get(...params) as T;

/** Changes one character of a sealed cell so it can no longer open. */
const flip = (cell: string): string => cell.slice(0, 10) + (cell[10] === "A" ? "B" : "A") + cell.slice(11);
const only = (r: ScanReport, code: Finding["code"], table: string) => r.findings.filter((f) => f.code === code && f.row.table === table);

describe("health scan: a healthy library", () => {
  test("reports nothing, finishes, and has nothing left to adopt", async () => {
    const l = await library();
    const r = await scan(l);
    expect(r.findings).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.adoptable).toEqual([]);
    expect(r.checked.swipes).toBeGreaterThan(0);
    expect(r.checked.piece_parts).toBeGreaterThan(0);
  });

  test("rows with no fingerprint (a library from before them) are adoptable, never damage", async () => {
    const l = await library();
    run(l, "DELETE FROM row_fingerprints");
    const r = await scan(l);
    expect(r.findings).toEqual([]);
    expect(r.adoptable.length).toBeGreaterThan(20);
  });
});

describe("health scan: damaged cells", () => {
  test("a malformed sealed extension owner on a turn checkpoint is reported as damage", async () => {
    const l = await library();
    const branch = get<{ version: number }>(l, "SELECT version FROM branches WHERE id = ?", l.branchId);
    run(l, "INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at, extension_owner_json) VALUES (?, ?, 'reply', NULL, ?, ?, 1, 1, ?)",
      "damaged-owner", l.branchId, l.cipher.seal("turn_checkpoints.content", "partial reply"), branch.version,
      l.cipher.seal("turn_checkpoints.extension_owner_json", JSON.stringify({ packageId: "fixture.extension" })));
    const finding = only(await scan(l), "cell-unreadable", "turn_checkpoints");
    expect(finding).toHaveLength(1);
    expect(finding[0]).toMatchObject({ column: "extension_owner_json", cause: "the extension authority that owns pending scene state would not open, or does not belong to this row" });
  });

  test("a flipped byte in a reply names the chat and the reply in plain words, and offers roll back when its history exists", async () => {
    const l = await library();
    const swipe = get<{ message_id: string; position: number; content: string }>(l, "SELECT message_id, position, content FROM swipes WHERE message_id = ? AND position = 0", l.messageIds[2]!);
    run(l, "UPDATE swipes SET content = ? WHERE message_id = ? AND position = 0", flip(swipe.content), swipe.message_id);
    const found = only(await scan(l), "cell-unreadable", "swipes");
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.column).toBe("content");
    expect(f.item).toBe('reply 1 on message 3 of the chat "Vera and me"');
    expect(f.cause).toBe("the text of this reply would not open, or does not belong to this row");
    expect(f.repairs).toEqual(["roll-back", "set-aside", "restore-snapshot"]);
  });

  test("a reply with no edit history is not offered roll back", async () => {
    const l = await library();
    const swipe = get<{ content: string }>(l, "SELECT content FROM swipes WHERE message_id = ? AND position = 0", l.messageIds[0]!);
    run(l, "UPDATE swipes SET content = ? WHERE message_id = ? AND position = 0", flip(swipe.content), l.messageIds[0]!);
    expect(only(await scan(l), "cell-unreadable", "swipes")[0]!.repairs).toEqual(["set-aside", "restore-snapshot"]);
  });

  test("a chat title that will not open still names the chat, without reading its title", async () => {
    const l = await library();
    const chat = get<{ title: string }>(l, "SELECT title FROM chats WHERE id = ?", l.chatId);
    run(l, "UPDATE chats SET title = ? WHERE id = ?", flip(chat.title), l.chatId);
    const f = only(await scan(l), "cell-unreadable", "chats")[0]!;
    expect(f.item).toBe("a chat whose title could not be read");
    expect(f.cause).toBe("the title of this chat would not open, or does not belong to this row");
  });

  test("a piece's id cell swapped for another piece's is damage", async () => {
    const l = await library();
    const [a, b] = l.database.statement("SELECT kind, id, id_cell FROM documents ORDER BY id").all() as { kind: string; id: string; id_cell: string }[];
    run(l, "UPDATE documents SET id_cell = ? WHERE kind = ? AND id = ?", b!.id_cell, a!.kind, a!.id);
    const f = only(await scan(l), "cell-unreadable", "documents");
    expect(f).toHaveLength(1);
    expect(f[0]!.item).toBe("a character whose name could not be read");
    expect(f[0]!.repairs).not.toContain("roll-back");
  });

  test("a damaged live part of a piece with an earlier version offers roll back", async () => {
    const l = await library();
    const docKey = get<{ id: string }>(l, "SELECT id FROM documents WHERE kind = 'character' AND id IN (SELECT doc FROM piece_parts WHERE to_version IS NULL) ORDER BY version DESC LIMIT 1").id;
    const part = get<{ id: number; cell: string }>(l, "SELECT id, cell FROM piece_parts WHERE kind = 'character' AND doc = ? AND to_version IS NULL LIMIT 1", docKey);
    run(l, "UPDATE piece_parts SET cell = ? WHERE id = ?", flip(part.cell), part.id);
    const f = only(await scan(l), "cell-unreadable", "piece_parts")[0]!;
    expect(f.item).toMatch(/^a part of the character "(vera|kit)"$/);
    expect(f.repairs).toEqual(["roll-back", "set-aside", "restore-snapshot"]);
  });
});

describe("health scan: rows that changed or went missing", () => {
  test("a cell moved between two rows, both readable, is reported as a changed row", async () => {
    const l = await library();
    // A fork copies cells byte for byte, so two rows can hold the same cell: take two whose cells differ (message ids are random).
    const rows = l.database.statement("SELECT message_id, position, content FROM swipes ORDER BY message_id, position").all() as { message_id: string; position: number; content: string }[];
    const a = rows[0]!;
    const b = rows.find((r) => r.content !== a.content)!;
    run(l, "UPDATE swipes SET content = ? WHERE message_id = ? AND position = ?", b.content, a.message_id, a.position);
    const found = only(await scan(l), "row-changed", "swipes");
    expect(found.map((f) => f.row.key)).toEqual([JSON.stringify([a.message_id, a.position])]);
    expect(found[0]!.cause).toContain("contents are not what was saved");
    expect(found[0]!.repairs).toContain("re-sign");
  });

  test("a changed plain value is a changed row", async () => {
    const l = await library();
    run(l, "UPDATE messages SET role = 'system' WHERE id = ?", l.messageIds[0]!);
    const found = only(await scan(l), "row-changed", "messages");
    expect(found).toHaveLength(1);
    expect(found[0]!.item).toBe('message 1 of the chat "Vera and me"');
  });

  test("a row that was signed and is gone, without a delete trigger firing, is a missing row", async () => {
    const l = await library();
    run(l, "DROP TRIGGER fp_swipe_history_d");
    run(l, "DELETE FROM swipe_history WHERE message_id = ? AND n = 1", l.messageIds[2]!);
    const found = only(await scan(l), "row-missing", "swipe_history");
    expect(found).toHaveLength(1);
    expect(found[0]!.cause).toBe("it was saved here and is now gone");
    expect(found[0]!.repairs).toEqual(["re-sign", "restore-snapshot"]);
  });

  test("a delete through SQLite, with its trigger, is a normal delete and not a finding", async () => {
    const l = await library();
    run(l, "DELETE FROM swipe_history WHERE message_id = ? AND n = 1", l.messageIds[2]!);
    expect((await scan(l)).findings).toEqual([]);
  });
});

describe("health scan: structure", () => {
  test("a deleted part leaves a piece with no content and a part that went missing", async () => {
    const l = await library();
    run(l, "DROP TRIGGER fp_piece_parts_d");
    run(l, "PRAGMA foreign_keys = OFF");
    run(l, "DELETE FROM piece_parts WHERE kind = 'character' AND doc = (SELECT id FROM documents WHERE kind = 'character' ORDER BY id DESC LIMIT 1)");
    const r = await scan(l);
    expect(only(r, "parts-missing", "documents").length).toBeGreaterThan(0);
    expect(only(r, "parts-missing", "documents")[0]!.cause).toBe("its content is missing");
    expect(only(r, "row-missing", "piece_parts").length).toBeGreaterThan(0);
  });

  test("an orphan link, an unowned part, and an unused image are each reported", async () => {
    const l = await library();
    run(l, "PRAGMA foreign_keys = OFF");
    run(l, "INSERT INTO blob_refs (part_id, blob) VALUES (987654, 'nope')");
    run(l, "INSERT INTO piece_parts (kind, doc, part, from_version, to_version, cell) VALUES ('character', 'nobody', 'p', 1, NULL, 'e1:x')");
    run(l, "INSERT INTO blobs (key, cell, bytes) VALUES ('stray', 'e1:x', 1)");
    const r = await scan(l);
    const dangling = r.findings.filter((f) => f.code === "dangling");
    expect(dangling.map((f) => `${f.row.table}: ${f.cause}`).sort()).toEqual(
      [
        "blob_refs: it belongs to a part that is not there",
        "blob_refs: it belongs to an image or file that is not there",
        "blobs: no piece uses it",
        "piece_parts: no piece in the library owns it",
      ].sort(),
    );
  });

  test("a message showing a reply that is not there, and a chat opening on a missing take, are broken pointers", async () => {
    const l = await library();
    run(l, "UPDATE messages SET current_swipe = 9 WHERE id = ?", l.messageIds[0]!);
    run(l, "UPDATE chats SET active_branch_id = 'gone' WHERE id = ?", l.chatId);
    const r = await scan(l);
    expect(only(r, "pointer-broken", "messages")[0]!.cause).toBe("the reply it shows is missing");
    expect(only(r, "pointer-broken", "chats")[0]!.cause).toBe("the take it opens on is missing");
  });
});

describe("health scan: the file", () => {
  test("a truncated copy of the file is reported as damaged, on the background lane", async () => {
    const l = await library();
    await l.database.scrub();
    const copy = join(l.dir, "copy.db");
    copyFileSync(l.path, copy);
    const bytes = readFileSync(copy);
    // Zero a run of pages' headers in the middle: a bad sector, not a clean truncation.
    writeFileSync(copy, Buffer.concat([bytes.subarray(0, 8192), Buffer.alloc(8192), bytes.subarray(16384)]));
    const r = await createScanner(l.database, l.cipher, copy, l.lane).scan();
    const f = r.findings.find((x) => x.code === "file-damaged");
    expect(f?.item).toBe("the library file");
    expect(f?.repairs).toEqual(["restore-snapshot"]);
  });
});

describe("health scan: control", () => {
  test("a locked library stops the scan and says where, never reporting it healthy", async () => {
    const l = await library();
    const { cellCipher } = await import("../../crypto/cell-cipher");
    const { LockedError } = await import("../../crypto/keyring-errors");
    const locked = cellCipher(() => {
      throw new LockedError();
    });
    const lockedLane = createCheckLane({ database: l.database, path: l.path, keys: { leaseKeys: () => { throw new LockedError(); } } });
    const r = await createScanner(l.database, locked, l.path, lockedLane).scan();
    expect(r.complete).toBe(false);
    expect(r.stoppedAt).toBeDefined();
  });

  test("a library that locks in the middle of the scan stops it, names where, and reports no damage", async () => {
    const l = await library();
    const r = await createScanner(l.database, l.cipher, l.path, l.lane).scan({ onProgress: (table) => { if (table === "chats") l.lockKeys(); } });
    expect(r.complete).toBe(false);
    expect(r.stoppedAt).toBeDefined();
    expect(r.findings).toEqual([]);
  });

  test("a cancel while the lane is opening cells stops the scan at that table, reporting no damage", async () => {
    const l = await library();
    const controller = new AbortController();
    const r = await createScanner(l.database, l.cipher, l.path, l.lane).scan({
      signal: controller.signal,
      onProgress: (table) => { if (table === "chats") setTimeout(() => controller.abort(), 0); }, // lands while the worker is still starting
    });
    expect(r.complete).toBe(false);
    expect(r.stoppedAt).toBe("chats");
    expect(r.findings).toEqual([]);
  });

  test("a lane job cancelled mid-way ends as a cancel, not as a lock or a failure", async () => {
    const l = await library();
    const controller = new AbortController();
    const pending = l.lane({ table: "messages" }, controller.signal).then(() => null, (error: unknown) => error);
    controller.abort();
    expect(await pending).toBeInstanceOf(LaneCancelled);
  });

  test("a lock while the lane is opening cells ends the job as a lock, not as damage", async () => {
    const l = await library();
    const { LockedError } = await import("../../crypto/keyring-errors");
    const pending = l.lane({ table: "messages" }).then(() => null, (error: unknown) => error);
    l.lockKeys(); // the lease is cancelled while the worker holds the keys
    expect(await pending).toBeInstanceOf(LockedError);
  });

  test("a healthy library's cells are opened on the lane, never on the main thread", async () => {
    const l = await library();
    let opens = 0;
    const counting = { ...l.cipher, open: (where: string, cell: string) => { opens++; return l.cipher.open(where, cell); } };
    const r = await createScanner(l.database, counting, l.path, l.lane).scan();
    expect(r.findings).toEqual([]);
    expect(Object.values(r.checked).reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
    expect(opens).toBe(0);
  });

  test("a cancelled scan says it did not finish", async () => {
    const l = await library();
    const controller = new AbortController();
    controller.abort();
    const r = await createScanner(l.database, l.cipher, l.path, l.lane).scan({ signal: controller.signal });
    expect(r.complete).toBe(false);
  });
});

describe("health scan: the Story Director's state", () => {
  test("a healthy snapshot is checked and reports nothing; a flipped byte in it names the reply in plain words", async () => {
    const l = await library();
    await l.chats.putDirector(l.chatId, l.messageIds[2]!, blankDirector("kept"), { expectedVersion: null });
    const clean = await scan(l);
    expect(clean.findings).toEqual([]);
    expect(clean.checked["director_states"]).toBe(1);
    const row = get<{ cell: string }>(l, "SELECT cell FROM director_states");
    run(l, "UPDATE director_states SET cell = ?", flip(row.cell));
    const found = only(await scan(l), "cell-unreadable", "director_states");
    expect(found).toHaveLength(1);
    expect(found[0]!.item).toBe("a reply's Story Director state on message 3 of the chat \"Vera and me\"");
    expect(found[0]!.cause).toBe("the Story Director's story as of this reply would not open, or does not belong to this row");
  });

  test("a snapshot whose reply is gone is an orphan, named as such", async () => {
    const l = await library();
    await l.chats.putDirector(l.chatId, l.messageIds[2]!, blankDirector("kept"), { expectedVersion: null });
    run(l, "PRAGMA foreign_keys = OFF");
    run(l, "DELETE FROM swipes WHERE message_id = ?", l.messageIds[2]!);
    const found = only(await scan(l), "dangling", "director_states");
    expect(found).toHaveLength(1);
    expect(found[0]!.cause).toBe("it belongs to a reply that is not there");
  });
});

describe("health scan: scene state", () => {
  /** A message that carries a delta and a new reply whose version carries one, so the take has its tip cache and each delta its row. */
  const withDelta = async (l: Awaited<ReturnType<typeof library>>) => {
    await l.chats.recordMessageDeltas(l.branchId, l.messageIds[2]!, [{ slot: "vars", path: ["mood"], value: "calm", at: 1 }]);
    const turn = await l.chats.beginTurn(l.branchId, { kind: "reply" });
    await l.chats.saveCheckpoint(turn!.id, { content: "r", deltas: [{ slot: "vars", path: ["swell"], value: 1, at: 1 }] });
    return (await l.chats.commitTurn(turn!.id, { content: "reply" }))!;
  };

  test("healthy deltas and the take's cache are checked and report nothing; a flipped byte in a delta, or in the cache, is named in plain words", async () => {
    const l = await library();
    await withDelta(l);
    const clean = await scan(l);
    expect(clean.findings).toEqual([]);
    expect([clean.checked["swipe_deltas"], clean.checked["message_deltas"], clean.checked["branch_state"]]).toEqual([1, 1, 2]); // the library's two takes each keep a cache
    const delta = get<{ value_json: string }>(l, "SELECT value_json FROM swipe_deltas");
    run(l, "UPDATE swipe_deltas SET value_json = ?", flip(delta.value_json));
    const found = only(await scan(l), "cell-unreadable", "swipe_deltas");
    expect(found).toHaveLength(1);
    expect(found[0]!.cause).toBe("what this reply changed in the scene would not open, or does not belong to this row");
    const carried = get<{ value_json: string }>(l, "SELECT value_json FROM message_deltas");
    run(l, "UPDATE message_deltas SET value_json = ?", flip(carried.value_json));
    expect(only(await scan(l), "cell-unreadable", "message_deltas")).toHaveLength(1);
    run(l, "UPDATE branch_state SET state_json = ? WHERE branch_id = ?", flip(get<{ state_json: string }>(l, "SELECT state_json FROM branch_state WHERE branch_id = ?", l.branchId).state_json), l.branchId);
    expect(only(await scan(l), "cell-unreadable", "branch_state")).toHaveLength(1);
  });

  test("a flipped byte in a take's starting state is named, and a base whose take is gone is an orphan", async () => {
    const l = await library();
    await l.chats.setBranchBase(l.branchId, [{ slot: "vars", path: ["start"], value: 1, at: 1 }]);
    const clean = await scan(l);
    expect(clean.findings).toEqual([]);
    expect(clean.checked["branch_base"]).toBe(1);
    run(l, "UPDATE branch_base SET state_json = ?", flip(get<{ state_json: string }>(l, "SELECT state_json FROM branch_base").state_json));
    expect(only(await scan(l), "cell-unreadable", "branch_base")).toHaveLength(1);
    run(l, "PRAGMA foreign_keys = OFF");
    run(l, "DELETE FROM branches WHERE id = ?", l.branchId);
    expect(only(await scan(l), "dangling", "branch_base")).toHaveLength(1);
  });

  test("a delta whose reply is gone, and a cache whose take is gone, are orphans", async () => {
    const l = await library();
    const reply = await withDelta(l);
    run(l, "PRAGMA foreign_keys = OFF");
    run(l, "DELETE FROM swipes WHERE message_id = ?", reply.id);
    run(l, "DELETE FROM messages WHERE id = ?", l.messageIds[2]!);
    run(l, "DELETE FROM branches WHERE id = ?", l.branchId);
    run(l, "DELETE FROM state_keyframes");
    const report = await scan(l);
    expect(only(report, "dangling", "swipe_deltas")).toHaveLength(1);
    expect(only(report, "dangling", "message_deltas")).toHaveLength(1);
    expect(only(report, "dangling", "branch_state")).toHaveLength(1);
  });
});
