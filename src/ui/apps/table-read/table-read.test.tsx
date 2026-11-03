/** User-facing Table Read contracts: real setup choices, chip-only mode and manual-edit recovery. */
import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { installDom, waitFor, type InstalledDom } from "../../_shared/test-dom";
import type { AppContext } from "../../app-contract";
import { newInterview } from "../../../core/table-read/interview";
import { setCharacterField } from "../../../core/table-read/fields";
import type { TableReadMutation, TableReadSession, TableReadView } from "../../../core/table-read/schema";
import { TableRead } from "./index";
import { PieceStore } from "../../_shared/piece-store";
import { READER_ART, READER_PREF } from "./reader-art";

let root: Root | null = null;
let installed: InstalledDom | null = null;
afterEach(async () => { await act(async () => root?.unmount()); root = null; await installed?.teardown(); installed = null; });

function interview(tempo: TableReadSession["settings"]["tempo"] = "deep-dive"): TableReadSession {
  const session = newInterview({ tempo, connection: { id: "ui-connection", model: "ui-model" }, idea: "Vesper keeps a bar and a ledger of favors." }, "ui-session", "ui-card");
  session.body = setCharacterField(session.body, "name", "Vesper");
  session.question = { id: "q1", field: "personality", text: "What does Vesper do when a debt goes unpaid?", chips: [{ id: "mercy", label: "She pays it herself", value: "She secretly pays it herself." }, { id: "ruin", label: "Public ruin", value: "She makes their ruin public." }] };
  return session;
}

async function mount(initial: TableReadView, respond?: (input: TableReadMutation) => Promise<TableReadView>, available = false, appearance?: unknown) {
  installed = installDom(undefined, { pretendToBeVisual: true, globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  const doc = installed.dom.window.document;
  const host = doc.createElement("div"); doc.body.append(host); root = createRoot(host);
  let view = initial;
  const calls: TableReadMutation[] = [];
  const opened: string[] = [];
  const pieces = new PieceStore();
  const prefs = new Map<string, unknown>([[READER_PREF, appearance]]);
  const ctx = {
    api: {
      getTableRead: async () => view,
      changeTableRead: async (input: TableReadMutation) => {
        calls.push(input);
        if (!respond) throw new Error("unexpected mutation");
        const next = await respond(input); view = next; return next;
      },
      sceneConnections: async () => available ? [{ id: "ui-connection", label: "Local model", kind: "openai", model: "ui-model" }] : [], connectionModels: async () => ({ saved: "ui-model", models: [{ id: "ui-model", label: "Interview model" }] }),
    }, prefs: { get: (key: string) => prefs.get(key), set: (key: string, value: unknown) => { prefs.set(key, value); } }, setStatus: () => undefined,
    openApp: (id: string) => opened.push(id), pieces, workbench: { open: () => undefined },
  } as unknown as AppContext;
  await act(async () => root!.render(<TableRead ctx={ctx} />));
  await waitFor(flushSync, () => !doc.body.textContent?.includes("Opening your Table Read..."), "Table Read to open");
  const button = (label: string): HTMLButtonElement => [...doc.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label)!;
  const leaveRoom = async (): Promise<void> => { await act(async () => root!.render(null)); };
  const returnToRoom = async (): Promise<void> => { await act(async () => root!.render(<TableRead ctx={ctx} />)); };
  return { ctx, doc, calls, opened, button, pieces, leaveRoom, returnToRoom, setReadView: (next: TableReadView) => { view = next; }, enableConnection: () => { available = true; } };
}

function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const win = installed!.dom.window;
  const prototype = field.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new win.Event("input", { bubbles: true }));
}

async function focusField(doc: Document, field: string): Promise<void> {
  const id = `table-read-field-${field}`;
  const section = doc.querySelector(`label[for="${id}"]`)!.closest('[data-part="table-read.card.field"]')!;
  const rendered = [...section.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Rendered");
  if (rendered) await act(async () => rendered.click());
  await act(async () => doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.focus());
}

test("setup exposes real modes and opens Connections instead of pretending a model exists", async () => {
  const { doc, button, opened } = await mount({ revision: -1, session: null, running: false });
  expect(doc.body.textContent).toContain("Cold Read");
  expect(doc.body.textContent).toContain("Deep Dive");
  expect(doc.body.textContent).toContain("Rapid Fire");
  expect(button("Begin the Table Read").disabled).toBe(true);
  await act(async () => button("Open Connections").click());
  expect(opened).toEqual(["settings"]);
  expect(installed!.dom.window.location.hash).toBe("#settings/models");
});

test("five reader appearances persist through preferences and never become interview settings", async () => {
  const { ctx, doc, button, calls, leaveRoom, returnToRoom } = await mount({ revision: -1, session: null, running: false }, async () => ({ revision: 0, session: interview(), running: false }), true, "unknown-reader");
  expect(READER_ART.length).toBe(5);
  expect(doc.querySelectorAll('[data-part="table-read.reader.choice"]').length).toBe(5);
  expect(button(READER_ART[0].label).getAttribute("aria-pressed")).toBe("true");
  const picked = READER_ART[3]!;
  await act(async () => button(picked.label).click());
  expect(ctx.prefs.get(READER_PREF)).toBe(picked.id);
  expect(calls).toEqual([]);
  await leaveRoom(); await returnToRoom();
  expect(button(picked.label).getAttribute("aria-pressed")).toBe("true");
  await waitFor(flushSync, () => doc.querySelector('option[value="ui-connection|ui-model"]'), "saved model choice");
  await act(async () => {
    fill(doc.querySelector<HTMLTextAreaElement>("#table-read-idea")!, "A keeper of debts.");
    const model = doc.querySelector<HTMLSelectElement>("#table-read-model")!;
    model.value = "ui-connection|ui-model";
    model.dispatchEvent(new installed!.dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => button("Begin the Table Read").click());
  expect(calls).toEqual([{ action: "start", revision: -1, settings: { tempo: "deep-dive", connection: { id: "ui-connection", model: "ui-model" }, idea: "A keeper of debts." } }]);
  expect(doc.querySelector<HTMLImageElement>('[data-part="table-read.scene.art"] img')!.getAttribute("src")).toBe(picked.image);
});

test("changing every reader appearance preserves active field and answer scratch without inference", async () => {
  const { ctx, doc, calls, leaveRoom, returnToRoom } = await mount({ revision: 4, session: interview(), running: false });
  await focusField(doc, "personality");
  await act(async () => {
    fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Private field scratch");
    fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, "Private answer scratch");
  });
  for (const reader of READER_ART) {
    await act(async () => {
      const select = doc.querySelector<HTMLSelectElement>('[data-part="table-read.reader.compact"] select')!;
      select.value = reader.id;
      select.dispatchEvent(new installed!.dom.window.Event("change", { bubbles: true }));
    });
    expect(doc.querySelector<HTMLImageElement>('[data-part="table-read.scene.art"] img')!.getAttribute("src")).toBe(reader.image);
    expect(ctx.prefs.get(READER_PREF)).toBe(reader.id);
    expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Private field scratch");
  }
  await leaveRoom(); await returnToRoom();
  expect(doc.querySelector<HTMLSelectElement>('[data-part="table-read.reader.compact"] select')!.value).toBe(READER_ART.at(-1)!.id);
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Private field scratch");
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!.value).toBe("Private answer scratch");
  expect(calls).toEqual([]);
});

test("Rapid Fire offers only its stored chip choices and submits the current question identity", async () => {
  const session = interview("rapid-fire");
  session.deadline = Date.now() + 90_000;
  const next = { ...session, turn: 1, question: null };
  const { doc, button, calls } = await mount({ revision: 4, session, running: false }, async () => ({ revision: 5, session: next, running: false }));
  expect(doc.querySelector("#table-read-answer")).toBeNull();
  expect(doc.body.textContent).not.toContain("Or write your own");
  await act(async () => button("She pays it herself").click());
  expect(calls).toEqual([{ action: "answer", revision: 4, questionId: "q1", answer: { kind: "chip", chipId: "mercy" } }]);
});

test("reopening expired Rapid Fire does not restart a stopped finish without an explicit action", async () => {
  const session: TableReadSession = { ...interview("rapid-fire"), deadline: Date.now() - 1000, error: "The previous finish was stopped. Your draft is kept.", retryKind: "finish" };
  const next: TableReadSession = { ...session, question: null, phase: "review", error: null, retryKind: null };
  const { doc, button, calls } = await mount({ revision: 8, session, running: false }, async (input) => {
    if (input.action !== "review") throw new Error("The expired round must wait for an explicit choice.");
    return { revision: 9, session: next, running: false };
  });
  expect(calls).toEqual([]);
  expect(button("She pays it herself").disabled).toBe(true);
  expect(doc.body.textContent).toContain("Time is up");
  await act(async () => button("Review current draft").click());
  expect(calls).toEqual([{ action: "review", revision: 8 }]);
});

test("a freeform answer stays literal and is sent against the visible draft revision", async () => {
  const session = interview();
  const next = { ...session, turn: 1, question: null, phase: "review" as const };
  const { doc, button, calls } = await mount({ revision: 6, session, running: false }, async () => ({ revision: 7, session: next, running: false }));
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, "She pays it herself, but {{user}} must never know."));
  await act(async () => button("Keep this answer").click());
  expect(calls).toEqual([{ action: "answer", revision: 6, questionId: "q1", answer: { kind: "freeform", text: "She pays it herself, but {{user}} must never know." } }]);
  expect(doc.body.textContent).toContain("Give them one last read.");
});

test("an unsuccessful manual edit keeps the user's text and prevents saving the unkept draft", async () => {
  const session = { ...interview(), phase: "review" as const, question: null };
  const { doc, button, calls } = await mount({ revision: 9, session, running: false }, async () => { throw new Error("Library is busy; try again."); });
  await focusField(doc, "personality");
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Ruthless, except when no one is looking."));
  expect(calls).toEqual([]);
  expect(button("Save character").disabled).toBe(true);
  await act(async () => button("Keep edit").click());
  expect(calls).toEqual([{ action: "edit", revision: 9, field: "personality", value: "Ruthless, except when no one is looking." }]);
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Ruthless, except when no one is looking.");
  expect(doc.body.textContent).toContain("Library is busy; try again.");
});

test("Workbench controls keep one local scratch through fullscreen and an accepted proposal", async () => {
  const session = interview();
  const { doc, button, calls, setReadView } = await mount({ revision: 2, session, running: false });
  expect(doc.querySelectorAll('[data-part="table-read.card"] [data-part="editor.field"]').length).toBe(7);
  await focusField(doc, "personality");
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Private scratch"));
  expect(calls).toEqual([]);
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-description")!.disabled).toBe(true);
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.maxLength).toBe(20_000);
  await act(async () => button("Expand Personality").click());
  const expanded = doc.querySelector<HTMLTextAreaElement>('[role="dialog"] #table-read-field-personality')!;
  expect(expanded.value).toBe("Private scratch");
  setReadView({ revision: 3, session: { ...session, body: setCharacterField(session.body, "personality", "Accepted proposal") }, running: false });
  await act(async () => installed!.dom.window.dispatchEvent(new installed!.dom.window.Event("focus")));
  expect(doc.querySelector('[role="dialog"] #table-read-field-personality')).toBe(expanded);
  expect(expanded.value).toBe("Private scratch");
  await act(async () => button("Collapse Personality").click());
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Private scratch");
  await act(async () => button("Cancel edit").click());
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Accepted proposal");
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-description")!.disabled).toBe(false);
  expect(calls).toEqual([]);
});

test("a committing session exposes neither editable fields nor discard", async () => {
  const session = { ...interview(), phase: "committing" as const, question: null, commit: { token: "save", owner: "owner", expires: Date.now() + 120_000 } };
  const { doc, button } = await mount({ revision: 10, session, running: false });
  expect(button("Discard interview").disabled).toBe(true);
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.disabled).toBe(true);
  expect(doc.body.textContent).toContain("Keeping your reviewed character");
  expect(button("Retry saving this character")).toBeDefined();
});

test("manual field editing stays available during generation, and explicitly resumes afterward", async () => {
  const session = { ...interview(), question: null, retryKind: "start" as const, pending: { token: "generating", owner: "owner", kind: "start" as const, expires: Date.now() + 120_000 } };
  const next = { ...session, pending: null, manual: ["description" as const], body: setCharacterField(session.body, "description", "") };
  const { doc, button, calls } = await mount({ revision: 3, session, running: true }, async () => ({ revision: 4, session: next, running: false }));
  await focusField(doc, "description");
  await act(async () => button("Keep edit").click());
  expect(calls).toEqual([{ action: "edit", revision: 3, field: "description", value: "" }]);
  expect(button("Continue the interview")).toBeDefined();
});

test("an unavailable provider does not block reviewing and saving the retained manual draft", async () => {
  let session: TableReadSession = { ...interview(), error: "The saved model is no longer available.", retryKind: "answer", question: null };
  session.body = setCharacterField(session.body, "name", "");
  session.body = setCharacterField(session.body, "personality", "She pays other people's debts and hates being thanked.");
  let revision = 20;
  const { doc, button, calls } = await mount({ revision, session, running: false }, async (input) => {
    if (input.action === "edit") session = { ...session, body: setCharacterField(session.body, input.field, input.value), manual: [input.field] };
    else if (input.action === "review") session = { ...session, phase: "review", retryKind: null, error: null };
    else if (input.action === "save") session = { ...session, phase: "saved", saved: { id: session.cardId, name: session.body.identity.name, kind: "character" } };
    else throw new Error("Recovery must not ask the unavailable model for more work.");
    return { revision: ++revision, session, running: false };
  });
  expect(doc.body.textContent).toContain("The saved model is no longer available.");
  await focusField(doc, "name");
  await act(async () => fill(doc.querySelector<HTMLInputElement>("#table-read-field-name")!, "Vesper"));
  await act(async () => button("Keep edit").click());
  await act(async () => button("Review current draft").click());
  expect(doc.body.textContent).toContain("This is your current draft");
  expect(doc.body.textContent).toContain("Still blank:");
  expect(button("Save character").disabled).toBe(false);
  await act(async () => button("Save character").click());
  expect(calls.map((input) => input.action)).toEqual(["edit", "review", "save"]);
  expect(doc.body.textContent).toContain("Your character is in the Library");
});

test("leaving and returning retains an unsent answer and an unkept living-card edit", async () => {
  const { doc, button, calls, leaveRoom, returnToRoom } = await mount({ revision: 2, session: interview(), running: false });
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, "She clears debts without telling anyone."));
  const answerUnload = new installed!.dom.window.Event("beforeunload", { cancelable: true });
  installed!.dom.window.dispatchEvent(answerUnload);
  expect(answerUnload.defaultPrevented).toBe(true);
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, ""));
  await focusField(doc, "personality");
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Mercy embarrasses her."));
  const editUnload = new installed!.dom.window.Event("beforeunload", { cancelable: true });
  installed!.dom.window.dispatchEvent(editUnload);
  expect(editUnload.defaultPrevented).toBe(true);
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, "She clears debts without telling anyone."));
  await leaveRoom();
  await returnToRoom();
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!.value).toBe("She clears debts without telling anyone.");
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("Mercy embarrasses her.");
  expect(button("Save character")).toBeUndefined();
  expect(calls).toEqual([]);
});

test("Setup survives the Connections trip, including its idea, tempo and model choice", async () => {
  const { doc, button, leaveRoom, returnToRoom, enableConnection } = await mount({ revision: -1, session: null, running: false });
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-idea")!, "An immortal debt collector who secretly forgives debts."));
  const rapid = [...doc.querySelectorAll<HTMLButtonElement>('[data-part="table-read.tempo"]')].find((item) => item.textContent?.includes("Rapid Fire"))!;
  await act(async () => rapid.click());
  await act(async () => button("Open Connections").click());
  await leaveRoom(); enableConnection(); await returnToRoom();
  await waitFor(flushSync, () => doc.querySelector('option[value="ui-connection|ui-model"]'), "saved model choice");
  const select = doc.querySelector<HTMLSelectElement>("#table-read-model")!;
  await act(async () => { select.value = "ui-connection|ui-model"; select.dispatchEvent(new installed!.dom.window.Event("change", { bubbles: true })); });
  await leaveRoom(); await returnToRoom();
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-idea")!.value).toBe("An immortal debt collector who secretly forgives debts.");
  expect(doc.querySelector<HTMLSelectElement>("#table-read-model")!.value).toBe("ui-connection|ui-model");
  const picked = doc.querySelector<HTMLButtonElement>('[data-part="table-read.tempo"][aria-pressed="true"]');
  expect(picked?.textContent).toContain("Rapid Fire");
});

test("a Rapid Fire deck starts at ninety seconds after a long idle Setup", async () => {
  let now = 1000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const { doc, button } = await mount({ revision: -1, session: null, running: false }, async () => {
      const session = { ...interview("rapid-fire"), deadline: now + 90_000 };
      return { revision: 0, session, running: false };
    }, true);
    await waitFor(flushSync, () => doc.querySelector('option[value="ui-connection|ui-model"]'), "saved model choice");
    await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-idea")!, "Vesper runs a bar."));
    await act(async () => { const select = doc.querySelector<HTMLSelectElement>("#table-read-model")!; select.value = "ui-connection|ui-model"; select.dispatchEvent(new installed!.dom.window.Event("change", { bubbles: true })); });
    now = 61_000;
    await act(async () => button("Begin the Table Read").click());
    expect(doc.querySelector('[role="timer"]')?.textContent).toBe("90s");
  } finally { clock.mockRestore(); }
});

test("finishing the Rapid Fire choices waits for an explicit review or model request", async () => {
  const session = { ...interview("rapid-fire"), deadline: Date.now() + 60_000, question: null, deck: [] };
  const { doc, button, calls, leaveRoom, returnToRoom } = await mount({ revision: 3, session, running: false });
  await leaveRoom(); await returnToRoom();
  expect(doc.body.textContent).toContain("All choices kept");
  expect(doc.body.textContent).not.toContain("Finding the next question");
  expect(doc.querySelector('[role="timer"]')).toBeNull();
  expect(button("Review current draft")).toBeDefined();
  expect(button("Finish with the interviewer")).toBeDefined();
  expect(calls).toEqual([]);
});

test("locking the library clears unsent scratch text before the room is reopened", async () => {
  const { doc, button, pieces, leaveRoom, returnToRoom } = await mount({ revision: 2, session: interview(), running: false });
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!, "Private unsent answer"));
  await focusField(doc, "personality");
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Private unkept edit"));
  await act(async () => pieces.setLock("locked"));
  await leaveRoom();
  await act(async () => pieces.setLock("unlocked"));
  await returnToRoom();
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-answer")!.value).toBe("");
  expect(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!.value).toBe("");
  expect(doc.body.textContent).not.toContain("Private unkept edit");
});

test("a restored lower revision replaces the old library view and rejects an old in-flight answer", async () => {
  let finish!: (view: TableReadView) => void;
  const old = interview();
  const { doc, button, pieces, setReadView } = await mount({ revision: 80, session: old, running: false }, () => new Promise((resolve) => { finish = resolve; }));
  await act(async () => button("She pays it herself").click());
  const restored = { ...interview(), id: "restored-session", body: setCharacterField(old.body, "name", "Restored Vesper") };
  setReadView({ revision: 0, session: restored, running: false });
  await act(async () => { pieces.setLock("locked"); });
  await act(async () => { pieces.setLock("unlocked"); });
  await waitFor(flushSync, () => doc.querySelector<HTMLInputElement>("#table-read-field-name")?.value === "Restored Vesper", "restored lower-revision interview");
  await act(async () => finish({ revision: 81, session: { ...old, body: setCharacterField(old.body, "name", "Stale completion") }, running: false }));
  expect(doc.querySelector<HTMLInputElement>("#table-read-field-name")!.value).toBe("Restored Vesper");
  expect(button("She pays it herself").disabled).toBe(false);
});

test("an unkept field stays selectable and discardable when another client commits and saves", async () => {
  const session = interview();
  const { doc, button, calls, setReadView } = await mount({ revision: 4, session, running: false });
  await focusField(doc, "personality");
  await act(async () => fill(doc.querySelector<HTMLTextAreaElement>("#table-read-field-personality")!, "Mercy embarrasses her."));
  const committing: TableReadSession = { ...session, phase: "committing", commit: { token: "save", owner: "other-client", expires: Date.now() + 120_000 } };
  setReadView({ revision: 5, session: committing, running: true });
  await act(async () => installed!.dom.window.dispatchEvent(new installed!.dom.window.Event("focus")));
  const retained = doc.querySelector<HTMLTextAreaElement>("#table-read-retained-edit")!;
  expect(retained?.value).toBe("Mercy embarrasses her.");
  expect(retained.readOnly).toBe(true);
  retained.select();
  expect(retained.selectionEnd - retained.selectionStart).toBe(retained.value.length);
  expect(button("Copy unkept edit")).toBeDefined();
  setReadView({ revision: 6, session: { ...committing, phase: "saved", commit: null, saved: { id: session.cardId, name: "Vesper", kind: "character" } }, running: false });
  await act(async () => installed!.dom.window.dispatchEvent(new installed!.dom.window.Event("focus")));
  expect(button("Start another").disabled).toBe(true);
  await act(async () => button("Discard unkept edit").click());
  expect(button("Start another").disabled).toBe(false);
  expect(doc.querySelector("#table-read-retained-edit")).toBeNull();
  expect(calls).toEqual([]);
});

test("a different PieceStore can load while an old owner with the same numeric lifetime is still reading", async () => {
  const { ctx, doc } = await mount({ revision: 7, session: interview(), running: false });
  let finishOld!: (view: TableReadView) => void;
  ctx.api.getTableRead = () => new Promise((resolve) => { finishOld = resolve; });
  await act(async () => installed!.dom.window.dispatchEvent(new installed!.dom.window.Event("focus")));
  const restored = { ...interview(), id: "other-library", body: setCharacterField(interview().body, "name", "Different library") };
  const replacement = { ...ctx, pieces: new PieceStore(), api: { ...ctx.api, getTableRead: async () => ({ revision: 0, session: restored, running: false }) } };
  await act(async () => root!.render(<TableRead ctx={replacement} />));
  expect(doc.querySelector<HTMLInputElement>("#table-read-field-name")!.value).toBe("Different library");
  await act(async () => finishOld({ revision: 8, session: interview(), running: false }));
  expect(doc.querySelector<HTMLInputElement>("#table-read-field-name")!.value).toBe("Different library");
});

test("keyboard choices focus the new question without moving pointer choices to the heading", async () => {
  const session = interview();
  let turn = 0;
  const { doc, button } = await mount({ revision: 1, session, running: false }, async () => {
    turn++;
    return { revision: turn + 1, session: { ...session, turn, question: { ...session.question!, id: `next-${turn}`, text: `A more revealing question ${turn}` } }, running: false };
  });
  await act(async () => {
    const choice = button("She pays it herself"); choice.focus();
    choice.dispatchEvent(new installed!.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    choice.click();
  });
  expect(doc.activeElement?.textContent).toBe("A more revealing question 1");
  await act(async () => {
    const choice = button("She pays it herself");
    choice.dispatchEvent(new installed!.dom.window.Event("pointerdown", { bubbles: true }));
    choice.click();
  });
  expect(doc.activeElement?.textContent).not.toBe("A more revealing question 2");
});
