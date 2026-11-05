/** Purpose: a host scene whose rp-core header was never written is finished by the next route, never left blocked. */
import { afterEach, expect, test } from "bun:test";
import { CAST, SNAP } from "../stage/contracts/chat-store.contract-rig";
import { cleanupChatRouteRigs, chatRouteRig } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";
import { libraryFor } from "../studio/library-content";

afterEach(cleanupChatRouteRigs);

test("a take-only route finishes a host scene whose rp-core header was never written, and changes nothing else", async () => {
  const rig = await chatRouteRig({ core: true });
  const opened = rig.library.opened();
  const stores = libraryFor(rig.store.studioPath());
  if (!opened || !stores?.core || stores.chats !== opened.chats) throw new Error("unlocked Core library unavailable");
  if (!opened.chats.createCoreChat) throw new Error("SQLite ChatStore lacks Core-first creation");
  const scene = await opened.chats.createCoreChat({ title: "Incomplete Core birth", cast: CAST, snapshot: SNAP });
  expect(await stores.core.unlinkedBirth(scene.id)).toEqual({ origin: "host", operationId: `host:create:${scene.id}` });
  expect(await stores.core.sceneForBranch(scene.activeBranchId)).toBeNull();

  for (const [path, body] of [
    ["/api/chats/delete-take", { branchId: scene.activeBranchId }],
    ["/api/chats/restore-take", { id: scene.activeBranchId }],
    ["/api/chats/take", { branchId: scene.activeBranchId }],
    ["/api/chats/fork", { chatId: scene.id, messageId: "missing-message" }],
    ["/api/chats/core-settings", { chatId: scene.id, feature: "memory", enabled: true }],
  ] as const) expect((await rig.post(path, body)).status).not.toBe(409);
  expect(await stores.core.unlinkedBirth(scene.id)).toBeNull();
  expect(await stores.core.sceneFor(scene.id)).toMatchObject({ branchId: scene.activeBranchId });

  const unchanged = await opened.chats.getChat(scene.id);
  expect(unchanged?.activeBranchId).toBe(scene.activeBranchId);
  expect(await opened.chats.countMessages(scene.activeBranchId)).toBe(0);
  expect((await rig.post("/api/chats/delete", { id: scene.id })).status).toBe(200);
  expect(await opened.chats.getChat(scene.id)).toBeNull();
  const trash = await rig.handler(apiReq("/api/chats/trash"));
  expect(trash.status).toBe(200);
});
