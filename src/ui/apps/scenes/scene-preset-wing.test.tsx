/**
 * The Prompting wing (scene-preset-wing.tsx) as it actually mounts: the write-debounce and the
 * preset picker's hand-off between the scene's own overrides and a freshly chosen library preset.
 *
 * WHY A RENDER TEST. toggleBlock/toggleGroup/setSampler are pure and proven in preset-core.test.ts;
 * what is NOT proven there is the wing's own state machine around them - the 300ms debounce that
 * coalesces a slider drag into one write, the flush-on-unmount that must not drop a pending one, and
 * the picker's two paths (the current preset re-chosen vs. a different one chosen) which must never
 * let a write meant for the preset being LEFT arrive after the switch. Each of those is a real bug an
 * agent made in this file's history, and none of them show up in a pure-function test.
 *
 * Typing is not simulated (see macro-lab/room.test.tsx's file header for why); nothing here exercises
 * PromptEditor's textarea onChange path, only buttons and the DOM they produce.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import type { PresetBody, PresetPrompt } from "../../../entities/preset/schema";
import type { Chat, ChatPreset } from "../../../stage/contracts/chat-store";
import type { JSX } from "react";
import type { PresetText } from "./use-scene-preset-text";
import { ApiHttpError } from "../../_shared/api-fetch";
import { waitFor } from "../../_shared/test-dom";
import { expectWindowed, installDom, type InstalledDom } from "../../_shared/test-dom";

/** PromptList virtualizes now: `@tanstack/react-virtual` unconditionally
 * touches `ResizeObserver` when it measures a row, which plain jsdom has no built-in for. */

let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8321/",
    pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: {
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
    }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", {
    configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 240 : 200; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
    configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 400 : 40; },
  });
});
afterAll(() => installed.teardown());

// -- fixtures ------------------------------------------------------------------------------------

const block = (id: string, over: Partial<PresetPrompt> = {}): PresetPrompt => ({
  id, name: id, content: `content-${id}`, role: "system", enabled: true, systemPrompt: true, marker: false,
  placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false, ...over,
});

const presetBody: PresetBody = {
  name: "Test Preset",
  prompts: [
    block("main"),
    block("style1", { groupId: "style" }),
    block("style2", { groupId: "style", enabled: false }),
  ],
  groups: [{ id: "style", name: "Style" }],
  samplers: {},
};

const entity = { kind: "preset", id: "p1", body: presetBody };

const library: StudioEntitySummary[] = [
  { id: "p1", kind: "preset", name: "Test Preset" },
  { id: "p2", kind: "preset", name: "Second Preset" },
];

const cast = { character: { id: "c1", version: 1, name: "Char" } } as Chat["cast"];

const chatWith = (preset: ChatPreset | null): Chat => ({
  id: "chat1",
  title: "Scene",
  cast,
  activeBranchId: "b1",
  createdAt: 0,
  updatedAt: 0,
  snapshotVersion: 1,
  preset: preset ?? undefined,
});

// -- recording stubs -------------------------------------------------------------------------------

let getCalls: string[] = [];
let listCalls: (string | undefined)[] = [];
let setCalls: { chatId: string; preset: ChatPreset | null }[] = [];
let saveCalls: { entity: unknown; revision: string }[] = [];
let changedCalls: Chat[] = [];

let getImpl: () => Promise<{ entity: unknown; revision: string }>;
let listImpl: () => Promise<StudioEntitySummary[]>;
let setImpl: (chatId: string, preset: ChatPreset | null) => Promise<Chat>;
let saveImpl: (entity: unknown, revision: string) => Promise<{ revision: string }>;

const resetRecorders = (): void => {
  getCalls = [];
  listCalls = [];
  setCalls = [];
  saveCalls = [];
  changedCalls = [];
  getImpl = async () => ({ entity, revision: "r1" });
  listImpl = async () => library;
  // The scene store's real contract: a write resolves the whole Chat carrying the preset it was sent.
  setImpl = async (chatId, preset) => ({ ...chatWith(preset), id: chatId });
  saveImpl = async () => ({ revision: "r2" });
};

beforeEach(() => { installed.reinstall(); resetRecorders(); });

function makeCtx(): AppContext {
  return {
    api: {
      getEditableEntity: async (id: string) => { getCalls.push(id); return getImpl(); },
      listEntities: async (kind?: string) => { listCalls.push(kind); return (await listImpl()).filter((piece) => piece.kind === kind); },
      setScenePreset: async (chatId: string, preset: ChatPreset | null) => {
        setCalls.push({ chatId, preset });
        return setImpl(chatId, preset);
      },
      saveEditedEntity: async (ent: unknown, revision: string) => {
        saveCalls.push({ entity: ent, revision });
        return saveImpl(ent, revision);
      },
    },
    workbench: { open: () => undefined },
    prefs: { get: () => undefined, set: () => undefined },
    openApp: () => undefined,
  } as unknown as AppContext;
}

// -- DOM plumbing ----------------------------------------------------------------------------------

let root: Root;
let host: HTMLElement;

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll("button")];
const byText = (text: string): HTMLButtonElement | undefined =>
  buttons().find((b) => (b.textContent ?? "").includes(text));
const byTitle = (text: string): HTMLButtonElement | undefined =>
  buttons().find((b) => b.title.includes(text));
const byLabel = (text: string): HTMLButtonElement | undefined =>
  buttons().find((b) => (b.getAttribute("aria-label") ?? "").includes(text));
const bodyText = (): string => host.textContent ?? "";

const onChanged = (c: Chat): void => { changedCalls.push(c); };
const onBody = (): void => undefined;

type FlushSync = typeof import("react-dom")["flushSync"];

/** Every group starts folded, as in RoleCall; these tests are about the rows, so each settle unfolds what it finds folded. */
async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  flushSync(() => undefined);
  for (const head of host.querySelectorAll<HTMLButtonElement>("[data-part='scene.preset.category'][aria-expanded=false]")) flushSync(() => head.click());
}

/** What the Prompting wing does: one text writer owned above the tab, handed to it. `text` is that writer, for the tests that drive it. */
let text: PresetText;
let Harness: (props: { chat: Chat; ctx: AppContext }) => JSX.Element;
async function wing(chat: Chat, ctx: AppContext): Promise<JSX.Element> {
  if (!Harness) {
    const { PresetWing } = await import("./scene-preset-wing");
    const { useScenePresetText } = await import("./use-scene-preset-text");
    // One component for every render, so a re-render with a new ctx updates it rather than remounting it.
    Harness = (props) => {
      text = useScenePresetText(props.ctx, props.chat.preset ?? null, onBody);
      return <PresetWing ctx={props.ctx} chat={props.chat} text={text} onChanged={onChanged} />;
    };
  }
  return <Harness chat={chat} ctx={ctx} />;
}

async function mountWing(chat: Chat, ctx: AppContext): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  const el = await wing(chat, ctx);
  flushSync(() => root.render(el));
  await settle(flushSync);
  return flushSync;
}

async function rerenderWing(flushSync: FlushSync, chat: Chat, ctx: AppContext): Promise<void> {
  const el = await wing(chat, ctx);
  flushSync(() => root.render(el));
  await settle(flushSync);
}

function unmountWing(flushSync: FlushSync): void {
  flushSync(() => root.unmount());
  host.remove();
}

async function press(flushSync: FlushSync, btn: HTMLButtonElement, ms = 30): Promise<void> {
  flushSync(() => btn.click());
  await settle(flushSync, ms);
}

/**
 * Enters text into PromptEditor's textarea for real, in a harness where typing cannot be simulated
 * (see the file header). Probed directly before relying on it: dispatching a native value-setter plus
 * an 'input' or 'change' event never reaches React's onChange here, matching this suite's documented
 * limitation - but the handler React actually attached is reachable straight off the DOM node under
 * its `__reactProps$*` fiber key, and calling it directly runs the real onChange body (setText, the
 * pending ref, the 500ms timer) exactly as a keystroke would.
 */
function typeInto(flushSync: FlushSync, el: HTMLTextAreaElement, text: string): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("no React fiber props found on this element");
  const onChange = (el as unknown as Record<string, { onChange?: (e: { target: { value: string } }) => void }>)[key]!.onChange;
  if (!onChange) throw new Error("textarea has no onChange handler");
  flushSync(() => onChange({ target: { value: text } }));
}

/**
 * Flushes PromptEditor's pending text the way leaving the field does. Also probed: a dispatched
 * 'blur' event does not reach React's onBlur in this harness, but 'focusout' (bubbling, which is how
 * React's blur plugin actually listens) does.
 */
function blurOut(flushSync: FlushSync, el: HTMLElement): void {
  flushSync(() => el.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
}

// -- tests -------------------------------------------------------------------------------------

describe("PresetWing", () => {
  test("a 500-preset library mounts fewer than 60 picker rows", async () => {
    listImpl = async () => Array.from({ length: 500 }, (_, i) => ({ id: `lib${String(i)}`, kind: "preset", name: `Preset ${String(i)}` }) as StudioEntitySummary);
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    await press(flushSync, byTitle("Switch preset")!);
    expectWindowed(host, ".picker [data-index]", 500, 60);
    unmountWing(flushSync);
  });
  test("flipping a prompt's switch then unmounting the wing within 300ms still sends one setScenePreset with that switch", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    const toggle = byLabel("Turn off main")!;
    expect(toggle).toBeDefined();

    flushSync(() => toggle.click());
    await settle(flushSync, 50); // well inside the 300ms debounce
    unmountWing(flushSync);

    // Asserted BEFORE the debounce timer's own 300ms would have elapsed on its own: a pass here
    // proves unmount itself forced the write, not a lucky race with the timer firing naturally later.
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual({ chatId: "chat1", preset: { kind: "preset", id: "p1", toggles: { main: false }, samplers: {} } });

    await settle(flushSync, 350); // and nothing doubles up once the original timer's moment passes
    expect(setCalls).toHaveLength(1);
  });

  test("switching preset within 300ms of a flip posts only the new preset's empty overrides, with no late write of the old one", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    flushSync(() => byLabel("Turn off main")!.click());

    await press(flushSync, byTitle("Switch preset")!);
    await press(flushSync, byText("Second Preset")!);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual({ chatId: "chat1", preset: { kind: "preset", id: "p2", toggles: {}, samplers: {} } });

    await settle(flushSync, 400); // well past 300ms since the flip
    expect(setCalls).toHaveLength(1);
    unmountWing(flushSync);
  });

  test("choosing the current preset again from the picker does not post empty toggles, and the switch shown afterwards is unchanged", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: { main: false }, samplers: {} }), makeCtx());
    expect(byLabel("Turn on main")).toBeDefined(); // off, per the saved override

    await press(flushSync, byTitle("Switch preset")!);
    await press(flushSync, byText("Test Preset")!);

    expect(setCalls).toHaveLength(0);
    expect(byLabel("Turn on main")).toBeDefined(); // still off
    unmountWing(flushSync);
  });

  test("re-rendering with a new ctx object does not reload the preset and keeps the selected prompt", async () => {
    const ctx1 = makeCtx();
    const chat = chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} });
    const flushSync = await mountWing(chat, ctx1);
    expect(getCalls).toHaveLength(1);

    const style1Row = [...host.querySelectorAll(".pi")].find((r) => (r.textContent ?? "").includes("style1")) as HTMLElement;
    flushSync(() => style1Row.click());
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("content-style1");

    const ctx2 = { ...ctx1 }; // a new ctx object; the same api functions inside it
    await rerenderWing(flushSync, chat, ctx2);

    expect(getCalls).toHaveLength(1);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("content-style1");
    unmountWing(flushSync);
  });

  test("a category switch toggles every prompt in it, posting only what differs from the preset's own", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    const groupSwitch = byLabel("Turn on everything in Style")!;
    expect(groupSwitch).toBeDefined();

    flushSync(() => groupSwitch.click());
    await settle(flushSync, 350); // past the 300ms debounce: the flush timer fires on its own

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual({ chatId: "chat1", preset: { kind: "preset", id: "p1", toggles: { style2: true }, samplers: {} } });
    unmountWing(flushSync);
  });

  test("text typed across a 409 is not saved over the reload; the later reload note replaces the conflict note", async () => {
    let getN = 0;
    getImpl = async () => {
      getN += 1;
      return { entity, revision: getN === 1 ? "r1" : "r2" }; // the reload sees a changed revision
    };
    saveImpl = async () => { throw new ApiHttpError(409, "conflict"); };

    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    const mainRow = [...host.querySelectorAll(".pi")].find((r) => (r.textContent ?? "").includes("main")) as HTMLElement;
    flushSync(() => mainRow.click());

    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("content-main");

    // T1: typed and flushed - this is the save that will hit the 409 and trigger the reload.
    typeInto(flushSync, ta, "T1 text");
    blurOut(flushSync, ta);
    // T2: typed and flushed on the SAME, not-yet-remounted editor, before the 409/reload has settled.
    // This is the write that must never survive the reload - it was typed against the load that is
    // about to be replaced.
    typeInto(flushSync, ta, "T2 text");
    blurOut(flushSync, ta);

    // The two saves are serialized (texts.current), so T1's 409 -> reload must fully resolve before
    // T2's generation check even runs. Several real ticks give every awaited step room to land.
    await settle(flushSync, 40);
    await settle(flushSync, 40);
    await settle(flushSync, 40);

    expect(getCalls).toHaveLength(2); // the initial load, then the 409's reload
    expect(saveCalls).toHaveLength(1); // T2 was never sent
    const savedEntity = saveCalls[0]!.entity as { body: { prompts: { id: string; content: string }[] } };
    expect(savedEntity.body.prompts.find((p) => p.id === "main")!.content).toBe("T1 text");
    expect(bodyText()).toContain("reloaded while you typed");
    unmountWing(flushSync);
  });

  test("a settings save whose reply arrives after switching presets does not bring the old preset back", async () => {
    let releaseP1: ((chat: Chat) => void) | null = null;
    setImpl = async (chatId, preset) => {
      if (preset?.id === "p1") return new Promise<Chat>((resolve) => { releaseP1 = resolve; });
      return { ...chatWith(preset), id: chatId };
    };

    const ctx = makeCtx();
    let chat = chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} });
    const flushSync = await mountWing(chat, ctx);

    flushSync(() => byLabel("Turn off main")!.click());
    await settle(flushSync, 350); // past the 300ms debounce: flushOwn sends the p1 write, held open

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.preset?.id).toBe("p1");

    // Switch to a different preset while the p1 write is still in flight.
    await press(flushSync, byTitle("Switch preset")!);
    await press(flushSync, byText("Second Preset")!);

    expect(setCalls).toHaveLength(2);
    expect(changedCalls.at(-1)!.preset?.id).toBe("p2");

    // The parent applies that switch and re-renders the wing with the new preset, as a real caller
    // would - this is what moves `held` on.
    chat = chatWith({ kind: "preset", id: "p2", toggles: {}, samplers: {} });
    await rerenderWing(flushSync, chat, ctx);

    // The stale p1 write's reply finally lands.
    releaseP1!({ ...chatWith({ kind: "preset", id: "p1", toggles: { main: false }, samplers: {} }), id: "chat1" });
    await settle(flushSync, 40);
    await settle(flushSync, 40);

    expect(changedCalls.at(-1)!.preset?.id).toBe("p2");
    unmountWing(flushSync);
  });

  test("a failed settings save puts the switch back to its stored state", async () => {
    setImpl = async () => { throw new Error(); }; // no message: falls back to the wing's own wording
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    expect(byLabel("Turn off main")).toBeDefined(); // on, per the stored preset

    flushSync(() => byLabel("Turn off main")!.click());
    expect(byLabel("Turn on main")).toBeDefined(); // optimistic: off at once, before the write settles

    await waitFor(flushSync, () => setCalls.length === 1 && byLabel("Turn off main"), "the save past its debounce to fail and put the switch back");
    expect(setCalls).toHaveLength(1);
    expect(byLabel("Turn off main")).toBeDefined(); // back on: the failed save did not stick
    expect(bodyText()).toContain("could not be saved");
    unmountWing(flushSync);
  });
});

describe("the preset text writer (use-scene-preset-text.ts), shared by the Preset and Writing Tools tabs", () => {
  const savedBody = (n: number) => (saveCalls[n]!.entity as { body: PresetBody }).body;

  test("a system-prompt save sends the whole preset with the new field, against the revision it loaded", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    text.saveSystemPrompt("impersonation", "Write as me.", text.reloads);
    await settle(flushSync, 40);

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]!.revision).toBe("r1");
    expect(savedBody(0)).toEqual({ ...presetBody, systemPrompts: { impersonation: "Write as me." } });
    expect(text.note).toMatchObject({ kind: "saved" });
    unmountWing(flushSync);
  });

  test("saves run one after another, each against the revision the last left, and keep each other's fields", async () => {
    let n = 1;
    saveImpl = async () => ({ revision: `r${String(++n)}` });
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    text.saveSystemPrompt("impersonation", "A", text.reloads);
    text.saveSystemPrompt("continueNudge", "B", text.reloads);
    text.saveText("main", "T", text.reloads);
    await settle(flushSync, 60);

    expect(saveCalls.map((c) => c.revision)).toEqual(["r1", "r2", "r3"]);
    expect(savedBody(1).systemPrompts).toEqual({ impersonation: "A", continueNudge: "B" });
    expect(savedBody(2).systemPrompts).toEqual({ impersonation: "A", continueNudge: "B" });
    expect(savedBody(2).prompts.find((p) => p.id === "main")!.content).toBe("T");
    unmountWing(flushSync);
  });

  test("a save that changes nothing is not sent, and a blank field already reads as blank", async () => {
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    text.saveSystemPrompt("newChat", "", text.reloads);
    text.saveText("main", "content-main", text.reloads);
    await settle(flushSync, 40);
    expect(saveCalls).toHaveLength(0);
    unmountWing(flushSync);
  });

  test("a 409 reloads the preset and says the edit was not saved", async () => {
    let getN = 0;
    getImpl = async () => ({ entity, revision: `r${String(++getN)}` });
    saveImpl = async () => { throw new ApiHttpError(409, "conflict"); };
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    text.saveSystemPrompt("impersonation", "Write as me.", text.reloads);
    await settle(flushSync, 40);
    await settle(flushSync, 40);

    expect(getCalls).toHaveLength(2);
    expect(text.note).toMatchObject({ kind: "stale" });
    expect(text.note?.text).toContain("changed somewhere else");
    unmountWing(flushSync);
  });

  test("text typed against a load the 409 replaced is not saved over it", async () => {
    let getN = 0;
    getImpl = async () => ({ entity, revision: `r${String(++getN)}` });
    saveImpl = async () => { throw new ApiHttpError(409, "conflict"); };
    const flushSync = await mountWing(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }), makeCtx());
    const typedAt = text.reloads;
    text.saveSystemPrompt("impersonation", "first", typedAt);
    text.saveSystemPrompt("continueNudge", "second", typedAt);
    await settle(flushSync, 60);
    await settle(flushSync, 60);

    expect(saveCalls).toHaveLength(1);
    expect(text.note?.text).toContain("reloaded while you typed");
    unmountWing(flushSync);
  });
});
