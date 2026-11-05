/**
 * The Control Booth (scene-booth-wing.tsx) as it mounts. The Booth only composes: every row calls its
 * home wing's module and the same ctx.api.setScene* setter, so each test here drives a row and then
 * reads the result through the OTHER wing (World, Prompting) against one stateful fake store. Typing
 * and slider drags are not simulated by the DOM harness; the handler React attached is called directly
 * (the same technique scene-preset-wing.test.tsx documents).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { PresetBody } from "../../../entities/preset/schema";
import type { Chat, ChatPreset } from "../../../stage/contracts/chat-store";
import type { OpenScene } from "../../../studio/scenes";
import { ApiHttpError } from "../../_shared/api-fetch";
import { installDom, type InstalledDom } from "../../_shared/test-dom";


let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8325/",
    pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent", "sessionStorage"],
    boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 240 : 200; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 400 : 40; } });
});
afterAll(() => installed.teardown());

// -- fixtures ------------------------------------------------------------------------------------

const presetBody: PresetBody = {
  name: "Test Preset",
  prompts: [{ id: "main", name: "main", content: "content-main", role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false }],
  groups: [],
  samplers: { temperature: 0.7 },
};

const cast = { character: { id: "c1", version: 1, name: "Char" } } as Chat["cast"];
const chatWith = (over: Partial<Chat> = {}): Chat => ({ id: "chat1", title: "Scene", cast, activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1, ...over });
const sceneOf = (chat: Chat): OpenScene => ({ chat, messages: [], messageCount: 0, snapshot: {} }) as unknown as OpenScene;

// -- one stateful fake store -----------------------------------------------------------------------

let getImpl: (query: string) => Promise<{ entity: unknown; revision: string }>;
let changed: Chat[];

beforeEach(() => {
  installed.reinstall();
  changed = [];
  getImpl = async () => ({ entity: { kind: "preset", id: "p1", body: presetBody }, revision: "r1" });
});

function makeCtx(): AppContext {
  return { api: { getEditableEntity: (q: string) => getImpl(q), getSceneLore: async () => ({ books: [], lastTurn: null }), sceneConnections: async () => [], connectionModels: async () => ({ models: [], saved: "" }), listLoadouts: async () => [], latestLoadoutReceipt: async () => null, getSceneTrace: async () => null, getSceneSummary: async () => ({ settings: {}, text: null, through: 0, at: null, total: 0, error: null, running: false }) }, setStatus: () => undefined, prefs: { get: () => undefined, set: () => undefined }, workbench: { open: () => undefined }, openApp: () => undefined } as unknown as AppContext;
}

// -- DOM plumbing ----------------------------------------------------------------------------------

let root: Root;
let host: HTMLElement;
type FlushSync = typeof import("react-dom")["flushSync"];

async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  flushSync(() => undefined);
}

async function mountBooth(scene: OpenScene, ctx: AppContext, busy = false): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { BoothWing } = await import("./scene-booth-wing");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<BoothWing ctx={ctx} scene={scene} busy={busy} art={<span />} onChat={(c) => changed.push(c)} onSettings={() => undefined} onOpen={() => undefined} />));
  await settle(flushSync);
  return flushSync;
}

const tile = (name: string): string | undefined =>
  [...host.querySelectorAll('[data-part="scene.booth.status"] > div')].find((t) => t.querySelector("small")?.textContent === name)?.querySelector("b")?.textContent ?? undefined;
const bodyText = (): string => host.textContent ?? "";

// -- slice 1: the shell, the status tiles and the states ----------------------------------------------

describe("Booth shell", () => {
  test("a scene with no preset and no model reads No preset and Unset, under RoleCall's hero", async () => {
    await mountBooth(sceneOf(chatWith()), makeCtx());
    expect(bodyText()).toContain("Scene control surface");
    expect(bodyText()).toContain("Fast scene setup: cast, preset, model choice, generation, lore links, and loadouts. Optional systems live in Props.");
    expect(tile("Preset")).toBe("No preset");
    expect(tile("Narrator")).toBe("Unset");
  });

  test("the tiles name the scene's preset and model", async () => {
    await mountBooth(sceneOf(chatWith({ preset: { kind: "preset", id: "p1", toggles: {}, samplers: {} } as ChatPreset, connection: { id: "k1", model: "model-x" } })), makeCtx());
    expect(tile("Preset")).toBe("Test Preset");
    expect(tile("Narrator")).toBe("model-x");
  });

  test("a preset the library no longer holds says so and does not invent a name", async () => {
    getImpl = async () => { throw new ApiHttpError(404, "not found"); };
    await mountBooth(sceneOf(chatWith({ preset: { kind: "preset", id: "p1", toggles: {}, samplers: {} } as ChatPreset })), makeCtx());
    expect(tile("Preset")).toBe("Not in your library");
    expect(bodyText()).toContain("This scene's preset is no longer in your library. Choose another, or restore it from the Trash.");
  });

  test("the loadout buttons sit between the status tiles and the character card, as in RoleCall", async () => {
    await mountBooth(sceneOf(chatWith()), makeCtx());
    expect([...host.querySelectorAll("[data-part^='scene.booth.']")].map((e) => e.getAttribute("data-part")).slice(0, 3)).toEqual(["scene.booth.status", "scene.booth.loadouts", "scene.booth.navigator"]);
  });

  test("while a reply is being written the Booth says changes apply from the next reply", async () => {
    await mountBooth(sceneOf(chatWith()), makeCtx(), true);
    expect(bodyText()).toContain("A reply is being written. Changes apply from the next reply.");
  });
});

// -- slice 2: the Lorebooks row and the World wing share one writer -----------------------------------

describe("Booth Lorebooks row", () => {
  type Book = import("../../app-contract-scenes").SceneLoreBook;
  type Choice = import("../../app-contract-scenes").SceneLoreChoice;
  const BASE: Book[] = [
    { id: "b1", name: "Keeper's Log", source: "character", addedByScene: false, enabled: true, missing: false, entries: 2, tokens: 200 },
    { id: "b2", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 21, tokens: 1000 },
  ];
  // One stateful store: a write changes what the next read answers, as the real ChatStore does.
  let off: string[];
  let setCalls: Choice[];
  const view = (): { books: Book[]; lastTurn: null } => ({ books: BASE.map((b) => ({ ...b, enabled: !off.includes(b.id) })), lastTurn: null });
  const loreCtx = (): AppContext => {
    const ctx = makeCtx();
    Object.assign(ctx.api, {
      getSceneLore: async () => view(),
      setSceneLore: async (_id: string, choice: Choice) => { setCalls.push(choice); off = choice.off; return view(); },
      getEditableEntity: async () => { throw new ApiHttpError(404, "no book"); },
      listEntities: async () => [],
    });
    return ctx;
  };
  beforeEach(() => { off = []; setCalls = []; });

  const click = (flushSync: FlushSync, el: Element | null | undefined): void => { flushSync(() => (el as HTMLElement).click()); };
  const unmount = (flushSync: FlushSync): void => { flushSync(() => root.unmount()); host.remove(); };

  test("an empty scene reads No lorebooks active, and the books read their tokens and entries", async () => {
    const empty = loreCtx();
    Object.assign(empty.api, { getSceneLore: async () => ({ books: [], lastTurn: null }) });
    let flushSync = await mountBooth(sceneOf(chatWith()), empty);
    expect(bodyText()).toContain("No lorebooks active");
    unmount(flushSync);
    flushSync = await mountBooth(sceneOf(chatWith()), loreCtx());
    expect(bodyText()).toContain("Lorebooks");
    expect(bodyText()).toContain("200 tok · 2 entries");
    unmount(flushSync);
  });

  test("switching a book off in the Booth is what the World wing reads next", async () => {
    let flushSync = await mountBooth(sceneOf(chatWith()), loreCtx());
    click(flushSync, host.querySelector('[aria-label="Switch off Keeper\'s Log"]'));
    await settle(flushSync);
    expect(setCalls).toEqual([{ added: ["b2"], off: ["b1"] }]);
    unmount(flushSync);

    const { createRoot } = await import("react-dom/client");
    const { LoreWing } = await import("./scene-lore-wing");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    flushSync = (await import("react-dom")).flushSync;
    flushSync(() => root.render(<LoreWing ctx={loreCtx()} chat={chatWith()} characterName="Char" onLore={() => undefined} />));
    await settle(flushSync);
    const row = [...host.querySelectorAll(".wl-bk")].find((r) => r.textContent?.includes("Keeper's Log"));
    expect(row?.className).toContain("off");
    unmount(flushSync);
  });
});

// -- slice 3: the Narrator Model row and the AI wing share one pick ------------------------------------

describe("Booth Narrator Model row", () => {
  type Conn = import("../../app-contract-scenes").SceneConnectionInfo;
  const CONNS = [
    { id: "k1", label: "Harbor", kind: "openai", model: "model-a" },
    { id: "k2", label: "Lantern", kind: "openai", model: "model-q", unavailable: "no key saved" },
  ] as unknown as Conn[];
  let picks: { chatId: string; connection: { id: string; model: string } | null }[];
  let current: { id: string; model: string } | undefined;
  const modelCtx = (): AppContext => {
    const ctx = makeCtx();
    Object.assign(ctx.api, {
      sceneConnections: async () => CONNS,
      connectionModels: async () => ({ models: [{ id: "model-a", context: 200_000 }, { id: "model-b", context: 64_000 }], saved: "model-a" }),
      setSceneConnection: async (chatId: string, connection: { id: string; model: string } | null) => { picks.push({ chatId, connection }); current = connection ?? undefined; return chatWith(connection ? { connection } : {}); },
    });
    return ctx;
  };
  beforeEach(() => { picks = []; current = undefined; });
  const unmount = (flushSync: FlushSync): void => { flushSync(() => root.unmount()); host.remove(); };
  const byText = (text: string): HTMLButtonElement | undefined => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));

  test("with no model the row says so, and the dropdown lists each connection's models and the ones that need setup", async () => {
    const flushSync = await mountBooth(sceneOf(chatWith()), modelCtx());
    expect(bodyText()).toContain("Narrator Model");
    expect(bodyText()).toContain("No model selected");
    expect(bodyText()).toContain("Select a model");
    flushSync(() => byText("No model selected")!.click());
    await settle(flushSync);
    expect(bodyText()).toContain("model-b");
    expect(byText("model-q")?.disabled).toBe(true);
    expect(bodyText()).toContain("Setup Required");
    unmount(flushSync);
  });

  test("the current model reads with its connection and window, and a search narrows the list", async () => {
    const flushSync = await mountBooth(sceneOf(chatWith({ connection: { id: "k1", model: "model-a" } })), modelCtx());
    expect(bodyText()).toContain("Harbor · 200K ctx");
    flushSync(() => byText("model-a")!.click());
    await settle(flushSync);
    const search = host.querySelector('input[aria-label="Search models"]') as HTMLInputElement;
    const onChange = (search as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[Object.keys(search).find((k) => k.startsWith("__reactProps$"))!]!.onChange;
    flushSync(() => onChange({ target: { value: "model-b" } }));
    expect(byText("model-b")).toBeDefined();
    expect(host.querySelectorAll(".bth-dlist [data-control='row']").length).toBe(1);
    unmount(flushSync);
  });

  test("a pick in the Booth is the scene's pick (setSceneConnection) and the AI wing reads it as Currently Selected", async () => {
    let flushSync = await mountBooth(sceneOf(chatWith()), modelCtx());
    flushSync(() => byText("No model selected")!.click());
    await settle(flushSync);
    flushSync(() => byText("model-b")!.click());
    await settle(flushSync);
    expect(picks).toEqual([{ chatId: "chat1", connection: { id: "k1", model: "model-b" } }]);
    expect(changed.at(-1)?.connection).toEqual({ id: "k1", model: "model-b" });
    unmount(flushSync);

    const { createRoot } = await import("react-dom/client");
    const { AiWing } = await import("./scene-ai-wing");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    flushSync = (await import("react-dom")).flushSync;
    flushSync(() => root.render(<AiWing ctx={modelCtx()} chat={chatWith({ connection: current })} onPicked={() => undefined} />));
    await settle(flushSync);
    expect(host.querySelector(".mwrap [data-control='row'][data-selected]")?.textContent).toContain("model-b");
    unmount(flushSync);
  });
});

// -- the Fallback Model control under the Narrator Model --------------------------------------------------

describe("Booth Fallback Model", () => {
  const CONNS = [{ id: "k1", label: "Harbor", kind: "openai", model: "model-a" }] as unknown as import("../../app-contract-scenes").SceneConnectionInfo[];
  let store: Map<string, unknown>;
  const fbCtx = (): AppContext => {
    const ctx = makeCtx();
    Object.assign(ctx.api, { sceneConnections: async () => CONNS, connectionModels: async () => ({ models: [{ id: "model-a" }, { id: "model-b" }], saved: "model-a" }) });
    Object.assign(ctx, { prefs: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => { store.set(k, v); } } });
    return ctx;
  };
  beforeEach(() => { store = new Map(); });
  const unmount = (flushSync: FlushSync): void => { flushSync(() => root.unmount()); host.remove(); };
  const inFallback = (text: string): HTMLButtonElement | undefined => [...host.querySelectorAll('[data-part="scene.booth.fallback"] button')].find((b) => (b.textContent ?? "").includes(text)) as HTMLButtonElement | undefined;

  test("it sits under the Narrator Model with RoleCall's copy, Off by default", async () => {
    const flushSync = await mountBooth(sceneOf(chatWith()), fbCtx());
    expect(bodyText()).toContain("Fallback Model");
    expect(bodyText()).toContain("When your model fails, this decides what answers instead. Applies to all your scenes.");
    expect(bodyText()).toContain("Fail instead of switching models");
    expect(inFallback("Off")?.getAttribute("aria-pressed")).toBe("true");
    expect(store.size).toBe(0);
    unmount(flushSync);
  });

  test("picking a model writes the pref, and a fresh mount reads it back as Custom with that model", async () => {
    let flushSync = await mountBooth(sceneOf(chatWith()), fbCtx());
    flushSync(() => inFallback("Custom")!.click());
    expect(bodyText()).toContain("Used once when the main model gives up.");
    flushSync(() => inFallback("No model selected")!.click());
    await settle(flushSync);
    flushSync(() => inFallback("model-b")!.click());
    await settle(flushSync);
    expect(store.get("scenes.fallbackModel")).toEqual({ mode: "custom", connection: { id: "k1", model: "model-b" } });
    unmount(flushSync);
    flushSync = await mountBooth(sceneOf(chatWith()), fbCtx());
    expect(inFallback("Custom")?.getAttribute("aria-pressed")).toBe("true");
    expect(inFallback("model-b")).toBeDefined();
    flushSync(() => inFallback("Off")!.click());
    expect(store.get("scenes.fallbackModel")).toEqual({ mode: "off" });
    unmount(flushSync);
  });
});

// -- slice 4: the Active Preset row and Generation (Quick) share the Prompting wing's writer -------------

describe("Booth Active Preset and Generation", () => {
  let sets: { chatId: string; preset: ChatPreset | null }[];
  let stored: ChatPreset | undefined;
  let opened: string[];
  const presetCtx = (): AppContext => {
    const ctx = makeCtx();
    Object.assign(ctx.api, {
      setScenePreset: async (chatId: string, preset: ChatPreset | null) => { sets.push({ chatId, preset }); stored = preset ?? undefined; return chatWith(preset ? { preset } : {}); },
      listEntities: async () => [],
      sceneConnections: async () => [{ id: "k1", label: "Harbor", kind: "openai", model: "m" }],
      connectionModels: async () => ({ models: [{ id: "big", context: 200_000 }, { id: "small", context: 32_000 }], saved: "big" }),
    });
    return ctx;
  };
  const chatP = (preset?: ChatPreset, model = "big"): Chat => chatWith({ ...(preset ? { preset } : {}), connection: { id: "k1", model } });
  beforeEach(() => { sets = []; stored = undefined; opened = []; });
  const unmount = (flushSync: FlushSync): void => { flushSync(() => root.unmount()); host.remove(); };
  const byText = (text: string): HTMLButtonElement | undefined => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  const mountBoothP = async (chat: Chat, ctx = presetCtx()): Promise<FlushSync> => {
    const { flushSync } = await import("react-dom");
    const { createRoot } = await import("react-dom/client");
    const { BoothWing } = await import("./scene-booth-wing");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<BoothWing ctx={ctx} scene={sceneOf(chat)} busy={false} art={<span />} onChat={(c) => changed.push(c)} onSettings={() => undefined} onOpen={(id) => opened.push(id)} />));
    await settle(flushSync);
    return flushSync;
  };
  /** Moves a range slider the way a drag does: the handler React attached, called with the new value. */
  const drag = (flushSync: FlushSync, label: string, value: number): void => {
    const row = [...host.querySelectorAll(".sl")].find((l) => l.querySelector(".slh span")?.textContent === label);
    const input = row?.querySelector("input[type=range]") as HTMLInputElement;
    const props = (input as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[Object.keys(input).find((k) => k.startsWith("__reactProps$"))!]!;
    flushSync(() => props.onChange({ target: { value: String(value) } }));
  };

  test("the Active Preset card names the preset with its enabled tokens, and opens Prompting; with none it points there", async () => {
    let flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: {} }));
    expect(bodyText()).toContain("Active Preset");
    expect(bodyText()).toMatch(/~\d+ tokens/);
    flushSync(() => host.querySelector<HTMLElement>('[aria-label="Open Prompting to change the active preset"]')!.click());
    expect(opened).toEqual(["prompting"]);
    unmount(flushSync);
    flushSync = await mountBoothP(chatP());
    expect(bodyText()).toContain("No preset selected. Choose in Prompting");
    flushSync(() => byText("No preset selected")!.click());
    expect(opened).toEqual(["prompting", "prompting"]);
    unmount(flushSync);
  });

  test("a slider moved in the Booth is the same write the Prompting wing makes, and the wing shows it", async () => {
    let flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: {} }));
    expect(bodyText()).toContain("Generation (Quick)");
    drag(flushSync, "Temperature", 0.3);
    unmount(flushSync); // inside the 300 ms pause: closing flushes the write
    expect(sets).toEqual([{ chatId: "chat1", preset: { kind: "preset", id: "p1", toggles: {}, samplers: { temperature: 0.3 } } }]);

    const { createRoot } = await import("react-dom/client");
    const [{ PresetWing }, { useScenePresetText }] = await Promise.all([import("./scene-preset-wing"), import("./use-scene-preset-text")]);
    const Tab = () => <PresetWing ctx={presetCtx()} chat={chatWith({ preset: stored! })} text={useScenePresetText(presetCtx(), { kind: "preset", id: "p1" }, () => undefined)} onChanged={() => undefined} />;
    host = dom.window.document.body.appendChild(dom.window.document.createElement("div"));
    root = createRoot(host);
    flushSync = (await import("react-dom")).flushSync;
    flushSync(() => root.render(<Tab />));
    await settle(flushSync);
    expect(host.querySelector("[data-part='scene.preset.samplers']")?.textContent).toContain("Temp:0.30");
    unmount(flushSync);
  });

  test("Generation (Quick) keeps Prompt Post-Processing as its last card and reads values as RoleCall's QuickSlider does", async () => {
    const flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: { maxContext: 200_000, maxTokens: 8_192 } }));
    const cards = [...host.querySelectorAll(".sliders.quick > .sl")];
    expect(cards.at(-1)?.querySelector("select")?.getAttribute("aria-label")).toBe("Prompt Post-Processing");
    const readOut = (label: string) => cards.find((c) => c.querySelector(".slh span")?.textContent === label)?.querySelector(".slv, [data-control='inline']")?.textContent;
    expect(readOut("Max Context")).toBe("200.0K");
    expect(readOut("Max Tokens")).toBe("8.2K");
    unmount(flushSync);
  });

  test("setting a slider back to the preset's own value clears the scene's, and Frequency and Presence penalty are there", async () => {
    const flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: { temperature: 0.3, frequencyPenalty: 0.5 } }));
    drag(flushSync, "Temperature", 0.7); // the preset's own value
    drag(flushSync, "Presence Penalty", -1);
    unmount(flushSync);
    expect(sets.at(-1)?.preset?.samplers).toEqual({ frequencyPenalty: 0.5, presencePenalty: -1 });
  });

  test("Context maxed warns at a window of 65,536 or more when Context tokens reach it, and stays quiet otherwise", async () => {
    let flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: {} }));
    expect(bodyText()).toContain("Context maxed: every message resends up to 200,000 tokens of history as input");
    unmount(flushSync);
    flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: { maxContext: 8_192 } }));
    expect(bodyText()).not.toContain("Context maxed");
    unmount(flushSync);
    flushSync = await mountBoothP(chatP({ kind: "preset", id: "p1", toggles: {}, samplers: {} }, "small"));
    expect(bodyText()).not.toContain("Context maxed"); // a 32k window is below the threshold
    unmount(flushSync);
  });
});

// -- slice 5: the Scene Readout and the character navigator ---------------------------------------------

describe("Booth Scene Readout and character navigator", () => {
  type Msg = import("../../../stage/contracts/chat-store").Message;
  const replyMs = (n: number, ms?: number): Msg => ({ id: `a${n}`, branchId: "b1", seq: n, role: "assistant", current: 0, createdAt: 0, swipes: [{ id: `a${n}-s`, content: "x", createdAt: 0, pinned: false, ...(ms ? { generation: { generationMs: ms } } : {}) }] });
  const withCharacter = (messages: Msg[], count = messages.length): OpenScene => ({
    chat: chatWith(), messages, messageCount: count,
    snapshot: { character: { body: { identity: { name: "Vera Vane", tagline: "A lighthouse keeper" }, discovery: { tags: ["gothic", "slow burn", "coast", "ghosts"] } } } },
  }) as unknown as OpenScene;
  let started: string[];
  const roster = [{ id: "c1", kind: "character", name: "Vera Vane" }, { id: "c2", kind: "character", name: "Corvin Ash" }];
  const navCtx = (list = roster): AppContext => {
    const ctx = makeCtx();
    Object.assign(ctx.api, { listEntities: async () => list, startScene: async (id: string) => { started.push(id); return chatWith({ id: `new-${id}` }); } });
    return ctx;
  };
  beforeEach(() => { started = []; });
  const mountScene = async (scene: OpenScene, ctx = navCtx()): Promise<FlushSync> => {
    const { flushSync } = await import("react-dom");
    const { createRoot } = await import("react-dom/client");
    const { BoothWing } = await import("./scene-booth-wing");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<BoothWing ctx={ctx} scene={scene} busy={false} art={<span className="portrait" />} onChat={() => undefined} onSettings={() => undefined} onOpen={() => undefined} />));
    await settle(flushSync);
    return flushSync;
  };
  const stat = (label: string): string | undefined => [...host.querySelectorAll('[data-part="scene.booth.readout"] > div')].find((d) => d.querySelector("small")?.textContent === label)?.querySelector("b")?.textContent ?? undefined;
  const byText = (text: string): HTMLButtonElement | undefined => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));

  test("the readout counts the take's messages and averages the replies' real generation times", async () => {
    const flushSync = await mountScene(withCharacter([replyMs(1, 2_000), replyMs(2, 4_000)], 9));
    expect(bodyText()).toContain("Scene Readout");
    expect(stat("Msgs")).toBe("9");
    expect(stat("Avg")).toBe("3.0s"); // not RoleCall's constant 1.2s
    flushSync(() => root.unmount());
  });

  test("with no timed reply the average reads a dash", async () => {
    const flushSync = await mountScene(withCharacter([replyMs(1)]));
    expect(stat("Avg")).toBe("-");
    flushSync(() => root.unmount());
  });

  test("the navigator card shows the character, a tagline and at most three traits", async () => {
    const flushSync = await mountScene(withCharacter([]));
    const card = host.querySelector('[data-part="scene.booth.navigator"]')!;
    expect(card.textContent).toContain("Vera Vane");
    expect(card.textContent).toContain("A lighthouse keeper");
    expect([...card.querySelectorAll(".bth-tag")].map((t) => t.textContent)).toEqual(["gothic", "slow burn", "coast"]);
    flushSync(() => root.unmount());
  });

  test("Change Character lists the library, narrows by search, and starts a new scene with the pick", async () => {
    const { handedScene } = await import("../../_shared/scene-handoff");
    const flushSync = await mountScene(withCharacter([]));
    flushSync(() => byText("Change Character")!.click());
    await settle(flushSync);
    expect(document.body.textContent).toContain("Character Library");
    expect(document.body.textContent).toContain("Choose who to play");
    expect(document.body.textContent).toContain("Start fresh scene"); // the current character
    const search = document.querySelector('input[aria-label="Search characters"]') as HTMLInputElement;
    const onChange = (search as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[Object.keys(search).find((k) => k.startsWith("__reactProps$"))!]!.onChange;
    flushSync(() => onChange({ target: { value: "zzz" } }));
    expect(document.body.textContent).toContain("No characters found.");
    flushSync(() => onChange({ target: { value: "corvin" } }));
    const row = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Corvin Ash"))!;
    flushSync(() => row.click());
    await settle(flushSync);
    expect(started).toEqual(["c2"]);
    expect(handedScene()).toBe("new-c2");
    flushSync(() => root.unmount());
  });
});

describe("Booth Runtime Setup", () => {
  test("Last Message as User is the scene's own prompting switch (setScenePrompting), shown under Runtime Setup", async () => {
    const calls: unknown[] = [];
    const ctx = makeCtx();
    Object.assign(ctx.api, { setScenePrompting: async (_id: string, patch: unknown) => { calls.push(patch); return chatWith({ prompting: patch } as Partial<Chat>); } });
    const flushSync = await mountBooth(sceneOf(chatWith()), ctx);
    expect(bodyText()).toContain("Runtime Setup");
    expect(bodyText()).toContain("Re-tag the final outbound message as user for models that reject assistant prefills.");
    flushSync(() => host.querySelector<HTMLElement>('[aria-label="Turn on last message as user"]')!.click());
    await settle(flushSync);
    expect(calls).toEqual([{ lastAsUser: true }]);
    expect(changed.at(-1)?.prompting?.lastAsUser).toBe(true);
    flushSync(() => root.unmount());
  });
});
