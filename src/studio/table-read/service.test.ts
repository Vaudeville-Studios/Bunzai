/** Public interview lifecycle proves encrypted resume, stale-generation fencing and recoverable exact-once character saves. */
import { afterEach, expect, test } from "bun:test";
import { createContentStore } from "../../stage/store/content-store";
import { sqliteDocumentBackend } from "../../stage/store/sqlite/document-backend";
import { sqliteStateStore } from "../../stage/store/sqlite/state-store";
import { freshDatabase, testCipher } from "../../stage/store/sqlite/test-support";
import type { StageDatabase } from "../../stage/store/sqlite/database";
import type { StateStore } from "../../stage/contracts/state-store";
import type { Provider } from "../../stage/contracts/provider";
import { StudioStore } from "../store";
import { TableReadService } from "./service";
import { emptyCharacterBody } from "../../entities/character/schema";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import type { TableReadModelAnswer, TableReadView } from "../../core/table-read/schema";

const databases: StageDatabase[] = [];
const services: TableReadService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.close())); for (const database of databases.splice(0)) database.close(); });
const settings = { tempo: "cold-read" as const, connection: { id: "local", model: "writer" }, idea: "Vesper runs the Lumen Room bar and trades in debts." };
const answer = (patch: Partial<TableReadModelAnswer> = {}): TableReadModelAnswer => ({ patches: [{ field: "name", value: "Vesper" }], covered: ["name"], question: { field: "personality", text: "Which debt would she forgive?", chips: ["Her brother's", "None"] }, note: "", followUp: null, deflection: false, ...patch });
const finished = answer({ patches: [{ field: "description", value: "A bartender who trades in debts." }, { field: "firstMessage", value: "Vesper closes the ledger. Whose name are we dancing around?" }], question: null });

function fixture() {
  const database = freshDatabase(databases);
  const cipher = testCipher();
  const state = sqliteStateStore(database, cipher);
  const content = createContentStore(sqliteDocumentBackend(database, cipher));
  const studio = new StudioStore("table-read-fixture", () => content);
  const script: Provider["send"][] = [];
  let calls = 0;
  let ordinal = 0;
  let now = 1_000;
  const make = (store: StateStore = state, create = (raw: unknown) => studio.compareAndCreate(raw)) => {
    const service = new TableReadService({ state: store, studio: { compareAndCreate: create, read: (kind, id) => studio.read(kind, id) }, now: () => now, id: () => `test-${ordinal++}`, connect: async () => ({ kind: "openai-compatible", context: 32_000, provider: { id: "script", send: async (request, io) => { calls++; expect(request.options.disallow_tools).toBe(true); expect(request.options.tools).toBeUndefined(); const step = script.shift(); if (!step) throw new Error("missing script"); return step(request, io); } } }) });
    services.push(service);
    return service;
  };
  const json = (value: unknown) => script.push(async () => ({ content: JSON.stringify(value), raw: null }));
  return { database, cipher, state, studio, content, make, json, script, calls: () => calls, advance: (ms: number) => { now += ms; } };
}

async function review(f: ReturnType<typeof fixture>, service: TableReadService): Promise<TableReadView> {
  f.json(answer());
  const started = await service.change({ action: "start", revision: -1, settings });
  f.json(finished);
  return service.change({ action: "finish", revision: started.revision });
}

test("a scripted interview creates no card until explicit save, resumes encrypted draft and saves one ordinary character", async () => {
  const f = fixture();
  const service = f.make();
  f.json(answer());
  let view = await service.change({ action: "start", revision: -1, settings });
  expect(await f.studio.list("character")).toEqual([]);
  view = await service.change({ action: "edit", revision: view.revision, field: "description", value: "She is kind only when nobody can see it." });
  f.json(finished);
  view = await service.change({ action: "finish", revision: view.revision });
  expect(view.session?.body.identity.description).toBe("She is kind only when nobody can see it.");
  expect(view.session?.phase).toBe("review");
  expect((await f.make().read()).session?.body).toEqual(view.session?.body);
  const cell = f.database.statement("SELECT body FROM studio_state WHERE key = 'tableRead'").get() as { body: string };
  expect(cell.body).not.toContain("nobody can see");
  const results = await Promise.allSettled([service.change({ action: "save", revision: view.revision }), service.change({ action: "save", revision: view.revision })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const saved = await service.read();
  expect(saved.session?.phase).toBe("saved");
  expect(await f.studio.list("character")).toHaveLength(1);
  const card = await f.studio.read("character", saved.session!.saved!.id);
  expect(card?.kind).toBe("character");
  if (card?.kind === "character") expect(card.body.identity.description).toBe("She is kind only when nobody can see it.");
});

test("a second client cannot restart a live request; manual edits fence late generation and persist into later requests", async () => {
  const f = fixture();
  let release: ((value: Awaited<ReturnType<Provider["send"]>>) => void) | undefined;
  let called: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { called = resolve; });
  f.script.push(async () => { called!(); return new Promise((resolve) => { release = resolve; }); });
  const first = f.make();
  const task = first.change({ action: "start", revision: -1, settings });
  await entered;
  const second = f.make();
  const pending = await second.read();
  expect(pending.session?.pending).not.toBeNull();
  const retryError = await second.change({ action: "retry", revision: pending.revision }).then(() => null, (error: unknown) => error);
  expect(retryError).toBeInstanceOf(Error);
  expect(f.calls()).toBe(1);
  const edited = await second.change({ action: "edit", revision: pending.revision, field: "name", value: "My Vesper" });
  release!({ content: JSON.stringify(answer()), raw: null });
  expect((await task).session?.body.identity.name).toBe("My Vesper");
  f.json(answer());
  const resumed = await second.change({ action: "retry", revision: edited.revision });
  expect(resumed.session?.body.identity.name).toBe("My Vesper");
  expect(resumed.session?.manual).toContain("name");
});

test("Stop and shutdown settle even if a provider ignores cancellation, and GET never mutates the pending draft", async () => {
  const f = fixture();
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  f.script.push(async () => { entered!(); return new Promise(() => {}); });
  const service = f.make();
  const task = service.change({ action: "start", revision: -1, settings });
  await ready;
  const view = await service.read();
  expect((await service.read()).revision).toBe(view.revision);
  const stopped = await service.change({ action: "stop", revision: view.revision });
  expect(stopped.session?.error).toContain("Stopped");
  expect((await task).session?.pending).toBeNull();
  f.script.push(async () => new Promise(() => {}));
  const again = service.change({ action: "retry", revision: stopped.revision });
  // The document write is the public signal that the new request has been accepted.
  while (!(await service.read()).session?.pending) await new Promise((resolve) => setTimeout(resolve, 0));
  await service.close();
  await again.catch(() => undefined);
});

test("a failed create freezes the reviewed body; explicit save recovery retains the stable identity", async () => {
  const f = fixture();
  let fail = true;
  const service = f.make(f.state, async (raw) => { if (fail) { fail = false; throw new Error("interrupted before create"); } return f.studio.compareAndCreate(raw); });
  const view = await review(f, service);
  await service.change({ action: "save", revision: view.revision }).catch(() => undefined);
  const frozen = await service.read();
  expect(frozen.session?.phase).toBe("committing");
  for (const action of ["discard", "finish", "stop"] as const) expect(await service.change({ action, revision: frozen.revision }).then(() => false, () => true)).toBe(true);
  expect(await service.change({ action: "edit", revision: frozen.revision, field: "name", value: "No" }).then(() => false, () => true)).toBe(true);
  const saved = await service.change({ action: "save", revision: frozen.revision });
  expect(saved.session?.saved?.id).toBe(frozen.session?.cardId);
  expect(await f.studio.list("character")).toHaveLength(1);
});

test("a lost receipt after create recovers exactly once after the old owner lease expires", async () => {
  const f = fixture();
  let failReceipt = true;
  const state: StateStore = { ...f.state, writeIfRevision: async (key, text, revision) => {
    if (failReceipt && text.includes('"phase":"saved"')) { failReceipt = false; throw new Error("receipt write interrupted"); }
    return f.state.writeIfRevision!(key, text, revision);
  } };
  const service = f.make(state);
  const view = await review(f, service);
  await service.change({ action: "save", revision: view.revision }).catch(() => undefined);
  const frozen = await service.read();
  expect(await f.studio.list("character")).toHaveLength(1);
  const restarted = f.make(state);
  expect(await restarted.change({ action: "save", revision: frozen.revision }).then(() => false, () => true)).toBe(true);
  f.advance(120_001);
  expect((await restarted.change({ action: "save", revision: frozen.revision })).session?.phase).toBe("saved");
  expect(await f.studio.list("character")).toHaveLength(1);
});

test("shutdown joins an accepted storage write rather than racing a timeout and closing underneath it", async () => {
  const f = fixture();
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const service = f.make(f.state, async (raw) => { enter!(); await gate; return f.studio.compareAndCreate(raw); });
  const view = await review(f, service);
  const saving = service.change({ action: "save", revision: view.revision });
  await entered;
  let closed = false;
  const closing = service.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release!();
  await saving.catch(() => undefined);
  await closing;
  expect(closed).toBe(true);
  expect(await f.studio.list("character")).toHaveLength(1);
  const restarted = f.make();
  expect((await restarted.read()).session?.phase).toBe("committing");
  f.advance(120_001);
  expect((await restarted.change({ action: "save", revision: (await restarted.read()).revision })).session?.phase).toBe("saved");
  expect(await f.studio.list("character")).toHaveLength(1);
});

test("expired Rapid Fire rounds stay read-only on reload and two explicit finishes spend only one new call", async () => {
  const f = fixture();
  const service = f.make();
  f.json({ patches: [{ field: "name", value: "Vesper" }], questions: Array.from({ length: 5 }, (_, index) => ({ field: "personality", text: `Pressure ${index}`, chips: ["Keep the promise", "Break the promise"] })) });
  let view = await service.change({ action: "start", revision: -1, settings: { ...settings, tempo: "rapid-fire" } });
  f.advance(90_001);
  expect((await service.read()).revision).toBe(view.revision);
  expect(f.calls()).toBe(1);
  f.json(finished);
  const results = await Promise.allSettled([service.change({ action: "finish", revision: view.revision }), service.change({ action: "finish", revision: view.revision })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(f.calls()).toBe(2);
  view = await service.read();
  expect(view.session?.phase).toBe("review");
});

test("the last Rapid Fire choice and reload spend no inference; synthesis remains explicit", async () => {
  const f = fixture();
  const service = f.make();
  f.json({ patches: [{ field: "name", value: "Vesper" }], questions: Array.from({ length: 5 }, (_, index) => ({ field: "personality", text: `Pressure ${index}`, chips: ["Keep the promise", "Break the promise"] })) });
  let view = await service.change({ action: "start", revision: -1, settings: { ...settings, tempo: "rapid-fire" } });
  for (let index = 0; index < 5; index++) {
    const question = view.session!.question!;
    view = await service.change({ action: "answer", revision: view.revision, questionId: question.id, answer: { kind: "chip", chipId: question.chips[0]!.id } });
    expect(f.calls()).toBe(1);
  }
  expect(view.session?.transcript).toHaveLength(5);
  expect(view.session?.question).toBeNull();
  expect(view.session?.phase).toBe("interview");
  expect((await f.make().read()).revision).toBe(view.revision);
  expect(f.calls()).toBe(1);
  f.json(finished);
  expect((await service.change({ action: "finish", revision: view.revision })).session?.phase).toBe("review");
  expect(f.calls()).toBe(2);
});

test("an existing different or retired character is never overwritten or resurrected", async () => {
  for (const retired of [false, true]) {
    const f = fixture();
    const service = f.make();
    const view = await review(f, service);
    const id = view.session!.cardId;
    await f.studio.compareAndCreate({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id, body: emptyCharacterBody("Someone else") });
    if (retired) await f.studio.delete("character", id);
    const error = await service.change({ action: "save", revision: view.revision }).then(() => null, (value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((await f.studio.read("character", id))?.kind === "character" ? (await f.studio.read("character", id))?.body : null).toEqual(retired ? null : emptyCharacterBody("Someone else"));
    const conflicted = await service.read();
    expect(conflicted.session?.phase).toBe("review");
    expect(conflicted.session?.error).toContain("Nothing was overwritten");
    const edited = await service.change({ action: "edit", revision: conflicted.revision, field: "name", value: "Draft retained" });
    expect((await service.change({ action: "discard", revision: edited.revision })).session).toBeNull();
  }
});

test("damaged persisted state is refused without clearing it, and failed model output retains retryable idea", async () => {
  const f = fixture();
  const service = f.make();
  f.script.push(async () => ({ content: '{"untrusted":"not the protocol"}', raw: null }));
  const failed = await service.change({ action: "start", revision: -1, settings });
  expect(failed.session?.error).toContain("unreadable");
  expect(failed.session?.settings.idea).toBe(settings.idea);
  await f.state.write("tableRead", "not JSON");
  const error = await service.read().then(() => null, (value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(await f.state.read("tableRead")).toBe("not JSON");
});

test("a failed provider never traps the current draft behind another paid call", async () => {
  const f = fixture();
  const service = f.make();
  f.script.push(async () => { throw new Error("provider disappeared"); });
  let view = await service.change({ action: "start", revision: -1, settings });
  expect(view.session?.error).toContain("could not finish");
  view = await service.change({ action: "edit", revision: view.revision, field: "name", value: "My retained character" });
  view = await service.change({ action: "review", revision: view.revision });
  expect(view.session?.phase).toBe("review");
  expect(await f.studio.list("character")).toHaveLength(0);
  view = await service.change({ action: "save", revision: view.revision });
  expect(view.session?.saved?.name).toBe("My retained character");
  expect(await f.studio.list("character")).toHaveLength(1);
  expect(f.calls()).toBe(1);
});
