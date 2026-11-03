/** Verifies backdrop presentation is ChatStore state even for linked Core scenes. */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { Engine } from "rp-core";
import { libraryFor } from "../studio/library-content";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

const HOME = join(tmpdir(), `bunzai-backdrop-core-${randomUUID()}`);
let restoreBunzaiHome: (() => void) | undefined;

beforeAll(() => { restoreBunzaiHome = useTestBunzaiHome(HOME); });
afterEach(cleanupChatRouteRigs);
afterAll(async () => { await rm(HOME, { recursive: true, force: true }).finally(() => restoreBunzaiHome?.()); });
test("a linked Core scene saves backdrop presentation in ChatStore without writing the Core journal or config", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const records = libraryFor(r.store.studioPath())!.core!;
  const linked = (await records.sceneFor(chat.id))!;
  const beforeJournal = await records.journalRevision(linked.sessionId);
  const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(linked.sessionId);
    const before = { version: await session.version(), config: session.configurationSnapshot() };
    const backdrop = { pack: "backdrops", item: "harbor", dim: 0.43 };
    const response = await r.post("/api/chats/backdrop", { chatId: chat.id, backdrop });
    expect(response.status).toBe(200);
    expect((await response.json() as { backdrop: unknown }).backdrop).toEqual(backdrop);
    expect((await r.post("/api/chats/backdrop", { chatId: chat.id, backdrop: { ...backdrop, extra: true } })).status).toBe(400);
    const opened = (await (await r.handler(apiReq(`/api/chats/settings?chatId=${chat.id}`))).json()) as { backdrop?: unknown };
    expect(opened.backdrop).toEqual(backdrop);
    expect(await records.journalRevision(linked.sessionId)).toBe(beforeJournal);
    expect({ version: await session.version(), config: session.configurationSnapshot() }).toEqual(before);
    const forgotten = await r.post("/api/chats/backdrop", { chatId: chat.id, backdrop: null });
    expect(forgotten.status).toBe(200);
    expect("backdrop" in ((await (await r.handler(apiReq(`/api/chats/settings?chatId=${chat.id}`))).json()) as object)).toBe(false);
    expect(await records.journalRevision(linked.sessionId)).toBe(beforeJournal);
  } finally { await engine.close(); }
});
