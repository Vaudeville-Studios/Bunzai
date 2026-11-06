/** A linked scene remains readable while rp-core holds its journal lease for a turn. */
import { afterEach, expect, test } from "bun:test";
import { libraryFor } from "../studio/library-content";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);

test("a scene opens while its rp-core session has a live turn lease", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const records = libraryFor(r.store.studioPath())!.core!;
  const link = (await records.sceneFor(chat.id))!;
  const lease = await records.acquire(link.sessionId);
  try {
    const response = await r.handler(apiReq(`/api/chats/open?id=${chat.id}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ core: true, chat: { id: chat.id } });
  } finally { await lease.release(); }
});


test("unsupported version and branch writes are rejected before touching a linked journal", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = await (await r.post("/api/chats/start", { characterId: "vera" })).json() as { id: string; activeBranchId: string };
  const records = libraryFor(r.store.studioPath())!.core!;
  const { coreWriteGuard } = await import("./server-core-guard");
  // Takes, cuts and versions go through rp-core now (core-scene-ops.ts); a scene system with no Core form yet stays refused.
  expect((await coreWriteGuard("/api/chats/summary-now", { chatId: chat.id }, records))?.status).toBe(501);
  expect(await coreWriteGuard("/api/chats/delete-take", { branchId: chat.activeBranchId }, records)).toBeNull();
  await r.post("/api/chats/send", { chatId: chat.id, content: "Hi", greetingIndex: 0, expectedVersion: 1 });
  const messages = await libraryFor(r.store.studioPath())!.chats.readMessages(chat.activeBranchId, { limit: 10 });
  const message = messages.messages[0]!;
  expect((await r.post("/api/chats/director-edit", { messageId: message.id })).status).toBe(501);
});


test("first send preserves the chosen alternate greeting in the engine journal", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = await (await r.post("/api/chats/start", { characterId: "vera" })).json() as { id: string };
  const sent = await r.post("/api/chats/send", { chatId: chat.id, content: "Hi", greetingIndex: 1, expectedVersion: 1 });
  expect(sent.status).toBe(200);
  const { Engine } = await import("rp-core");
  const records = libraryFor(r.store.studioPath())!.core!;
  const linked = (await records.sceneFor(chat.id))!;
  const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(linked.sessionId);
    const path = (await session.view()).path;
    expect(path[0]?.blocks).toContainEqual({ k: "text", text: "Evening." });
  } finally { await engine.close(); }
});
