/**
 * The Props wing as it actually mounts: use-scene-props.ts (fetch, write queue) wired to the
 * presentational PropsWing, the same split scene-page.tsx uses. Covers the wing listing registered
 * props, toggling writing the right list, the empty state, and the temporary browser Studio's refusal
 * (the same 501 message every other wing shows, LoreWing/PresetWing's own browser-Studio tests).
 * propsTabMeta and sceneStageProps are pure and proven separately (prop-contract.test.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { JSX } from "react";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../../app-contract";
import type { Chat } from "../../../../stage/contracts/chat-store";
import { ApiHttpError } from "../../../_shared/api-fetch";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import { PropsWing, propsTabMeta } from "./props-wing";
import { TIP_DELAY_MS } from "./prop-tip";
import { useSceneProps } from "./use-scene-props";
import type { SceneProp } from "./prop-contract";

let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8323/",
    extraGlobals: ["SVGElement", "Event", "CustomEvent"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
});
afterAll(() => installed.teardown());

// -- fixtures ------------------------------------------------------------------------------------

const fakeProp = (id: string, over: Partial<SceneProp> = {}): SceneProp =>
  ({ id, name: `Fake ${id}`, blurb: `${id} does things`, tier: `Tier ${id}`, reach: "none", icon: "lucide:puzzle", tone: "var(--prop-hare)", ...over });

let getCalls: string[] = [];
let setCalls: { chatId: string; on: string[] }[] = [];
let getImpl: () => Promise<{ on: string[] }>;
let setImpl: (chatId: string, on: string[]) => Promise<{ on: string[] }>;

const resetRecorders = (): void => {
  getCalls = [];
  setCalls = [];
  getImpl = async () => ({ on: [] });
  setImpl = async (_chatId, on) => ({ on });
};

/** A hover card lives in the document body, outside the mounted tree: no test may leave one for the next. */
const clearCards = (): void => { dom.window.document.body.querySelectorAll(".pw-rt").forEach((n) => n.remove()); };
beforeEach(() => { installed.reinstall(); clearCards(); resetRecorders(); prefStore.clear(); });
afterEach(clearCards);

const prefStore = new Map<string, unknown>();
function makeCtx(): AppContext {
  return {
    prefs: { get: (k: string) => prefStore.get(k), set: (k: string, v: unknown) => { prefStore.set(k, v); } },
    pieces: { subscribeList: () => () => undefined, streamState: () => ({ sceneTrackers: null }) },
    api: {
      getTrackerStates: async () => ({ branchId: "b1", branchVersion: 1, tipId: "m1", data: {}, unreadable: [], updates: {} }),
      getSceneProps: async (chatId: string) => { getCalls.push(chatId); return getImpl(); },
      setSceneProps: async (chatId: string, on: string[]) => { setCalls.push({ chatId, on }); return setImpl(chatId, on); },
    },
  } as unknown as AppContext;
}

/** The same wiring scene-page.tsx does: the hook owns fetch/write, PropsWing only renders. */
function Harness({ ctx, list }: { ctx: AppContext; list: SceneProp[] }): JSX.Element {
  const props = useSceneProps(ctx, "chat1");
  return <PropsWing list={list} load={props.load} onToggle={props.toggle} onRetry={props.reload} prefs={ctx.prefs} host={{ ctx, chat: { id: "chat1" } as Chat }} />;
}

// -- DOM plumbing ----------------------------------------------------------------------------------

let root: Root;
let host: HTMLElement;

const bodyText = (): string => host.textContent ?? "";
const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll("button")];
const byLabel = (text: string): HTMLButtonElement | undefined => buttons().find((b) => (b.getAttribute("aria-label") ?? "").includes(text));

type FlushSync = typeof import("react-dom")["flushSync"];

async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  flushSync(() => undefined);
}
/** Settles until `shown` holds (a busy test run can push a timer past a fixed wait), giving up after `ms`. */
async function settleUntil(flushSync: FlushSync, shown: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  do await settle(flushSync); while (!shown() && Date.now() < end);
}

async function mountHarness(ctx: AppContext, list: SceneProp[]): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<Harness ctx={ctx} list={list} />));
  await settle(flushSync);
  return flushSync;
}

function unmount(flushSync: FlushSync): void {
  flushSync(() => root.unmount());
  host.remove();
}

async function press(flushSync: FlushSync, btn: HTMLButtonElement, ms = 20): Promise<void> {
  flushSync(() => btn.click());
  await settle(flushSync, ms);
}

// -- tests -------------------------------------------------------------------------------------

describe("PropsWing: listing and toggling", () => {
  test("lists every registered prop with its name, and its blurb as the row's label", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a"), fakeProp("b")]);
    expect(bodyText()).toContain("Fake a");
    expect(rowOf("Fake a").getAttribute("aria-label")).toBe("Fake a: a does things");
    expect(bodyText()).toContain("Fake b");
    expect(getCalls).toEqual(["chat1"]);
    unmount(flushSync);
  });

  test("switching one on calls setSceneProps with the right list, and the switch reflects it", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a"), fakeProp("b")]);
    await press(flushSync, byLabel("Turn on Fake a")!);
    expect(setCalls).toEqual([{ chatId: "chat1", on: ["a"] }]);
    expect(byLabel("Turn off Fake a")).toBeDefined();
    unmount(flushSync);
  });

  test("a refused switch goes back and says why, and the list stays", async () => {
    setImpl = async () => { throw new ApiHttpError(501, "that prop is not available on this scene yet"); };
    const statuses: string[] = [];
    const flushSync = await mountHarness({ ...makeCtx(), setStatus: (text: string) => { statuses.push(text); } }, [fakeProp("a"), fakeProp("b")]);
    await press(flushSync, byLabel("Turn on Fake a")!);
    await settleUntil(flushSync, () => statuses.length > 0);
    expect(statuses).toEqual(["that prop is not available on this scene yet"]);
    expect(byLabel("Turn on Fake a")).toBeDefined();
    expect(byLabel("Turn on Fake b")).toBeDefined();
    unmount(flushSync);
  });

  test("a refused switch does not ride along with a quick second switch", async () => {
    setImpl = async (_chatId, on) => { if (on.includes("a")) throw new ApiHttpError(501, "that prop is not available on this scene yet"); return { on }; };
    const statuses: string[] = [];
    const flushSync = await mountHarness({ ...makeCtx(), setStatus: (text: string) => { statuses.push(text); } }, [fakeProp("a"), fakeProp("b")]);
    const [a, b] = [byLabel("Turn on Fake a")!, byLabel("Turn on Fake b")!];
    flushSync(() => { a.click(); b.click(); });
    await settleUntil(flushSync, () => byLabel("Turn off Fake b") !== undefined && byLabel("Turn on Fake a") !== undefined && setCalls.length === 2);
    expect(setCalls.at(-1)).toEqual({ chatId: "chat1", on: ["b"] });
    expect(statuses).toEqual(["that prop is not available on this scene yet"]);
    unmount(flushSync);
  });

  test("switching off removes only that id", async () => {
    getImpl = async () => ({ on: ["a", "b"] });
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a"), fakeProp("b")]);
    await settle(flushSync);
    await press(flushSync, byLabel("Turn off Fake a")!);
    expect(setCalls).toEqual([{ chatId: "chat1", on: ["b"] }]);
    unmount(flushSync);
  });

  test("a prop's note shows only while it is on", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { note: "Fake a is watching." })]);
    expect(bodyText()).not.toContain("Fake a is watching.");
    await press(flushSync, byLabel("Turn on Fake a")!);
    expect(bodyText()).toContain("Fake a is watching.");
    unmount(flushSync);
  });
});

describe("PropsWing: empty state and tab meta", () => {
  test("no registered props shows the empty state", async () => {
    const flushSync = await mountHarness(makeCtx(), []);
    expect(bodyText()).toContain("No props yet.");
    unmount(flushSync);
  });

  test("propsTabMeta reads 'No props yet' when empty, and 'N active' otherwise (RoleCall's fold meta, LeftWingPanelContent.tsx:266)", () => {
    expect(propsTabMeta([], { state: "ready", on: [] })).toBe("No props yet");
    expect(propsTabMeta([fakeProp("a")], { state: "loading" })).toBe("0 active");
    expect(propsTabMeta([fakeProp("a"), fakeProp("b")], { state: "ready", on: ["a", "b"] })).toBe("2 active");
  });
});

describe("PropsWing: browser Studio", () => {
  test("shows the same failed-load message the temporary browser Studio's 501 sends", async () => {
    getImpl = async () => { throw new ApiHttpError(501, "This control needs the installed Bunzai app and is unavailable in the temporary browser studio."); };
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a")]);
    expect(bodyText()).toContain("This control needs the installed Bunzai app");
    unmount(flushSync);
  });
});

// -- RoleCall's layout (StagecraftManagerPanel.tsx, StagecraftExtensions.tsx) ------------------------

const key = (el: Element, k: string): void => { el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })); };
const rowOf = (name: string): HTMLElement => [...host.querySelectorAll<HTMLElement>(".pw-row")].find((r) => r.textContent?.includes(name))!;

describe("PropsWing: RoleCall's hero, sections and rows", () => {
  test("the hero reads Scene Augmentations, StageProps and RoleCall's subtitle", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a")]);
    expect(host.querySelector(".eb")?.textContent).toBe("Scene Augmentations");
    expect(host.querySelector("h2")?.textContent).toBe("StageProps");
    expect(host.querySelector("h2 em")?.textContent).toBe("Props");
    expect(bodyText()).toContain("Optional scene systems live here. Toggle the ones you want active; their wing icons and deeper panels appear only when enabled.");
    unmount(flushSync);
  });

  test("Built-In Props lists the rows with their tier line, then Coming Soon holds RoleCall's three inert rows", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a")]);
    const labels = [...host.querySelectorAll(".pw-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Built-In Props", "Coming Soon"]);
    expect(rowOf("Fake a").querySelector(".pw-tier")?.textContent).toBe("Tier a");
    const soon = [...host.querySelectorAll(".pw-row.soon")];
    expect(soon.map((r) => r.querySelector(".pw-name")?.textContent)).toEqual(["Immersive Weather", "VN Additionals", "Web Search"]);
    expect(soon.every((r) => r.querySelector(".pw-tier")?.textContent === "Coming soon" && r.querySelector("[role=switch]") === null)).toBe(true);
    unmount(flushSync);
  });

  test("clicking the row, or Enter or Space on it, switches the prop; the switch does not toggle twice", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a")]);
    await press(flushSync, rowOf("Fake a") as unknown as HTMLButtonElement);
    expect(setCalls.map((c) => c.on)).toEqual([["a"]]);
    flushSync(() => key(rowOf("Fake a"), "Enter")); await settle(flushSync);
    flushSync(() => key(rowOf("Fake a"), " ")); await settle(flushSync);
    expect(setCalls.map((c) => c.on)).toEqual([["a"], [], ["a"]]);
    await press(flushSync, byLabel("Turn off Fake a")!);
    expect(setCalls.length).toBe(4);
    unmount(flushSync);
  });

  test("the gear shows only while the prop is on and has one, labelled Open <name> panel, and does not toggle", async () => {
    let opened = 0;
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { gear: () => { opened++; } }), fakeProp("b")]);
    expect(byLabel("Open Fake a panel")).toBeUndefined();
    await press(flushSync, byLabel("Turn on Fake a")!);
    await press(flushSync, byLabel("Open Fake a panel")!);
    expect(opened).toBe(1);
    expect(setCalls.length).toBe(1);
    await press(flushSync, byLabel("Turn on Fake b")!);
    expect(byLabel("Open Fake b panel")).toBeUndefined();
    unmount(flushSync);
  });

  test("a prop's Sub controls draw under its row only while it is on", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { Sub: () => <p>Sub of a</p> })]);
    expect(bodyText()).not.toContain("Sub of a");
    await press(flushSync, byLabel("Turn on Fake a")!);
    expect(bodyText()).toContain("Sub of a");
    unmount(flushSync);
  });
});

describe("PropsWing: the Tooltips switch", () => {
  const tip = { description: "Does a thing.", bullets: ["First bullet.", "Second bullet."] };
  const toggle = (): HTMLButtonElement => buttons().find((b) => b.textContent?.startsWith("Tooltips"))!;

  /** The card is portaled to the body and shown 220ms after the pointer arrives (RoleCall's RichTooltip). */
  const hover = async (flushSync: FlushSync, row: Element, opens = true): Promise<void> => {
    flushSync(() => { row.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
    await settle(flushSync, TIP_DELAY_MS + 60);
    if (opens) await settleUntil(flushSync, () => dom.window.document.body.querySelector(".pw-rt") !== null);
  };
  const card = (): Element | null => dom.window.document.body.querySelector(".pw-rt");

  test("tooltips are on by default: hovering a row opens a card in the body with the description, pointing at the bullets, and the switch turns them off and saves the choice", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { tip })]);
    expect(toggle().textContent).toBe("Tooltips On");
    expect(card()).toBeNull();
    await hover(flushSync, rowOf("Fake a"));
    expect(card()?.parentElement).toBe(dom.window.document.body);
    expect(card()?.textContent).toContain("Does a thing.");
    expect(card()?.textContent).toContain("Open help for details");
    expect(card()?.textContent).not.toContain("First bullet.");
    await press(flushSync, toggle());
    expect(toggle().textContent).toBe("Tooltips Off");
    expect(prefStore.get("scenes.props.tooltips")).toBe(false);
    expect(card()).toBeNull();
    await hover(flushSync, rowOf("Fake a"), false);
    expect(card()).toBeNull();
    unmount(flushSync);
  });

  test("unmounting the wing during the open delay leaves no card, then or later", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { tip })]);
    flushSync(() => { rowOf("Fake a").dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
    unmount(flushSync);
    await settle(flushSync, TIP_DELAY_MS + 60);
    expect(card()).toBeNull();
  });

  test("turning tooltips off while a card is open removes it, and turning them on does not bring it back", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { tip })]);
    await hover(flushSync, rowOf("Fake a"));
    expect(card()).not.toBeNull();
    await press(flushSync, toggle());
    expect(card()).toBeNull();
    await press(flushSync, toggle());
    expect(card()).toBeNull();
    unmount(flushSync);
  });

  test("a question mark on the focused row opens the detailed card with the bullets, and Escape closes it", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { tip })]);
    rowOf("Fake a").focus();
    flushSync(() => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true })); });
    await settleUntil(flushSync, () => card()?.getAttribute("role") === "dialog");
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(card()?.textContent).toContain("First bullet.");
    expect(card()?.textContent).toContain("Second bullet.");
    flushSync(() => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle(flushSync);
    expect(card()).toBeNull();
    unmount(flushSync);
  });

  test("a saved Off is honoured on the next open", async () => {
    prefStore.set("scenes.props.tooltips", false);
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a", { tip })]);
    expect(toggle().textContent).toBe("Tooltips Off");
    expect(dom.window.document.body.querySelector(".pw-rt")).toBeNull();
    unmount(flushSync);
  });
});

describe("PropsWing: RoleCall's Legacy Trackers box and a prop's own panel", () => {
  const panel = { id: "fake.panel", title: "Fake panel", noun: "Fake panel", icon: "lucide:puzzle", render: () => <p>Panel body</p> } as const;
  const legacy = (id: string, over: Partial<SceneProp> = {}): SceneProp => fakeProp(id, { group: "legacy", panel, ...over });

  test("legacy modules are tiles in the Legacy Trackers box (with RoleCall's 'optional' chip), not rows; the box is absent when there are none", async () => {
    const flushSync = await mountHarness(makeCtx(), [fakeProp("a"), legacy("t")]);
    expect([...host.querySelectorAll(".pw-row .pw-name")].map((n) => n.textContent)).toEqual(["Fake a", "Immersive Weather", "VN Additionals", "Web Search"]);
    const box = host.querySelector(".pw-box")!;
    expect(box.querySelector("h4")?.textContent).toBe("Legacy Trackers");
    expect(box.textContent).toContain("optional");
    expect([...box.querySelectorAll(".pw-tile-name")].map((n) => n.textContent)).toEqual(["Fake t"]);
    unmount(flushSync);
    const again = await mountHarness(makeCtx(), [fakeProp("a")]);
    expect(host.querySelector(".pw-box")).toBeNull();
    unmount(again);
  });

  test("Refresh Enabled Boards sits in the Legacy Trackers box: off with no board on, ready once a refreshable tracker is on, and never for a tile that is not a tracker", async () => {
    const { flushSync } = await import("react-dom");
    const { createRoot } = await import("react-dom/client");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    const ctx = makeCtx();
    const list = [legacy("t"), legacy("tracker-inventory", { name: "Inventory" })];
    const draw = (on: string[]): JSX.Element => <PropsWing list={list} load={{ state: "ready", on }} onToggle={() => undefined} onRetry={() => undefined} prefs={ctx.prefs} host={{ ctx, chat: { id: "chat1" } as Chat }} />;
    flushSync(() => root.render(draw(["t"])));
    const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>("[data-part='props.trackers.refresh-all'] > button")!;
    expect(button().textContent).toBe("Refresh Enabled Boards");
    expect(button().disabled).toBe(true);
    flushSync(() => root.render(draw(["t", "tracker-inventory"])));
    expect(button().disabled).toBe(false);
    expect(host.querySelector(".pw-box.story")).toBeNull();
    flushSync(() => root.unmount());
    host.remove();
  });

  test("a tile switches its prop on and off; the gear opens the panel inside the wing and Back returns to the list", async () => {
    const flushSync = await mountHarness(makeCtx(), [legacy("t")]);
    await press(flushSync, host.querySelector<HTMLButtonElement>(".pw-tile")!);
    expect(setCalls.map((c) => c.on)).toEqual([["t"]]);
    expect(host.querySelector(".pw-tile")!.classList.contains("on")).toBe(true);
    await press(flushSync, byLabel("Open Fake t panel")!);
    expect(bodyText()).toContain("Panel body");
    expect(host.querySelector(".pw-tile")).toBeNull();
    await press(flushSync, buttons().find((b) => b.textContent?.includes("Props"))!);
    expect(bodyText()).not.toContain("Panel body");
    expect(host.querySelector(".pw-tile")).not.toBeNull();
    unmount(flushSync);
  });

  test("a panel is not offered for a prop that is off, and a prop switched off while its panel is open drops back to the list", async () => {
    const { flushSync } = await import("react-dom");
    const { createRoot } = await import("react-dom/client");
    host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
    root = createRoot(host);
    const ctx = makeCtx();
    const list = [legacy("t")];
    const draw = (on: string[]): JSX.Element => <PropsWing list={list} load={{ state: "ready", on }} onToggle={() => undefined} onRetry={() => undefined} prefs={ctx.prefs} host={{ ctx, chat: { id: "chat1" } as Chat }} />;
    flushSync(() => root.render(draw([])));
    expect(byLabel("Open Fake t panel")).toBeUndefined();
    flushSync(() => root.render(draw(["t"])));
    await press(flushSync, byLabel("Open Fake t panel")!);
    expect(bodyText()).toContain("Panel body");
    flushSync(() => root.render(draw([])));
    expect(bodyText()).not.toContain("Panel body");
    expect(host.querySelector(".pw-tile")).not.toBeNull();
    unmount(flushSync);
  });
});

describe("PropsWing: the Storyboards box", () => {
  test("holds the Storyboard tiles with RoleCall's card text and an on count, and Calendar inert with the reason", async () => {
    const story = (id: string, name: string, over: Partial<SceneProp> = {}): SceneProp => fakeProp(id, { name, group: "storyboard", ...over });
    const flushSync = await mountHarness(makeCtx(), [story("q", "Quest Board"), story("c", "Cast")]);
    const box = host.querySelector(".pw-box.story")!;
    expect(box.querySelector("h4")?.textContent).toBe("Storyboards");
    expect(box.textContent).toContain("First-class story state. These feed the Compendium's Storyboards tab.");
    expect(box.querySelector(".pw-box-head .pw-chip")?.textContent).toBe("0/2");
    await press(flushSync, box.querySelector<HTMLButtonElement>(".pw-tile")!);
    expect(box.querySelector(".pw-box-head .pw-chip")?.textContent).toBe("1/2");
    expect([...box.querySelectorAll(".pw-tile")].map((t) => t.querySelector(".pw-chip")?.textContent ?? "")).toEqual(["Live", "Off", "Soon"]);
    const calendar = box.querySelector<HTMLElement>(".pw-tile.soon")!;
    expect(calendar.textContent).toContain("Calendar");
    expect(calendar.getAttribute("aria-disabled")).toBe("true");
    expect(calendar.getAttribute("title")).toContain("Needs the Story Director");
    await press(flushSync, calendar as unknown as HTMLButtonElement);
    expect(setCalls.length).toBe(1);
    unmount(flushSync);
  });
});
