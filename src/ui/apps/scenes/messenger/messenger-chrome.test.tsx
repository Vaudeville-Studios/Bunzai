/**
 * The Messenger shell (messenger-chrome.tsx) on its own, with stand-ins for the programs and the settings layer, the way RoleCall's DiscordChrome.test.tsx drives its chrome: the rail and the
 * sidebar (recent characters, this character's scenes and takes, active features, the user panel), the header and its panel switcher opening each surface kind (Side, Wide, Popout, Layer), a
 * visited program keeping its draft across every swap, Leave hiding a character without deleting anything, the character menu and the gears opening the settings scopes, the member list,
 * a numbered request opening a wing, and the narrow drawer returning focus to its menu button. JSDOM lays nothing out, so the drawer's "narrow" is the scene box's stated width.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement, useEffect, useState, type JSX } from "react";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../../app-contract";
import { handedScene, handOffScene } from "../../../_shared/scene-handoff";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import type { OpenScene, SceneSummary } from "../../../../studio/scenes";
import type { MessengerChromeProps } from "./messenger-chrome";
import type { Program } from "./programs";
import { READ_MARKS_KEY } from "./shell/read-marks";
import { HIDDEN_KEY, PINNED_KEY } from "./shell/surfaces";
import { forgetRecents, RECENTS_ERROR } from "./use-recent-characters";

type FlushSync = typeof import("react-dom")["flushSync"];

let installed: InstalledDom;
let Chrome: typeof import("./messenger-chrome")["MessengerChrome"];
beforeAll(async () => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", observers: true, extraGlobals: ["sessionStorage", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "SVGElement", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle"] });
  Chrome = (await import("./messenger-chrome")).MessengerChrome;
});
afterAll(() => installed.teardown());
beforeEach(() => handOffScene(null));

const P = (id: string, title: string, wing = "cast", tab?: string, panel = false): Program => ({ id, title, wing, icon: "lucide:puzzle", ...(tab ? { tab } : {}), ...(panel ? { panel: {} as never } : {}) });
const PROGRAMS: Program[] = [
  P("quickplay", "Control Booth", "booth"), P("characters", "Characters", "cast", "character"), P("persona", "My Persona", "cast", "persona"), P("participants", "Participants", "cast", "participants"),
  P("props", "Add / Remove Features", "props"), P("regex", "Regex Workshop", "finalcut", "regex"), P("author-note", "Scene Note", "prompting", "note"), P("memory", "Memory", "context", "memory"),
  P("model", "AI Connection", "ai", "model"), P("prop-story-director", "Story Director", "props", undefined, true),
];
const scene = (id: string, character: string, name: string, updatedAt: number, title = ""): SceneSummary =>
  ({ id, title, updatedAt, snapshotVersion: 1, hasPortrait: false, characterName: name, cast: { character: { id: character, version: 1 } } }) as unknown as SceneSummary;
const take = (id: string, name: string, parentBranchId: string | null) => ({ id, name, parentBranchId, messageCount: 3 });
const openScene = (over: Record<string, unknown> = {}): OpenScene => ({
  hasPortrait: false, messageCount: 48,
  chat: { id: "c1", title: "The flooded archive", snapshotVersion: 1, cast: { character: { id: "alex", version: 1 } }, regex: { sets: ["a", "b"] }, activeBranchId: "b1", ...over },
  snapshot: { character: { body: { identity: { name: "Alex" } } }, persona: { body: { name: "Morgan" } } },
  takes: [take("b1", "main", null), take("b2", "Take 2", "b1")],
}) as unknown as OpenScene;

const rig = {
  host: null as unknown as HTMLElement, root: null as unknown as Root, flush: null as unknown as FlushSync, listing: [] as SceneSummary[] | Error, calls: [] as string[], started: [] as string[],
  back: 0, taken: [] as string[], surfaces: [] as boolean[], mounts: [] as string[], settings: [] as string[], prefs: new Map<string, unknown>(), books: 1,
};
const ctxOf = (): AppContext => {
  const base: Record<string, unknown> = {
    listScenes: async () => { if (rig.listing instanceof Error) throw rig.listing; return rig.listing; },
    getSceneParticipants: async () => ({ participants: null }),
    getSceneLore: async () => ({ books: Array.from({ length: rig.books }, (_, i) => ({ id: `b${i}`, name: "Book", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 1, tokens: 1 })), lastTurn: null }),
    startScene: async (characterId: string) => { rig.started.push(characterId); return { id: `new-${characterId}` }; },
  };
  const api = new Proxy(base, { get: (t, k) => (typeof k === "string" && typeof t[k] === "function" ? (...a: unknown[]) => { rig.calls.push(k); return (t[k] as (...x: unknown[]) => unknown)(...a); } : t[k as string]) });
  return { api, pieces: {}, setStatus: () => undefined, prefs: { get: (k: string) => rig.prefs.get(k), set: (k: string, v: unknown) => { rig.prefs.set(k, v); } } } as unknown as AppContext;
};

function Draft({ name }: { name: string }): JSX.Element {
  const [text, setText] = useState("Saved");
  useEffect(() => { rig.mounts.push(name); }, [name]);
  return <input aria-label={`${name} draft`} value={text} onChange={(e) => setText(e.target.value)} />;
}

const settle = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 5)); rig.flush(() => undefined); };
const propsOf = (over: Partial<MessengerChromeProps>): MessengerChromeProps => ({
  ctx: ctxOf(), chatId: "c1", scene: openScene(), name: "Alex", personaName: "Morgan", programs: PROGRAMS, request: null, actions: null, loreBooks: null,
  onBack: () => { rig.back++; }, onTake: (id) => { rig.taken.push(id); }, onSurface: (open) => { rig.surfaces.push(open); }, renderProgram: (p) => <Draft name={p.title} />,
  renderPersonaSwap: (onClose) => <div role="dialog" aria-label="Casting Call"><button aria-label="Close Casting Call" onClick={onClose} /></div>, onChat: () => undefined,
  renderSettings: (scope, onClose) => { rig.settings.push(scope); return <div role="dialog" aria-modal="true" aria-label={`Settings ${scope}`}><button aria-label={`Close ${scope} settings`} onClick={onClose} /></div>; },
  children: <textarea aria-label="Native draft" defaultValue="" />, ...over,
});
async function mount(over: Partial<MessengerChromeProps> = {}, narrow = false): Promise<void> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const doc = installed.dom.window.document;
  rig.flush = flushSync;
  rig.host = doc.createElement("div");
  rig.host.className = "scs";
  Object.defineProperty(rig.host, "clientWidth", { configurable: true, value: narrow ? 500 : 1400 });
  doc.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(Chrome, propsOf(over))));
  await settle();
}
/** Called by every test and again after it, so a failed assertion never leaves its dialog's Escape owner behind for the next test. */
const unmount = (): void => { if (!rig.host.isConnected) return; rig.flush(() => rig.root.unmount()); rig.host.remove(); };

const all = (sel: string): HTMLElement[] => [...rig.host.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string): HTMLElement | null => rig.host.querySelector<HTMLElement>(sel);
const named = (name: string, within: ParentNode = rig.host): HTMLElement => {
  const hit = [...within.querySelectorAll<HTMLElement>("[aria-label]")].find((e) => e.getAttribute("aria-label") === name) ?? [...within.querySelectorAll<HTMLElement>("button")].find((e) => e.textContent?.trim() === name);
  if (!hit) throw new Error(`no control named ${name}`);
  return hit;
};
const click = (el: Element): void => { rig.flush(() => (el as HTMLElement).click()); };
const press = (target: Element, k: string, init: KeyboardEventInit = {}): void => { rig.flush(() => { target.dispatchEvent(new installed.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); }); };
const chat = (): HTMLElement => one("[data-msn-chat]")!;
const rail = (): HTMLElement => one('nav[aria-label="Characters"]')!;
const bar = (): HTMLElement => one('[role="toolbar"][aria-label="Panels"]')!;
const side = (): HTMLElement | null => one('[data-part="scene.messenger.panel.side"]');
const popout = (): HTMLElement | null => one('[data-part="scene.messenger.panel.popout-layer"]');
const layer = (): HTMLElement | null => one('[data-part="scene.messenger.layer"]');
const type = (el: HTMLElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(installed.dom.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  rig.flush(() => { el.dispatchEvent(new installed.dom.window.Event("input", { bubbles: true })); });
};
const openFromAll = (title: string): void => { click(named("All panels")); click([...all('[role="menuitem"]')].find((e) => e.textContent?.startsWith(title))!); };

describe("the Messenger shell", () => {
  afterEach(() => { if (rig.host) unmount(); });
  beforeEach(() => {
    rig.listing = [scene("c1", "alex", "Alex", 5, "The flooded archive"), scene("c2", "oskar", "Oskar", 9), scene("c3", "alex", "Alex", 1, "Older scene"), scene("c4", "marisol", "Marisol", 3)];
    forgetRecents();
    Object.assign(rig, { calls: [], started: [], back: 0, taken: [], surfaces: [], mounts: [], settings: [], prefs: new Map(), books: 1 });
  });

  test("the rail is Home, then one tile per recent character with the open one marked, then new scene and Discover characters; the programs are not in it", async () => {
    await mount();
    expect([...rail().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Home: your scenes", "Oskar", "Alex: The flooded archive", "Marisol", "Start a new scene", "Discover characters"]);
    expect(named("Alex: The flooded archive", rail()).getAttribute("aria-current")).toBe("page");
    expect(chat().hasAttribute("inert")).toBe(false);
    expect(side()).toBeNull();
    click(named("Home: your scenes"));
    expect(rig.back).toBe(1);
    click(named("Oskar", rail()));
    expect(handedScene()).toBe("c2");
    openFromAll("Characters");
    expect(side()!.getAttribute("aria-label")).toBe("Characters");
    expect(side()!.dataset["width"]).toBe("wide");
    unmount();
  });

  test("the header names the scene and its topic from real counts, and carries the page's takes controls", async () => {
    await mount({ actions: <span id="takes">takes</span> });
    expect(one(".msn-head .msn-title")!.textContent).toBe("The flooded archive");
    expect(one(".msn-head .msn-topic")!.textContent).toBe("Alex · 48 messages · 1 lorebook on · Story Director on");
    expect(one(".msn-head #takes")).not.toBeNull();
    unmount();
    rig.books = 0;
    await mount({ loreBooks: [{ id: "x", name: "X", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 1, tokens: 1 }, { id: "y", name: "Y", source: "scene", addedByScene: true, enabled: false, missing: false, entries: 1, tokens: 1 }], programs: PROGRAMS.slice(0, 4) });
    expect(one(".msn-head .msn-topic")!.textContent).toBe("Alex · 48 messages · 1 lorebook on");
    unmount();
  });

  test("the pinned panels are Scene Note and Memory; each opens its Side panel beside the chat, the chat keeps its node and draft, and the pressed button closes it", async () => {
    await mount();
    expect([...bar().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Scene Note", "Memory", "All panels"]);
    const draft = named("Native draft") as HTMLTextAreaElement;
    draft.value = "Chat in progress";
    click(named("Scene Note", bar()));
    expect(side()!.getAttribute("aria-label")).toBe("Scene Note");
    expect(side()!.dataset["width"]).toBe("side");
    expect(named("Scene Note", bar()).getAttribute("aria-pressed")).toBe("true");
    expect(chat().hasAttribute("inert")).toBe(false);
    expect(named("Native draft")).toBe(draft);
    expect(rig.surfaces.at(-1)).toBe(true);
    click(named("Memory", bar()));
    expect(side()!.getAttribute("aria-label")).toBe("Memory");
    click(named("Memory", bar()));
    expect(side()).toBeNull();
    expect(rig.surfaces.at(-1)).toBe(false);
    expect((named("Native draft") as HTMLTextAreaElement).value).toBe("Chat in progress");
    unmount();
  });

  test("each program opens in the surface its kind names: Side, Wide, Popout and Layer", async () => {
    await mount();
    openFromAll("Control Booth");
    expect(side()!.dataset["width"]).toBe("side");
    openFromAll("My Persona");
    expect(side()!.dataset["width"]).toBe("wide");
    expect(popout()).toBeNull();
    openFromAll("AI Connection");
    expect(side()).toBeNull();
    expect(popout()!.getAttribute("aria-label")).toBe("AI Connection");
    expect(layer()).toBeNull();
    openFromAll("Regex Workshop");
    expect(popout()).toBeNull();
    expect(layer()!.getAttribute("aria-label")).toBe("Regex Workshop");
    expect(one(".msn-bg")!.hasAttribute("inert")).toBe(true);
    click(named("All panels"));
    expect(all('[role="menuitem"]').find((e) => e.textContent?.startsWith("Regex Workshop"))!.textContent).toContain("Layer");
    unmount();
  });

  test("a visited program keeps its draft and mounts once through a Wide to Layer to Wide swap, and the chat is the same element throughout", async () => {
    await mount();
    const node = chat();
    openFromAll("Characters");
    type(named("Characters draft"), "Unsaved edit");
    openFromAll("Regex Workshop");
    expect(layer()).not.toBeNull();
    type(named("Regex Workshop draft"), "Half a regex");
    press(named("Close"), "Escape");
    expect(layer()).toBeNull();
    openFromAll("Regex Workshop");
    expect((named("Regex Workshop draft") as HTMLInputElement).value).toBe("Half a regex");
    press(named("Close"), "Escape");
    openFromAll("Characters");
    expect((named("Characters draft") as HTMLInputElement).value).toBe("Unsaved edit");
    expect(rig.mounts.filter((n) => n === "Characters")).toHaveLength(1);
    expect(rig.mounts.filter((n) => n === "Regex Workshop")).toHaveLength(1);
    expect(chat()).toBe(node);
    unmount();
  });

  test("Escape closes the docked panel, but not while a field has the press; the panel's close button and Pin work", async () => {
    await mount();
    click(named("Scene Note", bar()));
    press(named("Native draft"), "Escape");
    expect(side()).not.toBeNull();
    press(named("Close panel"), "Escape");
    expect(side()).toBeNull();
    click(named("Memory", bar()));
    click(named("Close panel"));
    expect(side()).toBeNull();
    openFromAll("Control Booth");
    click(named("Pin panel"));
    expect(rig.prefs.get(PINNED_KEY)).toEqual(["author-note", "memory", "quickplay"]);
    expect(named("Control Booth", bar()).getAttribute("aria-pressed")).toBe("true");
    click(named("Unpin panel"));
    expect(rig.prefs.get(PINNED_KEY)).toEqual(["author-note", "memory"]);
    unmount();
  });

  test("the sidebar lists this character's scenes with the open one marked, its takes as threads, and opens another scene by its id", async () => {
    await mount();
    const rows = all(".msn-scn");
    expect(rows.map((r) => r.querySelector('[data-control="row"]')!.textContent)).toEqual(["The flooded archive", "Older scene"]);
    expect(rows[0]!.querySelector('[data-control="row"]')!.getAttribute("aria-current")).toBe("page");
    expect(all(".msn-threads [data-control='row']").map((r) => r.textContent)).toEqual(["Director's Cut", "Take 2"]);
    click(named("Take 2"));
    expect(rig.taken).toEqual(["b2"]);
    click(rows[0]!.querySelector('[data-control="row"]')!);
    expect(handedScene()).toBeNull();
    click(named("Older scene"));
    expect(handedScene()).toBe("c3");
    expect(rig.calls.filter((c) => c === "listScenes")).toHaveLength(1);
    unmount();
  });

  test("New scene starts a scene with this character and opens it", async () => {
    await mount();
    click(named("New scene with Alex"));
    await settle();
    expect(rig.started).toEqual(["alex"]);
    expect(handedScene()).toBe("new-alex");
    click(named("Start a new scene"));
    await settle();
    expect(rig.started).toEqual(["alex", "alex"]);
    unmount();
  });

  test("a failed list keeps the open scene reachable with a retry, and an empty list says so", async () => {
    rig.listing = new Error("down");
    await mount();
    expect(rig.host.textContent).toContain(RECENTS_ERROR);
    expect(named("Current chat with Alex", rail()).getAttribute("aria-current")).toBe("page");
    expect(one(".msn-scn [data-control='row']")!.textContent).toBe("The flooded archive");
    rig.listing = [scene("c1", "alex", "Alex", 5, "The flooded archive")];
    click(named("Try again"));
    await settle();
    expect(rig.host.textContent).not.toContain(RECENTS_ERROR);
    unmount();
    rig.listing = [];
    forgetRecents();
    await mount();
    expect(rig.host.textContent).toContain("Your recent character chats will appear here.");
    unmount();
  });

  test("opening a second scene reuses the scenes already loaded, until Try again", async () => {
    await mount();
    expect(rig.calls.filter((c) => c === "listScenes")).toHaveLength(1);
    unmount();
    await mount();
    expect(all(".msn-rail [data-control='tile'][data-kind='thumb']")).toHaveLength(3);
    expect(rig.calls.filter((c) => c === "listScenes")).toHaveLength(1);
    unmount();
  });

  test("Leave writes the hidden list, goes back to Scenes and deletes nothing; a hidden character is gone from the rail unless it is the open one", async () => {
    await mount();
    click(named("Alex: character menu"));
    expect(all('[role="menuitem"]').map((m) => m.textContent)).toEqual(["Character settings", "Notification settings>", "Hide muted scenesOff", "Leave"]);
    click(named("Leave"));
    expect(rig.prefs.get(HIDDEN_KEY)).toEqual(["alex"]);
    expect(rig.back).toBe(1);
    expect(rig.calls.filter((c) => c !== "listScenes" && c !== "getSceneLore" && c !== "getSceneParticipants")).toEqual([]);
    unmount();
    rig.prefs.set(HIDDEN_KEY, ["oskar", "marisol", 7]);
    await mount();
    expect([...rail().querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Home: your scenes", "Alex: The flooded archive", "Start a new scene", "Discover characters"]);
    unmount();
    rig.prefs.set(HIDDEN_KEY, ["alex"]);
    await mount();
    expect(named("Alex: The flooded archive", rail()).getAttribute("aria-current")).toBe("page");
    unmount();
  });

  test("the character menu opens Character settings, the scene gear opens Scene settings and the user gear opens Your settings, each as a modal that blocks the shell behind it", async () => {
    await mount();
    click(named("Alex: character menu"));
    press(named("Character settings"), "Escape");
    expect(one('[role="menu"]')).toBeNull();
    click(named("Alex: character menu"));
    click(named("Character settings"));
    expect(rig.settings).toEqual(["character"]);
    expect(one(".msn-bg")!.hasAttribute("inert")).toBe(true);
    expect(rig.surfaces.at(-1)).toBe(true);
    click(named("Close character settings"));
    expect(one('[aria-label="Settings character"]')).toBeNull();
    expect(one(".msn-bg")!.hasAttribute("inert")).toBe(false);
    click(named("Scene settings"));
    expect(rig.settings.at(-1)).toBe("scene");
    click(named("Close scene settings"));
    click(named("Your settings"));
    expect(rig.settings.at(-1)).toBe("user");
    expect(rig.surfaces.at(-1)).toBe(true);
    click(named("Close user settings"));
    expect(rig.surfaces.at(-1)).toBe(false);
    unmount();
  });

  test("the user panel opens the persona, the AI connection and Switch persona in their surfaces", async () => {
    await mount();
    expect(named("AI connection: not connected")).toBeTruthy();
    click(named("Profile settings"));
    expect(side()!.getAttribute("aria-label")).toBe("My Persona");
    click(named("Switch persona"));
    expect(one("[data-part=\"scene.messenger.user.swap\"] [role=dialog]")!.getAttribute("aria-label")).toBe("Casting Call");
    click(named("Close Casting Call"));
    expect(one("[data-part=\"scene.messenger.user.swap\"]")).toBeNull();
    click(named("AI connection: not connected"));
    expect(popout()!.getAttribute("aria-label")).toBe("AI Connection");
    unmount();
    await mount({ scene: openScene({ connection: { id: "k", model: "m" } }) });
    expect(named("AI connection: connected")).toBeTruthy();
    unmount();
  });

  test("the active features are rows: a Prop panel opens Side, Regex opens its Layer, and the plus opens Add / Remove Features", async () => {
    await mount();
    const features = one('nav[aria-label="Active features"]')!;
    click(named("Story Director", features));
    expect(side()!.getAttribute("aria-label")).toBe("Story Director");
    click(named("Regex (2)", features));
    expect(side()).toBeNull();
    expect(layer()!.getAttribute("aria-label")).toBe("Regex Workshop");
    press(named("Close"), "Escape");
    click(named("Add or remove features"));
    expect(side()!.getAttribute("aria-label")).toBe("Add / Remove Features");
    unmount();
  });

  test("the member list shows the character and the persona, a row opens Participants in the side panel in its place, and its toggle brings it back", async () => {
    await mount();
    const members = named("Member list", rig.host.querySelector(".msn-body")!);
    expect(members.tagName).toBe("ASIDE");
    expect(all(".msn-mem [data-control='row']").map((r) => `${r.querySelector('[data-slot="label"]')!.textContent}/${r.querySelector('[data-slot="subtitle"]')!.textContent}`)).toEqual(["Alex/Character", "Morgan/Persona"]);
    click(all(".msn-mem [data-control='row']")[0]!);
    expect(side()!.getAttribute("aria-label")).toBe("Participants");
    expect(one(".msn-mem")).toBeNull();
    expect(named("Member list", bar().parentElement!).getAttribute("aria-pressed")).toBe("false");
    click(named("Member list", one(".msn-head")!));
    expect(side()).toBeNull();
    expect(one(".msn-mem")).not.toBeNull();
    click(named("Close member list"));
    expect(one(".msn-mem")).toBeNull();
    unmount();
  });

  test("a numbered request opens the wing's first program once, and a null wing closes it", async () => {
    await mount({ request: { n: 1, wing: "ai" } });
    expect(popout()!.getAttribute("aria-label")).toBe("AI Connection");
    click(named("Close popout"));
    expect(popout()).toBeNull();
    unmount();
    await mount({ request: { n: 1, wing: "ai" } });
    unmount();
    await mount({ request: { n: 2, wing: null } });
    expect(side()).toBeNull();
    expect(popout()).toBeNull();
    unmount();
  });

  test("a program that leaves the list closes with it and its node is dropped", async () => {
    await mount();
    openFromAll("Regex Workshop");
    expect(layer()).not.toBeNull();
    rig.flush(() => rig.root.render(createElement(Chrome, propsOf({ programs: PROGRAMS.filter((p) => p.id !== "regex") }))));
    await settle();
    expect(layer()).toBeNull();
    expect(chat().hasAttribute("inert")).toBe(false);
    expect(all("[data-program]")).toHaveLength(0);
    unmount();
  });

  test("under 640px the left side is a drawer: the menu opens it, Escape closes it, and focus returns to the menu button", async () => {
    await mount({}, true);
    const menu = named("Show recent characters");
    (menu as HTMLButtonElement).focus();
    click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(one(".msn-head")!.hasAttribute("inert")).toBe(true);
    expect(chat().hasAttribute("inert")).toBe(true);
    expect(installed.dom.window.document.activeElement).toBe(named("Home: your scenes"));
    press(named("Home: your scenes"), "Escape");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(installed.dom.window.document.activeElement).toBe(menu);
    expect(chat().hasAttribute("inert")).toBe(false);
    click(menu);
    click(named("Close recent characters"));
    expect(installed.dom.window.document.activeElement).toBe(menu);
    click(menu);
    click(named("Close character sidebar"));
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    unmount();
  });

  test("choosing a feature from the drawer closes it and opens the panel with focus inside it", async () => {
    await mount({}, true);
    click(named("Show recent characters"));
    click(named("Story Director", one('nav[aria-label="Active features"]')!));
    expect(named("Show recent characters").getAttribute("aria-expanded")).toBe("false");
    expect(side()!.contains(installed.dom.window.document.activeElement)).toBe(true);
    unmount();
  });

  test("behind a layer and the drawer the floating pop-out layers are inert, and only the ones the shell made inert are released", async () => {
    await mount({}, true);
    const doc = installed.dom.window.document;
    const floating = doc.createElement("div");
    floating.className = "po-layer";
    floating.appendChild(doc.createElement("button"));
    const already = doc.createElement("div");
    already.className = "po-layer";
    already.setAttribute("inert", "");
    rig.host.append(floating, already);
    click(named("Show recent characters"));
    expect(floating.hasAttribute("inert")).toBe(true);
    click(named("Close recent characters"));
    expect(floating.hasAttribute("inert")).toBe(false);
    click(named("Regex (2)", one('nav[aria-label="Active features"]')!));
    expect(floating.hasAttribute("inert")).toBe(true);
    press(named("Close"), "Escape");
    expect(floating.hasAttribute("inert")).toBe(false);
    expect(already.hasAttribute("inert")).toBe(true);
    unmount();
  });

  test("closing a panel gives focus back to the control that opened it", async () => {
    await mount();
    const opener = named("Scene Note", bar()) as HTMLButtonElement;
    opener.focus();
    click(opener);
    click(named("Close panel"));
    expect(installed.dom.window.document.activeElement).toBe(opener);
    unmount();
  });

  test("unread: other scenes with new messages get a red count on the rail and a bold row with a pip, the open scene is marked read, and a scene never opened here is not flagged", async () => {
    const counts: Record<string, number> = { c1: 40, c2: 9, c3: 6, c4: 5 };
    rig.listing = (rig.listing as SceneSummary[]).map((s: SceneSummary) => ({ ...s, messageCount: counts[s.id] }) as SceneSummary);
    rig.prefs.set(READ_MARKS_KEY, { c1: { at: 1, count: 40 }, c2: { at: 1, count: 6 }, c3: { at: 1, count: 2 } });
    const doc = installed.dom.window.document;
    const seen = (v: string): void => { Object.defineProperty(doc, "visibilityState", { configurable: true, value: v }); };
    seen("hidden");
    await mount();
    expect((rig.prefs.get(READ_MARKS_KEY) as Record<string, { count: number }>)["c1"]!.count).toBe(40);
    unmount();
    seen("visible");
    await mount();
    // c2 (Oskar) gained 3; c3 (Alex's other scene) gained 4; c4 has no mark; the open scene c1 is read.
    expect(named("Oskar (3 unread)", rail()).querySelector('[data-slot="badge"]')!.textContent).toBe("3");
    expect(named("Marisol", rail()).querySelector('[data-slot="badge"]')).toBeNull();
    const open = named("Alex: The flooded archive", rail());
    expect(open.querySelector('[data-slot="badge"]')).toBeNull();
    const [current, older] = all(".msn-scn > [data-control=\"row\"]");
    expect(older!.hasAttribute("data-unread")).toBe(true);
    expect(older!.querySelector(".msn-pip")!.textContent).toBe("4");
    expect(current!.hasAttribute("data-unread")).toBe(false);
    expect((rig.prefs.get(READ_MARKS_KEY) as Record<string, { count: number }>)["c1"]!.count).toBe(48);
    unmount();
    seen("hidden");
  });
});
