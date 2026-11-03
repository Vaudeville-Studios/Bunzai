/** An imported legacy scene keeps an unsupported writing kind while strict Studio reads reject it. */
import { afterEach, expect, test } from "bun:test";
import type { InspectResult, SaveBundleResult } from "./app-contract";
import { chatRouteRig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);

const legacyChat = [
  { user_name: "Test User", character_name: "Vera", create_date: "2026-11-02 @12h 00m 00s 000ms" },
  { name: "Vera", is_user: false, send_date: "November 2, 2026 12:01pm", mes: "Legacy scene fixture." },
  { name: "Test User", is_user: true, send_date: "November 2, 2026 12:02pm", mes: "Can this be recovered?" },
].map((row) => JSON.stringify(row)).join("\n") + "\n";

test("an imported legacy scene keeps an unsupported preset kind and the strict Studio read reports it", async () => {
  const r = await chatRouteRig();
  await r.store.save(vera);
  const inspect = apiReq("/api/inspect", {
    method: "POST", token: r.token, contentType: "application/octet-stream", body: new TextEncoder().encode(legacyChat),
  });
  inspect.headers.set("x-filename", encodeURIComponent("Preset Recovery Fixture - chat.jsonl"));
  const inspected = (await (await r.handler(inspect)).json()) as InspectResult;
  expect(inspected).toMatchObject({ ok: true, kind: "scene", formatId: "sillytavern-chat" });

  const saved = (await (await r.post("/api/studio/save-bundle", { entity: inspected.entity })).json()) as SaveBundleResult;
  expect(saved).toMatchObject({ ok: true, scene: { title: "Vera" } });
  const chatId = saved.scene!.sceneId;
  const selected = await r.post("/api/chats/preset", { chatId, preset: { kind: "futurewriting", id: "retired-slot", toggles: {}, samplers: {} } });
  expect(selected.status).toBe(200);

  const opened = (await (await r.handler(apiReq(`/api/chats/open?id=${chatId}`, { token: r.token }))).json()) as { chat: { preset?: unknown } };
  expect(opened.chat.preset).toEqual({ kind: "futurewriting", id: "retired-slot", toggles: {}, samplers: {} });
  const read = await r.handler(apiReq("/api/studio/get?kind=futurewriting&id=retired-slot&revision=1", { token: r.token }));
  expect(read.status).toBe(400);
  expect(await read.json()).toMatchObject({ error: "invalid entity kind" });
});
