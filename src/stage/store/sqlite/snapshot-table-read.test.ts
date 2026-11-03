/** Encrypted backups preserve the private interview document and its concurrency revision together. */
import { expect, test } from "bun:test";
import { makeRig } from "../fake-snapshot-rig";
import { sqliteStateStore } from "./state-store";
import { documentSchema } from "../../../core/table-read/schema";
import { newInterview } from "../../../core/table-read/interview";

test("snapshot restore retains the Table Read draft and revision without creating a character", async () => {
  const rig = await makeRig();
  try {
    const state = sqliteStateStore(rig.d, rig.cipher);
    const session = newInterview({ tempo: "cold-read", idea: "A lighthouse keeper who fears the sea", connection: { id: "saved", model: "model" } }, "interview", "character");
    const text = JSON.stringify(documentSchema.parse({ version: 1, session }));
    expect(await state.writeIfRevision!("tableRead", text, -1)).toBe("saved");
    const snapshot = await rig.snapshots.take();
    expect(await state.writeIfRevision!("tableRead", JSON.stringify({ version: 1, session: null }), 0)).toBe("saved");
    await rig.snapshots.restore(snapshot.id);
    expect(await state.readVersioned!("tableRead")).toEqual({ text, revision: 0 });
    expect(await rig.library.list("character")).toEqual([]);
  } finally { rig.close(); }
});
