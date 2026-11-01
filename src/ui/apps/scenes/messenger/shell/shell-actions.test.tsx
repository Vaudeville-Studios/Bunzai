/**
 * The sidebar and rail actions of backlog slices 3, 4, 22 and 30, through the shell as a person uses it: Discover starts a scene with a Library character, a scene row's menu renames, moves,
 * mutes and trashes (the soft delete only), the character menu's notification choices and Hide muted scenes, the desktop switch asking for permission only when turned on, and Swap persona casting
 * through the Cast wing's own writer. The programs are stand-ins; the stores are the app's prefs and a recording API.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement, type JSX } from "react";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../../../app-contract";
import { handedScene, handOffScene } from "../../../../_shared/scene-handoff";
import { installDom, type InstalledDom } from "../../../../_shared/test-dom";
import type { OpenScene, SceneSummary } from "../../../../../studio/scenes";
import { HIDE_MUTED_KEY, MUTED_SCENES_KEY, NOTIFY_KEY } from "../../reply-notice";
import type { MessengerChromeProps } from "../messenger-chrome";
import type { WingArgs } from "../wing-props";
import { forgetRecents } from "../use-recent-characters";
import { DESKTOP_DENIED } from "./use-notify-prefs";

type FlushSync = typeof import("react-dom")["flushSync"];

let installed: InstalledDom;
let Chrome: typeof import("../messenger-chrome")["MessengerChrome"];
let Swap: typeof import("./persona-swap")["PersonaSwap"];
const realNotification = (globalThis as { Notification?: unknown }).Notification;
beforeAll(async () => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", observers: true, extraGlobals: ["sessionStorage", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "SVGElement", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle"] });
  Chrome = (await import("../messenger-chrome")).MessengerChrome;
  Swap = (await import("./persona-swap")).PersonaSwap;
});
afterAll(async () => { (globalThis as { Notification?: unknown }).Notification = realNotification; await installed.teardown(); });

const scene = (id: string, character: string, name: string, updatedAt: number, title: string): SceneSummary =>
  ({ id, title, updatedAt, snapshotVersion: 1, hasPortrait: false, characterName: name, folderId: null, cast: { character: { id: character, version: 1 } } }) as unknown as SceneSummary;
const openScene = (): OpenScene => ({
  hasPortrait: false, messageCount: 4,
  chat: { id: "c1", title: "The flooded archive", snapshotVersion: 7, cast: { character: { id: "alex", version: 1 }, persona: { id: "p1", version: 1 } }, activeBranchId: "b1" },
  snapshot: { character: { body: { identity: { name: "Alex" } } }, persona: { body: { name: "Morgan" } } },
  takes: [{ id: "b1", name: "main", parentBranchId: null, messageCount: 4 }],
}) as unknown as OpenScene;

const rig = {
  host: null as unknown as HTMLElement, root: null as unknown as Root, flush: null as unknown as FlushSync,
  prefs: new Map<string, unknown>(), calls: [] as { fn: string; args: unknown[] }[], statuses: [] as string[], back: 0, chats: [] as unknown[], replaced: [] as unknown[],
  permission: "default" as string, asked: 0, answer: "granted" as string, folders: [{ id: "f1", name: "Chapter one", count: 1 }],
};
const used = (fn: string): unknown[][] => rig.calls.filter((c) => c.fn === fn).map((c) => c.args);

const ctxOf = (): AppContext => {
  const base: Record<string, unknown> = {
    listScenes: async () => [scene("c1", "alex", "Alex", 9, "The flooded archive"), scene("c3", "alex", "Alex", 5, "Older scene"), scene("c2", "oskar", "Oskar", 4, "")],
    getSceneParticipants: async () => ({ participants: null }),
    getSceneLore: async () => ({ books: [], lastTurn: null }),
    listEntities: async (kind: string) => (kind === "character" ? [{ id: "marisol", name: "Marisol", hasPortrait: false }] : [{ id: "p1", name: "Morgan", hasPortrait: false }, { id: "p2", name: "Rue", hasPortrait: false }]),
    startScene: async (id: string) => ({ id: `new-${id}` }),
    renameScene: async (id: string, title: string) => ({ id, title }),
    listSceneFolders: async () => rig.folders,
    setSceneFolder: async (id: string, folderId: string | null) => ({ id, folderId }),
    deleteScene: async () => ({ deleted: true }),
    personaStats: async () => ({ messages: 1, scenes: 2, streak: 0 }),
    editScene: async () => openScene(),
  };
  const api = new Proxy(base, { get: (t, k) => (typeof k === "string" && typeof t[k] === "function" ? (...a: unknown[]) => { rig.calls.push({ fn: k, args: a }); return (t[k] as (...x: unknown[]) => unknown)(...a); } : t[k as string]) });
  return { api, pieces: {}, setStatus: (s: string) => { rig.statuses.push(s); }, prefs: { get: (k: string) => rig.prefs.get(k), set: (k: string, v: unknown) => { rig.prefs.set(k, v); } } } as unknown as AppContext;
};

const settle = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 5)); rig.flush(() => undefined); };
async function mountNode(node: JSX.Element, narrow = false): Promise<void> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const doc = installed.dom.window.document;
  rig.flush = flushSync;
  rig.host = doc.createElement("div");
  rig.host.className = "scs";
  Object.defineProperty(rig.host, "clientWidth", { configurable: true, value: narrow ? 500 : 1400 });
  doc.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(node));
  await settle();
}
const chromeProps = (): MessengerChromeProps => ({
  ctx: ctxOf(), chatId: "c1", scene: openScene(), name: "Alex", personaName: "Morgan", programs: [], request: null, actions: null, loreBooks: null,
  onBack: () => { rig.back++; }, onTake: () => undefined, onSurface: () => undefined, renderProgram: () => null, renderSettings: () => null,
  renderPersonaSwap: () => null, onChat: (chat) => { rig.chats.push(chat); }, children: null,
});
const unmount = (): void => { if (!rig.host.isConnected) return; rig.flush(() => rig.root.unmount()); rig.host.remove(); };

const doc = (): Document => installed.dom.window.document;
const all = (sel: string): HTMLElement[] => [...doc().querySelectorAll<HTMLElement>(sel)];
const one = (sel: string): HTMLElement | null => doc().querySelector<HTMLElement>(sel);
const named = (name: string): HTMLElement => {
  const hit = all("[aria-label]").find((e) => e.getAttribute("aria-label") === name) ?? all("button,[role=menuitem]").find((e) => e.textContent?.trim().startsWith(name));
  if (!hit) throw new Error(`no control named ${name}`);
  return hit;
};
const click = (el: Element): void => { rig.flush(() => (el as HTMLElement).click()); };
const menuItems = (): string[] => all('[role="menuitem"]').map((m) => m.textContent ?? "");
const rowOf = (id: string): HTMLElement => one(`[data-part="scene.messenger.sidebar.scene.${id}"]`)!;
const rightClick = (el: Element): void => { rig.flush(() => { el.dispatchEvent(new installed.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })); }); };
const typeInto = (el: HTMLElement, value: string): void => {
  Object.getOwnPropertyDescriptor(installed.dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
  rig.flush(() => { el.dispatchEvent(new installed.dom.window.Event("input", { bubbles: true })); });
};
const submit = (): void => click(all("button").find((b) => b.getAttribute("type") === "submit")!);
const fakeNotification = (): void => {
  (globalThis as { Notification?: unknown }).Notification = class { static get permission(): string { return rig.permission; } static async requestPermission(): Promise<string> { rig.asked++; rig.permission = rig.answer; return rig.answer; } };
};

beforeEach(() => {
  forgetRecents();
  handOffScene(null);
  Object.assign(rig, { prefs: new Map(), calls: [], statuses: [], back: 0, chats: [], replaced: [], permission: "default", asked: 0, answer: "granted" });
  fakeNotification();
});
afterEach(() => { if (rig.host) unmount(); });

describe("Discover and Home", () => {
  test("the compass opens the Library's character browser, and a pick starts a scene through the same writer and opens it", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    click(named("Discover characters"));
    await settle();
    expect(one('[aria-label="Character Library"]')).not.toBeNull();
    click(all("button").find((b) => b.textContent?.includes("Marisol"))!);
    await settle();
    expect(used("startScene")).toEqual([["marisol"]]);
    expect(handedScene()).toBe("new-marisol");
    const before = used("listScenes").length;
    unmount();
    await mountNode(createElement(Chrome, chromeProps()));
    expect(used("listScenes").length).toBe(before + 1);
  });

  test("Home goes back to the Scenes page", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    click(named("Home: your scenes"));
    expect(rig.back).toBe(1);
  });
});

describe("a scene row's menu", () => {
  test("right click lists Rename, Move to folder, Mute scene and Move to Trash, and the More button opens the same menu", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    expect(menuItems()).toEqual(["Rename", "Move to folder", "Mute scene", "Move to Trash"]);
    rig.flush(() => { named("Rename").dispatchEvent(new installed.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    click(named("More for Older scene"));
    expect(menuItems()).toContain("Move to Trash");
  });

  test("Rename changes another scene's title and reads the list again; the open scene's new chat goes back to the page", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    click(named("Rename"));
    typeInto(one('input[aria-label="Scene title"]')!, "  The drowned stacks  ");
    submit();
    await settle();
    expect(used("renameScene")).toEqual([["c3", "The drowned stacks"]]);
    expect(rig.chats).toEqual([]);
    await settle();
    expect(used("listScenes").length).toBe(2);
    rightClick(rowOf("c1"));
    click(named("Rename"));
    typeInto(one('input[aria-label="Scene title"]')!, "Archive");
    submit();
    await settle();
    expect(rig.chats).toEqual([{ id: "c1", title: "Archive" }]);
  });

  test("an unchanged or empty title writes nothing", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    click(named("Rename"));
    typeInto(one('input[aria-label="Scene title"]')!, "   ");
    submit();
    await settle();
    expect(used("renameScene")).toEqual([]);
  });

  test("Move to folder lists the folders and files the scene", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    click(named("Move to folder"));
    await settle();
    click(named("Chapter one"));
    await settle();
    expect(used("setSceneFolder")).toEqual([["c3", "f1"]]);
  });

  test("Move to Trash asks first, then soft-deletes only that scene; Cancel deletes nothing", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    click(named("Move to Trash"));
    expect(one('[aria-label="Cut this story"]')!.textContent).toContain("3 days");
    click(named("Cancel"));
    expect(used("deleteScene")).toEqual([]);
    rightClick(rowOf("c3"));
    click(named("Move to Trash"));
    click(named("Delete"));
    await settle();
    expect(used("deleteScene")).toEqual([["c3"]]);
    expect(rig.statuses).toContain("Moved to the Trash.");
    expect(rig.back).toBe(0);
    expect(rig.calls.map((c) => c.fn).filter((f) => /delete|purge|remove/i.test(f))).toEqual(["deleteScene"]);
  });

  test("trashing the open scene leaves its page", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c1"));
    click(named("Move to Trash"));
    click(named("Delete"));
    await settle();
    expect(used("deleteScene")).toEqual([["c1"]]);
    expect(rig.back).toBe(1);
  });
});

describe("notifications", () => {
  test("Mute scene marks the row and Hide muted scenes then hides it, but never the open scene", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    rightClick(rowOf("c3"));
    click(named("Mute scene"));
    expect(rig.prefs.get(MUTED_SCENES_KEY)).toEqual(["c3"]);
    expect(one('[data-part="scene.messenger.sidebar.muted.c3"]')).not.toBeNull();
    rightClick(rowOf("c1"));
    click(named("Mute scene"));
    expect(rig.prefs.get(MUTED_SCENES_KEY)).toEqual(["c3", "c1"]);
    click(named("Alex: character menu"));
    click(named("Hide muted scenes"));
    expect(rig.prefs.get(HIDE_MUTED_KEY)).toBe(true);
    expect(rowOf("c3")).toBeNull();
    expect(rowOf("c1")).not.toBeNull();
    click(named("Alex: character menu"));
    expect(menuItems()).toContain("Hide muted scenesOn");
    click(named("Hide muted scenes"));
    expect(rowOf("c3")).not.toBeNull();
  });

  test("Notification settings keeps this character's choice and nothing else", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    click(named("Alex: character menu"));
    click(named("Notification settings"));
    click(named("Mute Alex"));
    expect(rig.prefs.get(NOTIFY_KEY)).toEqual({ desktop: false, byCharacter: { alex: "muted" } });
    click(named("Alex: character menu"));
    click(named("Notification settings"));
    click(named("All replies"));
    expect(rig.prefs.get(NOTIFY_KEY)).toEqual({ desktop: false, byCharacter: {} });
  });

  test("the desktop notice asks permission only when turned on, and says so when it is refused", async () => {
    await mountNode(createElement(Chrome, chromeProps()));
    expect(rig.asked).toBe(0);
    click(named("Alex: character menu"));
    click(named("Notification settings"));
    rig.answer = "denied";
    click(named("Desktop notice"));
    await settle();
    expect(rig.asked).toBe(1);
    expect(rig.statuses).toEqual([DESKTOP_DENIED]);
    expect((rig.prefs.get(NOTIFY_KEY) as { desktop?: boolean } | undefined)?.desktop ?? false).toBe(false);
    rig.answer = "granted";
    rig.permission = "default";
    click(named("Alex: character menu"));
    click(named("Notification settings"));
    click(named("Desktop notice"));
    await settle();
    expect(rig.asked).toBe(2);
    expect((rig.prefs.get(NOTIFY_KEY) as { desktop: boolean }).desktop).toBe(true);
  });

  test("a browser without notices does not offer the desktop notice", async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    await mountNode(createElement(Chrome, chromeProps()));
    click(named("Alex: character menu"));
    click(named("Notification settings"));
    expect(menuItems().some((m) => m.startsWith("Desktop notice"))).toBe(false);
  });
});

describe("Swap persona", () => {
  const argsOf = (busy: boolean): WingArgs => ({ ctx: ctxOf(), scene: openScene(), busy, replaceScene: (next: OpenScene) => { rig.replaced.push(next.chat.id); } }) as unknown as WingArgs;

  test("casting asks first, then writes the persona against the scene's snapshot version and hands the scene back", async () => {
    let closed = 0;
    await mountNode(createElement(Swap, { args: argsOf(false), onClose: () => { closed++; }, onNew: () => undefined }));
    await settle();
    click(all('[role="option"]').find((o) => o.textContent?.includes("Rue"))!);
    click(named("Cast"));
    expect(used("editScene")).toEqual([]);
    expect(one('[aria-label="Play as Rue"]')).not.toBeNull();
    click(all("button").find((b) => b.textContent === "Play as Rue")!);
    await settle();
    expect(used("editScene")).toEqual([["persona", { chatId: "c1", personaId: "p2", expectedSnapshotVersion: 7 }]]);
    expect(rig.replaced).toEqual(["c1"]);
    expect(closed).toBe(1);
  });

  test("while a reply is being written nothing can be cast, and the person is told why", async () => {
    await mountNode(createElement(Swap, { args: argsOf(true), onClose: () => undefined, onNew: () => undefined }));
    await settle();
    click(all('[role="option"]').find((o) => o.textContent?.includes("Rue"))!);
    expect((named("Cast") as HTMLButtonElement).disabled).toBe(true);
    expect(doc().body.textContent).toContain("A reply is being written");
    expect(used("editScene")).toEqual([]);
  });
});
