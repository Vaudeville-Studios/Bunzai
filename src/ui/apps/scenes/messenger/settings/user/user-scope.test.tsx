/** The You scope is rows: each preference row reads its stored value and writes through the existing key, drill rows call the opener, and no wing or Settings-app form sits in a section. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createElement, type JSX } from "react";
import { SETTING_KEYS } from "../../../../../../studio/settings-shape";
import type { AppContext } from "../../../../../app-contract";
import type { InstalledDom } from "../../../../../_shared/test-dom";
import { MUSIC_TAB_PREF } from "../../../stage-music-core";
import { installSingleDom, mountSingle } from "../../../single-wing-rig";
import type { WingArgs } from "../../wing-props";
import type { RowDef, RowEnv } from "../rows";
import { userScope } from "../user-scope";
import { userDeep } from "./deep";
import { ACCESS_ROWS, MUSIC_ROWS, WORKBENCH_ROWS, studioRows } from "./pref-rows";
import { ProfileRows } from "./profile";
import { MusicDrills, SpotifyRows } from "./music";
import { ConnectionRows } from "./connection";
import { MachineRows } from "./studio";

let installed: InstalledDom;
beforeAll(() => { installed = installSingleDom(8353); });
afterAll(async () => { await installed.teardown(); });

const rig = (): { env: RowEnv; ctx: AppContext; store: Map<string, unknown>; opened: string[]; apps: string[] } => {
  const store = new Map<string, unknown>();
  const opened: string[] = [];
  const apps: string[] = [];
  const ctx = {
    prefs: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => { store.set(k, v); } },
    apps: () => [{ id: "scenes", title: "The Scenes" }, { id: "library", title: "The Library" }],
    openApp: (id: string) => { apps.push(id); },
    api: { formats: async () => [], listEntities: async () => [], sceneConnections: async () => [], spotifyGet: async () => { throw new Error("offline"); }, extensions: { list: async () => [] } },
  } as unknown as AppContext;
  return { store, opened, apps, ctx, env: { ctx, repaint: () => undefined } };
};
const byId = (rows: readonly RowDef[], id: string): RowDef => { const r = rows.find((x) => x.id === id); if (!r) throw new Error(id); return r; };
const args = (ctx: AppContext): WingArgs => ({ ctx, scene: { chat: { id: "c1", cast: { character: {} } }, snapshot: { character: { body: {} }, persona: { body: { name: "Mina" } } }, messages: [], messageCount: 3 }, name: "Vera", registeredProps: [], propsOn: null, repaint: () => undefined } as unknown as WingArgs);
const click = async (host: HTMLElement, label: string): Promise<void> => {
  const row = [...host.querySelectorAll<HTMLElement>('[data-part="scene.messenger.settings.row.drill"]')].find((r) => r.textContent?.includes(label));
  if (!row) throw new Error(`no drill row ${label}`);
  row.click();
  await new Promise((x) => setTimeout(x, 10));
};

describe("preference rows", () => {
  test("workbench rows read the stored value and write the Settings app's keys", () => {
    const r = rig();
    expect(byId(WORKBENCH_ROWS, "autosave").read(r.env)).toBe(false);
    (byId(WORKBENCH_ROWS, "autosave") as { write(e: RowEnv, v: boolean): void }).write(r.env, true);
    expect(r.store.get("workbench.autosave")).toBe(true);
    (byId(WORKBENCH_ROWS, "editorLayout") as { write(e: RowEnv, v: string): void }).write(r.env, "playbill");
    expect(byId(WORKBENCH_ROWS, "editorLayout").read(r.env)).toBe("playbill");
    expect(r.store.get("editor.layout")).toBe("playbill");
    (byId(WORKBENCH_ROWS, "workbenchFollow") as { write(e: RowEnv, v: string): void }).write(r.env, "never");
    expect(r.store.get(SETTING_KEYS.workbenchFollow)).toBe("never");
  });

  test("the music tab switch is on until switched off", () => {
    const r = rig();
    expect(byId(MUSIC_ROWS, "musicTab").read(r.env)).toBe(true);
    (byId(MUSIC_ROWS, "musicTab") as { write(e: RowEnv, v: boolean): void }).write(r.env, false);
    expect(r.store.get(MUSIC_TAB_PREF)).toBe(false);
  });

  test("home and library rows list the studio's apps and decks and write the same keys", () => {
    const r = rig();
    const rows = studioRows(r.env);
    expect(rows.map((x) => x.id)).toEqual(["homeApp", "firstDeck"]);
    expect(byId(rows, "homeApp").read(r.env)).toBe("scenes");
    (byId(rows, "homeApp") as { write(e: RowEnv, v: string): void }).write(r.env, "library");
    expect(r.store.get(SETTING_KEYS.homeApp)).toBe("library");
    expect(byId(rows, "firstDeck").read(r.env)).toBe("character");
  });
});

describe("drill rows", () => {
  test("persona opens its program and shows the persona's name", async () => {
    const r = rig();
    const opened: string[] = [];
    const m = await mountSingle(installed, createElement(ProfileRows, { a: args(r.ctx), open: (id: string) => opened.push(id) }));
    expect(m.host.textContent).toContain("Mina");
    await click(m.host, "Persona");
    expect(opened).toEqual(["persona"]);
    m.done();
  });

  test("the scene model, track library and player open their programs", async () => {
    const r = rig();
    const opened: string[] = [];
    const open = (id: string): void => { opened.push(id); };
    const m = await mountSingle(installed, createElement("div", null, createElement(ConnectionRows, { open }), createElement(MusicDrills, { open, library: true }), createElement(SpotifyRows, { ctx: r.ctx, open, player: true })));
    await click(m.host, "This scene's model");
    await click(m.host, "Track library and player");
    await click(m.host, "Player");
    expect(opened).toEqual(["model", "mood-music", "spotify"]);
    m.done();
  });

  test("the machine tools open the Settings app", async () => {
    const r = rig();
    const m = await mountSingle(installed, createElement(MachineRows, { ctx: r.ctx }));
    await click(m.host, "Updates");
    expect(r.apps).toEqual(["settings"]);
    m.done();
  });
});

describe("the scope holds rows only", () => {
  test("no section body draws a wing or a Settings-app form", async () => {
    const r = rig();
    const scope = userScope(args(r.ctx), r.env, () => undefined);
    const m = await mountSingle(installed, createElement("div", null, ...scope.categories.flatMap((c) => c.sections.map((s): JSX.Element => createElement("section", { key: `${c.id}.${s.id}` }, s.body)))));
    for (const part of ["scene.messenger.settings.tool", "scene.messenger.settings.studio", "scene.prompting", "scene.generation", "scene.ai.models"]) expect(m.host.querySelector(`[data-part="${part}"]`)).toBeNull();
    expect(m.host.querySelectorAll('[data-part^="scene.messenger.settings.row"]').length).toBeGreaterThan(20);
    m.done();
  });

  test("the protected forms are reached only through deeper pages", () => {
    for (const id of ["user.models", "user.connections", "user.security", "user.backups", "user.spotify", "user.themes"]) expect(userDeep(args(rig().ctx), id)?.sections).toHaveLength(1);
    expect(userDeep(args(rig().ctx), "user.nothing")).toBeNull();
  });
});

describe("accessibility rows", () => {
  test("they read safe defaults, write the shared keys, and clamp the size", () => {
    const r = rig();
    const w = (id: string, v: unknown): void => (byId(ACCESS_ROWS, id) as { write(e: RowEnv, v: unknown): void }).write(r.env, v);
    expect(byId(ACCESS_ROWS, "uiTextSize").read(r.env)).toBe(14);
    expect(byId(ACCESS_ROWS, "reduceMotion").read(r.env)).toBe(false);
    expect(byId(ACCESS_ROWS, "highContrast").read(r.env)).toBe(false);
    w("uiTextSize", 3);
    expect(r.store.get(SETTING_KEYS.uiTextSize)).toBe(12);
    w("reduceMotion", true);
    w("highContrast", true);
    expect(r.store.get(SETTING_KEYS.uiReduceMotion)).toBe(true);
    expect(r.store.get(SETTING_KEYS.uiHighContrast)).toBe(true);
    expect(byId(ACCESS_ROWS, "reduceMotion").read(r.env)).toBe(true);
  });

  test("the You scope places them under Accessibility", () => {
    const r = rig();
    const cat = userScope(args(r.ctx), r.env, () => undefined).categories.find((c) => c.id === "access");
    expect(cat?.label).toBe("Accessibility");
    expect(cat?.sections.map((s) => s.id)).toEqual(["reading"]);
  });
});

describe("play on scene open row", () => {
  test("it reads off by default and writes the Stage music key", () => {
    const r = rig();
    const row = byId(MUSIC_ROWS, "autoplay");
    expect(row.read(r.env)).toBe(false);
    (row as { write(e: RowEnv, v: boolean): void }).write(r.env, true);
    expect(r.store.get("scenes.stage.autoplay")).toBe(true);
    expect(row.read(r.env)).toBe(true);
  });
});

describe("the Notifications page", () => {
  const realNotification = (globalThis as { Notification?: unknown }).Notification;
  afterAll(() => { (globalThis as { Notification?: unknown }).Notification = realNotification; });

  test("the desktop notice switch writes the one messenger.notify pref, and asks permission only when turned on", async () => {
    let asked = 0;
    (globalThis as { Notification?: unknown }).Notification = Object.assign(function Notification() { /* never shown here */ }, { permission: "default", requestPermission: async () => { asked += 1; return "granted"; } });
    const r = rig();
    const section = userScope(args(r.ctx), r.env, () => undefined).categories.find((c) => c.id === "notifications")!.sections[0]!;
    const m = await mountSingle(installed, createElement("div", null, section.body));
    expect(asked).toBe(0);
    const row = [...m.host.querySelectorAll<HTMLElement>('[data-part^="scene.messenger.settings.row"]')].find((e) => e.textContent?.includes("Desktop notice"));
    expect(row).toBeDefined();
    const sw = m.host.querySelector<HTMLElement>('[role="switch"][aria-label="Desktop notice"]') ?? row!.querySelector<HTMLElement>('[role="switch"]')!;
    sw.click();
    await new Promise((x) => setTimeout(x, 20));
    expect(asked).toBe(1);
    expect((r.store.get("messenger.notify") as { desktop: boolean }).desktop).toBe(true);
    sw.click();
    await new Promise((x) => setTimeout(x, 20));
    expect((r.store.get("messenger.notify") as { desktop: boolean }).desktop).toBe(false);
    m.done();
  });

  test("a browser without notices does not draw the switch", async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    const r = rig();
    const section = userScope(args(r.ctx), r.env, () => undefined).categories.find((c) => c.id === "notifications")!.sections[0]!;
    const m = await mountSingle(installed, createElement("div", null, section.body));
    expect(m.host.textContent).not.toContain("Desktop notice");
    expect(m.host.textContent).toContain("Response chime");
    m.done();
  });
});
