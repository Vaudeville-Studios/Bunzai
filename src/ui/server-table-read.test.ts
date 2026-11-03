/** Real authenticated local, LAN and mesh handlers share Table Read state without gaining library-management authority. */
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { freshDatabase, testCipher } from "../stage/store/sqlite/test-support";
import { sqliteStateStore } from "../stage/store/sqlite/state-store";
import { sqliteDocumentBackend } from "../stage/store/sqlite/document-backend";
import { sqliteChatStore } from "../stage/store/sqlite-chat-store";
import { createContentStore } from "../stage/store/content-store";
import type { StageDatabase } from "../stage/store/sqlite/database";
import { addLibrary } from "../studio/library-content";
import { StudioStore } from "../studio/store";
import { SettingsStore } from "../studio/settings";
import { createHandler, type UiHandler } from "./server-handler";
import { createTableReadRouteOwner } from "./server-table-read";
import { apiReq, filledSec } from "./server-test-rig";
import type { TableReadView } from "../core/table-read/schema";
import type { TableReadConnect } from "../studio/table-read/generate";

const databases: StageDatabase[] = [];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); for (const database of databases.splice(0)) database.close(); });
const settings = { tempo: "cold-read", connection: { id: "saved", model: "writer" }, idea: "Vesper runs a bar and trades in debts." };
const generated = { patches: [{ field: "name", value: "Vesper" }], covered: ["name"], question: { field: "personality", text: "Which debt would she forgive?", chips: ["Her brother's", "None"] }, note: "", followUp: null, deflection: false };

function fixture(connect?: TableReadConnect) {
  const database = freshDatabase(databases);
  const cipher = testCipher();
  const state = sqliteStateStore(database, cipher);
  const content = createContentStore(sqliteDocumentBackend(database, cipher));
  const root = join(tmpdir(), `table-read-routes-${crypto.randomUUID()}`);
  cleanup.push(addLibrary((path) => path === root ? { content, state, chats: sqliteChatStore(database, cipher) } : null));
  const store = new StudioStore(root);
  const config = new SettingsStore(root);
  const sec = filledSec();
  let calls = 0;
  const owner = createTableReadRouteOwner({ connect: connect ?? (async () => ({ kind: "script", provider: { id: "script", send: async () => { calls++; return { content: JSON.stringify(generated), raw: null }; } } })) });
  const make = (mode: "local" | "lan" | "mesh"): UiHandler => createHandler(store, config, undefined, sec, undefined, undefined, undefined,
    mode === "mesh" ? "mesh-test-secret" : undefined, mode === "lan" ? true : undefined, undefined, undefined, undefined, undefined, undefined, undefined, owner);
  const local = make("local"); const lan = make("lan"); const mesh = make("mesh");
  cleanup.push(() => owner.close());
  const post = (body: unknown, mode: "local" | "lan" | "mesh" = "local") => {
    const req = apiReq("/api/table-read", { method: "POST", token: sec.token, contentType: "application/json", body: JSON.stringify(body) });
    if (mode === "mesh") req.headers.set("x-bunzai-sidecar-secret", "mesh-test-secret");
    return ({ local, lan, mesh })[mode](req);
  };
  return { owner, store, sec, local, lan, mesh, post, calls: () => calls };
}

test("API auth and strict input checks refuse untrusted writes before any model call", async () => {
  const f = fixture();
  for (const bad of [
    apiReq("/api/table-read", { method: "POST", token: null, contentType: "application/json", body: "{}" }),
    apiReq("/api/table-read", { method: "POST", token: f.sec.token, origin: "https://evil.example", contentType: "application/json", body: "{}" }),
    apiReq("/api/table-read", { fetchSite: "cross-site" }),
  ]) expect((await f.local(bad)).status).toBe(403);
  expect((await f.lan(apiReq("/api/table-read", { method: "POST", token: f.sec.token, fetchSite: "cross-site", contentType: "application/json", body: "{}" }))).status).toBe(403);
  expect((await f.mesh(apiReq("/api/table-read"))).status).toBe(403);
  expect((await f.post({ action: "start", revision: -1, settings: { ...settings, baseURL: "https://evil.example" } })).status).toBe(400);
  expect((await f.post({ action: "edit", revision: 0, field: "__proto__", value: "bad" })).status).toBe(400);
  expect(f.calls()).toBe(0);
});

test("approved devices author through the real remote construction without a LibraryHandle and reopen the normal saved card", async () => {
  const f = fixture();
  const startedResponse = await f.post({ action: "start", revision: -1, settings }, "lan");
  expect(startedResponse.status).toBe(200);
  const started = await startedResponse.json() as TableReadView;
  expect(started.session?.question?.text).toContain("debt");
  const read = apiReq("/api/table-read"); read.headers.set("x-bunzai-sidecar-secret", "mesh-test-secret");
  const onPhone = await (await f.mesh(read)).json() as TableReadView;
  expect(onPhone.revision).toBe(started.revision);
  const review = await (await f.post({ action: "review", revision: started.revision }, "mesh")).json() as TableReadView;
  expect(await f.store.list("character")).toHaveLength(0);
  const saved = await (await f.post({ action: "save", revision: review.revision }, "lan")).json() as TableReadView;
  expect(saved.session?.phase).toBe("saved");
  const card = await f.store.read("character", saved.session!.saved!.id);
  expect(card?.kind).toBe("character");
  expect((await f.post({ action: "save", revision: review.revision })).status).toBe(409);
  expect(await f.store.list("character")).toHaveLength(1);
  expect(f.calls()).toBe(1);
});

test("closing a remote handler does not cancel another client's live operation, and its GET is read-only", async () => {
  let release: ((value: { content: string; raw: null }) => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const f = fixture(async () => ({ kind: "script", provider: { id: "script", send: async () => { entered!(); return new Promise((resolve) => { release = resolve; }); } } }));
  const pending = f.post({ action: "start", revision: -1, settings });
  await ready;
  const view = await (await f.lan(apiReq("/api/table-read"))).json() as TableReadView;
  expect(view.running).toBe(true);
  await f.lan.close();
  const observed = await (await f.local(apiReq("/api/table-read"))).json() as TableReadView;
  expect(observed.running).toBe(true);
  expect(observed.revision).toBe(view.revision);
  expect((await f.post({ action: "retry", revision: view.revision }, "mesh")).status).toBe(409);
  release!({ content: JSON.stringify(generated), raw: null });
  expect((await pending).status).toBe(200);
});
