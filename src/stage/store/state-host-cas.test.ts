/** Host CAS is shared by both StateStore backends without weakening encrypted extension commit authorization. */
import { afterEach, expect, test } from "bun:test";
import { memoryStateStore } from "./memory/state-store";
import { sqliteStateStore } from "./sqlite/state-store";
import { freshDatabase, testCipher } from "./sqlite/test-support";
import type { StageDatabase } from "./sqlite/database";

const databases: StageDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

test("memory and encrypted SQLite accept only the expected host revision and keep the document private", async () => {
  const database = freshDatabase(databases);
  const cipher = testCipher();
  for (const store of [memoryStateStore(), sqliteStateStore(database, cipher)]) {
    expect(await store.writeIfRevision!("tableRead", "private interview", -1)).toBe("saved");
    expect(await store.writeIfRevision!("tableRead", "wrong revision", -1)).toBe("stale");
    expect(await store.readVersioned!("tableRead")).toEqual({ text: "private interview", revision: 0 });
    expect(await store.writeIfRevision!("tableRead", "edited interview", 0)).toBe("saved");
    expect(await store.writeIfRevision!("tableRead", "late generation", 0)).toBe("stale");
    expect(await store.read("tableRead")).toBe("edited interview");
  }
  const raw = database.statement("SELECT body FROM studio_state WHERE key = 'tableRead'").get() as { body: string };
  expect(raw.body).not.toContain("interview");
  expect(cipher.open("studio_state.body", raw.body)).toBe("edited interview");
});
