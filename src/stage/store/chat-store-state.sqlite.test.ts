/**
 * What only the SQLite file shows of scene state (rule 17): deltas are keyed by swipe id and never copied by a fork, the keyframes a
 * mid-path cut leaves are exactly the states of the history that is shown now, the tip cache is rewritten inside the same
 * transaction as the change (a change that rolls back leaves it alone), and every payload is sealed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Delta } from "../../core/scene-state/types";
import type { JsonValue } from "../contracts/chat-store";
import { sqliteChatStore } from "./sqlite-chat-store";
import type { StageDatabase } from "./sqlite/database";
import { freshDatabase, testCipher } from "./sqlite/test-support";

const open: StageDatabase[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
});

const CAST = { character: { id: "vera", version: 1 } };
const SNAP = { character: { name: "Vera" } };
const set = (name: string, value: JsonValue): Delta => ({ slot: "vars", path: [name], value, at: 1 });

async function longChat(length: number) {
  const database = freshDatabase(open);
  const cipher = testCipher();
  const store = sqliteChatStore(database, cipher);
  const chat = await store.createChat({ title: "Long", cast: CAST, snapshot: SNAP });
  const branch = chat.activeBranchId;
  const messages = (await store.appendMessages(branch, Array.from({ length }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `m${i}` }))))!;
  /** What a message carries whichever version shows. */
  const record = (index: number, ...deltas: Delta[]) => store.recordMessageDeltas(branch, messages[index]!.id, deltas);
  const count = (table: string) => (database.statement(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  /** The kept keyframes, in message order. */
  const keyframes = () =>
    (database.statement("SELECT message_id, state_json FROM state_keyframes").all() as { message_id: string; state_json: string }[])
      .map((r) => ({
        messageId: r.message_id,
        state: JSON.parse(cipher.open("state_keyframes.state_json", r.state_json)) as { vars?: Record<string, { value: JsonValue }> },
      }))
      .sort((a, b) => messages.findIndex((m) => m.id === a.messageId) - messages.findIndex((m) => m.id === b.messageId));
  return { database, cipher, store, branch, messages, record, count, keyframes, chat };
}

describe("keyframes", () => {
  test("one is kept after every 50th shown message, and holds the state after it", async () => {
    const s = await longChat(130);
    await s.record(3, set("a", 3));
    await s.record(60, set("a", 60));
    await s.record(120, set("a", 120));
    expect(s.keyframes().map((k) => [k.messageId, k.state.vars!["a"]!.value])).toEqual([[s.messages[49]!.id, 3], [s.messages[99]!.id, 60]]);
  });

  test("a cut in the middle leaves only keyframes that match the history shown now, each after its own 50th shown message", async () => {
    const s = await longChat(130);
    for (const i of [3, 60, 120]) await s.record(i, set("a", i), set(`only${i}`, i));
    await s.store.cutMessages(s.branch, s.messages[60]!.id, "one");
    const shown = s.messages.filter((m) => m.id !== s.messages[60]!.id);
    const kept = s.keyframes();
    expect(kept.map((k) => k.messageId)).toEqual([shown[49]!.id, shown[99]!.id]);
    // The first holds only what was set at or before shown message 49; the second leaves out the cut message's own writes.
    expect(Object.keys(kept[0]!.state.vars!).sort()).toEqual(["a", "only3"]);
    expect(Object.keys(kept[1]!.state.vars!).sort()).toEqual(["a", "only3"]);
    expect(kept[1]!.state.vars!["a"]!.value).toBe(3);
    expect(Object.keys((await s.store.sceneState(s.branch) as { vars: object }).vars).sort()).toEqual(["a", "only120", "only3"]);
    // Restoring brings back what it set, and a keyframe never keeps the stale state from while it was cut.
    const cutId = (await s.store.readMessages(s.branch, { limit: 500 })).messages.find((m) => m.cut)!.cut!.id;
    await s.store.restoreCut(s.branch, cutId);
    expect(s.keyframes().map((k) => [k.messageId, k.state.vars!["a"]!.value])).toEqual([[s.messages[49]!.id, 3], [s.messages[99]!.id, 60]]);
  });

  test("a keyframe is dropped with its message when the message is purged, and with its take", async () => {
    const s = await longChat(60);
    await s.record(5, set("a", 1));
    expect(s.count("state_keyframes")).toBe(1);
    await s.store.cutMessages(s.branch, s.messages[5]!.id, "from");
    expect(s.count("state_keyframes")).toBe(0);
    await s.store.restoreCut(s.branch, (await s.store.readMessages(s.branch, { limit: 500 })).messages.find((m) => m.cut)!.cut!.id);
    expect(s.count("state_keyframes")).toBe(1);
    await s.store.cutMessages(s.branch, s.messages[5]!.id, "from");
    await s.store.purgeChats(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    expect([s.count("state_keyframes"), s.count("swipe_deltas")]).toEqual([0, 0]);
  });
});

describe("a long branch", () => {
  test("with three deltas on every one of 2,000 messages (a counter, a field of its own, a rewritten field), a full rebuild takes under 200 ms", async () => {
    const s = await longChat(2_000);
    const insert = s.database.statement("INSERT INTO swipe_deltas (swipe_id, seq, slot, path_json, value_json, removed, at) VALUES (?, ?, 'vars', ?, ?, 0, ?)");
    const row = (swipeId: string, seq: number, name: string, value: JsonValue, at: number) =>
      insert.run(swipeId, seq, s.cipher.seal("swipe_deltas.path_json", JSON.stringify([name])), s.cipher.seal("swipe_deltas.value_json", JSON.stringify(value)), at);
    s.database.transaction(() => {
      s.messages.forEach((m, i) => {
        row(m.swipes[0]!.id, 1, "n", i, i);
        row(m.swipes[0]!.id, 2, `field${i}`, `text of message ${i}`, i);
        row(m.swipes[0]!.id, 3, "last", `m${i}`, i);
      });
    });
    Bun.gc(true); // keep fixture allocations out of the timed rebuild, as in the perf gates
    const began = performance.now();
    await s.record(0, set("first", true)); // the earliest message: every state after it is rebuilt, and every keyframe rewritten
    const ms = performance.now() - began;
    console.log(`scene state: a dense 2,000-message rebuild (6,000 deltas, 2,000 fields, 40 keyframes) took ${ms.toFixed(1)} ms`);
    const vars = ((await s.store.sceneState(s.branch)) as { vars: Record<string, { value: JsonValue }> }).vars;
    expect([vars["first"]!.value, vars["n"]!.value, vars["last"]!.value, Object.keys(vars).length]).toEqual([true, 1_999, "m1999", 2_003]);
    expect(s.count("state_keyframes")).toBe(40);
    expect(ms).toBeLessThan(200);
  });
});

describe("what is shared and what is copied", () => {
  test("a fork shares a version's delta rows (no copy), and gives its copy of a message its own rows of what it carries; its take has its own cache", async () => {
    const s = await longChat(6);
    await s.record(1, set("carried", 1));
    const reply = (await commitReply(s, [set("v", 2)]))!;
    expect([s.count("swipe_deltas"), s.count("message_deltas")]).toEqual([1, 1]);
    const take = await s.store.fork(s.branch, reply.id);
    expect([s.count("swipe_deltas"), s.count("message_deltas")]).toEqual([1, 2]);
    expect(s.count("branch_state")).toBe(2);
    expect(Object.keys(((await s.store.sceneState(take!.id)) as { vars: object }).vars).sort()).toEqual(["carried", "v"]);
    // A deleted take drops its cache; the shared version rows stay for the take that still shows them.
    await s.store.deleteBranch(take!.id);
    expect([s.count("swipe_deltas"), s.count("branch_state")]).toEqual([1, 1]);
  });

  test("a message's delta rows are numbered in the order they were written, however many writes", async () => {
    const s = await longChat(2);
    await s.record(1, set("a", 1), set("b", 2));
    await s.record(1, set("a", 3));
    const rows = s.database.statement("SELECT seq, slot FROM message_deltas ORDER BY seq").all();
    expect(rows).toEqual([{ seq: 1, slot: "vars" }, { seq: 2, slot: "vars" }, { seq: 3, slot: "vars" }]);
    expect(((await s.store.sceneState(s.branch)) as { vars: Record<string, { value: JsonValue }> }).vars["a"]!.value).toBe(3);
  });
});

describe("one transaction", () => {
  test("a commit refused as stale (before any write) leaves the tip cache and the rows as they were, with the checkpoint still holding the turn's deltas", async () => {
    const s = await longChat(4);
    await s.record(1, set("a", 1));
    const before = s.database.statement("SELECT state_json FROM branch_state").get();
    const turn = await s.store.beginTurn(s.branch, { kind: "reply" });
    await s.store.saveCheckpoint(turn!.id, { content: "r", deltas: [set("b", 2)] });
    await s.store.appendMessage(s.branch, { role: "user", content: "meanwhile" });
    const conflict = await s.store.commitTurn(turn!.id, { content: "reply" }, { expectedVersion: turn!.baseVersion }).then(() => null, (e: unknown) => e);
    expect((conflict as Error).name).toBe("StudioConflictError");
    expect(s.database.statement("SELECT state_json FROM branch_state").get()).toEqual(before);
    expect([s.count("swipe_deltas"), s.count("message_deltas")]).toEqual([0, 1]);
    expect((await s.store.resumeIncomplete())[0]!.deltas).toEqual([set("b", 2)]);
  });

  test("the tip cache records the tip it was built for", async () => {
    const s = await longChat(4);
    await s.record(1, set("a", 1));
    expect(s.database.statement("SELECT tip_message_id, tip_swipe_id FROM branch_state WHERE branch_id = ?").get(s.branch)).toEqual({
      tip_message_id: s.messages[3]!.id,
      tip_swipe_id: s.messages[3]!.swipes[0]!.id,
    });
  });
});

describe("sealed", () => {
  test("the variable name, its value, the keyframes and the tip cache are not readable in the file", async () => {
    const s = await longChat(60);
    await s.record(1, set("secret-name", "secret-value"));
    await commitReply(s, [set("secret-name", "secret-value")]);
    for (const table of ["swipe_deltas", "message_deltas", "state_keyframes", "branch_state"]) {
      const dump = JSON.stringify(s.database.statement(`SELECT * FROM ${table}`).all());
      expect(dump, table).not.toContain("secret");
    }
    const turn = await s.store.beginTurn(s.branch, { kind: "reply" });
    await s.store.saveCheckpoint(turn!.id, { content: "x", deltas: [set("secret-name", "secret-value")] });
    expect(JSON.stringify(s.database.statement("SELECT deltas_json FROM turn_checkpoints").all())).not.toContain("secret");
  });
});

/** A reply the way a turn stores it: its changes wait on the checkpoint and reach the version when it commits. */
const commitReply = async (s: Awaited<ReturnType<typeof longChat>>, deltas: Delta[]) => {
  const turn = await s.store.beginTurn(s.branch, { kind: "reply" });
  await s.store.saveCheckpoint(turn!.id, { content: "r", deltas });
  return s.store.commitTurn(turn!.id, { content: "reply" });
};
const varsOf = async (s: Awaited<ReturnType<typeof longChat>>, branch = s.branch) =>
  Object.keys(((await s.store.sceneState(branch)) as { vars?: object }).vars ?? {}).sort();

describe("a damaged cache is rebuilt, never fatal (the deltas are the data)", () => {
  for (const table of ["branch_state", "state_keyframes"]) {
    test(`a damaged ${table} cell: the state is still right, and a turn commits and a version is added`, async () => {
      const s = await longChat(60);
      await commitReply(s, [set("a", 1)]);
      expect(s.count(table)).toBeGreaterThan(0);
      s.database.statement(`UPDATE ${table} SET state_json = 'garbage'`).run();
      expect(await varsOf(s)).toEqual(["a"]);
      expect(await commitReply(s, [set("b", 2)])).not.toBeNull();
      expect(await varsOf(s)).toEqual(["a", "b"]);
      const last = (await s.store.readMessages(s.branch, { limit: 500 })).messages.at(-1)!;
      expect(await s.store.addSwipe(last.id, { content: "again" })).not.toBeNull();
      expect(await varsOf(s)).toEqual(["a"]);
      // The damaged rows were rewritten whole: the cache opens again.
      expect(() => JSON.parse(s.cipher.open(`${table}.state_json`, (s.database.statement(`SELECT state_json FROM ${table}`).get() as { state_json: string }).state_json))).not.toThrow();
    });
  }

  test("a damaged delta cell stays fail-closed: the read refuses, and a commit that would stamp on top of it rolls back whole, stamp and message", async () => {
    const s = await longChat(4);
    await commitReply(s, [set("a", 1)]);
    s.database.statement("UPDATE swipe_deltas SET value_json = 'garbage'").run();
    const next = await s.store.appendMessage(s.branch, { role: "user", content: "next" });
    const refused = await s.store.sceneStateBefore(s.branch, next!.id).then(() => null, (e: unknown) => e);
    expect(refused).not.toBeNull();
    const turn = await s.store.beginTurn(s.branch, { kind: "reply" });
    await s.store.saveCheckpoint(turn!.id, { content: "r", deltas: [set("b", 2)] });
    const before = [s.count("swipe_deltas"), await s.store.countMessages(s.branch)];
    const failed = await s.store.commitTurn(turn!.id, { content: "reply" }).then(() => null, (e: unknown) => e);
    expect(failed).not.toBeNull();
    expect([s.count("swipe_deltas"), await s.store.countMessages(s.branch)]).toEqual(before);
    expect((await s.store.resumeIncomplete())[0]!.deltas).toEqual([set("b", 2)]);
  });
});

describe("the base is data, not a cache", () => {
  test("a damaged base cell fails closed: reads that need it refuse, and a commit that would rebuild on it rolls back whole", async () => {
    const s = await longChat(4);
    await s.store.setBranchBase(s.branch, [set("start", "here")]);
    expect(await varsOf(s)).toEqual(["start"]);
    s.database.statement("UPDATE branch_base SET state_json = 'garbage'").run();
    expect(await s.store.sceneStateBefore(s.branch, s.messages[0]!.id).then(() => null, (e: unknown) => e)).not.toBeNull();
    const turn = await s.store.beginTurn(s.branch, { kind: "reply" });
    await s.store.saveCheckpoint(turn!.id, { content: "r", deltas: [set("b", 2)] });
    const before = [s.count("swipe_deltas"), await s.store.countMessages(s.branch)];
    expect(await s.store.commitTurn(turn!.id, { content: "reply" }).then(() => null, (e: unknown) => e)).not.toBeNull();
    expect([s.count("swipe_deltas"), await s.store.countMessages(s.branch)]).toEqual(before);
  });

  test("the base is sealed in the file, and a fork gets its own row", async () => {
    const s = await longChat(2);
    await s.store.setBranchBase(s.branch, [set("secret-name", "secret-value")]);
    expect(JSON.stringify(s.database.statement("SELECT * FROM branch_base").all())).not.toContain("secret");
    await s.store.fork(s.branch, s.messages[1]!.id);
    expect(s.count("branch_base")).toBe(2);
  });
});

describe("indexes", () => {
  test("the queries on a swipe id are index lookups, not scans of every swipe", async () => {
    const s = await longChat(2);
    const plan = (sql: string) => (s.database.statement(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" | ");
    expect(plan("SELECT 1 FROM swipe_deltas c WHERE NOT EXISTS (SELECT 1 FROM swipes p WHERE p.swipe_id = c.swipe_id)")).not.toMatch(/SCAN p|SCAN swipes/);
    expect(plan("SELECT message_id FROM swipes WHERE swipe_id = 'x'")).toMatch(/USING (COVERING )?INDEX/);
    expect(plan("DELETE FROM swipe_deltas WHERE swipe_id NOT IN (SELECT swipe_id FROM swipes)")).not.toMatch(/SCAN swipes/);
  });
});

describe("a scene row written before the Props trackers' state moved into slots", () => {
  test("is read as settings alone: a module's old state and the Director's undo records are not read, and the next change to the module rewrites the cell without them", async () => {
    const s = await longChat(2);
    const old = { resources: { data: { hp: 3 }, update: { messageId: "m", swipeId: "s", turn: 1, at: 1, before: null, after: { hp: 3 } }, undone: [], parked: [], context: "never" }, inventory: { data: { items: [] } }, map: { data: { mode: "full" } } };
    s.database.statement("UPDATE chats SET trackers_json = ? WHERE id = ?").run(s.cipher.seal("chats.trackers_json", JSON.stringify(old)), s.chat.id);
    expect((await s.store.getChat(s.chat.id))!.trackers).toEqual({ resources: { context: "never" }, map: { data: { mode: "full" } } });
    expect((await s.store.getChat(s.chat.id))!.trackers).toEqual((await s.store.listChats()).chats[0]!.trackers);
    await s.store.setTracker(s.chat.id, "resources", { auto: { every: 2 } });
    const cell = (s.database.statement("SELECT trackers_json FROM chats").get() as { trackers_json: string }).trackers_json;
    expect(JSON.parse(s.cipher.open("chats.trackers_json", cell))).toEqual({ resources: { context: "never", auto: { every: 2 } }, map: { data: { mode: "full" } } });
  });
});
