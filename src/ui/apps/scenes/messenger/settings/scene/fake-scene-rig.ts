/**
 * A scripted open scene for the scene scope's row tests: the wing arguments the settings content reads, an api whose every call is recorded (and answers like the server where a row needs
 * it), the opener, and the DOM helpers the tests drive rows with. Stand-in only: tests import it.
 */
import type { ReactNode } from "react";
import type { Chat } from "../../../../../../stage/contracts/chat-store";
import { resolveDirector } from "../../../../../../core/director/settings";
import type { SceneProp } from "../../../props/prop-contract";
import type { WingArgs } from "../../wing-props";
import type { SettingsCategory } from "../../frames/settings-window";

export type Calls = Record<string, unknown[][]>;

export const BOOKS = [
  { id: "b1", name: "Keeper's Log", source: "character", addedByScene: false, enabled: true, missing: false, entries: 2, tokens: 200 },
  { id: "b2", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: false, missing: false, entries: 21, tokens: 1000 },
];

export interface RigOptions {
  id?: string;
  chat?: Partial<Chat>;
  prefs?: [string, unknown][];
  registeredProps?: SceneProp[];
  propsOn?: string[] | null;
  card?: unknown;
  character?: Record<string, unknown>;
}

export interface Rig {
  a: WingArgs;
  calls: Calls;
  opened: string[];
  open(id: string): void;
  prefs: Map<string, unknown>;
  status: string[];
  chats: Chat[];
  props: { toggled: [string, boolean][] };
}

export function rig(o: RigOptions = {}): Rig {
  const calls: Calls = {};
  const opened: string[] = [];
  const status: string[] = [];
  const chats: Chat[] = [];
  const prefs = new Map<string, unknown>(o.prefs ?? []);
  const props = { toggled: [] as [string, boolean][] };
  const chat = { id: o.id ?? "c1", title: "The flooded archive", cast: { character: { id: "ch1", name: "Vera", version: 3 } }, ...o.chat } as unknown as Chat;
  const rec = (name: string, answer: (...args: unknown[]) => unknown) => (...args: unknown[]): Promise<unknown> => { (calls[name] ??= []).push(args); try { return Promise.resolve(answer(...args)); } catch (e) { return Promise.reject(e); } };
  const answerChat = (): Chat => chat;
  const panel = { on: true, settings: resolveDirector({ director: undefined } as never), tools: "unknown" };
  const api = {
    renameScene: rec("renameScene", answerChat),
    listSceneFolders: rec("listSceneFolders", () => []),
    setScenePrompting: rec("setScenePrompting", answerChat),
    setSceneBackdrop: rec("setSceneBackdrop", answerChat),
    setSceneCompendium: rec("setSceneCompendium", answerChat),
    setSceneTracker: rec("setSceneTracker", answerChat),
    editScene: rec("editScene", () => ({ chat })),
    getSceneLore: rec("getSceneLore", () => ({ books: BOOKS, lastTurn: null })),
    setSceneLore: rec("setSceneLore", () => ({ books: BOOKS, lastTurn: null })),
    sceneConnections: rec("sceneConnections", () => []),
    getEditableEntity: rec("getEditableEntity", () => { throw new Error("no preset"); }),
    getLightEditableEntity: rec("getLightEditableEntity", () => { throw new Error("no pack"); }),
    listEntities: rec("listEntities", () => []),
    getSceneSummary: rec("getSceneSummary", () => ({ settings: {}, text: "", error: null })),
    setSceneSummarySettings: rec("setSceneSummarySettings", () => ({ settings: {}, text: "", error: null })),
    getSceneParticipants: rec("getSceneParticipants", () => ({ participants: { people: [{ id: "n1", kind: "npc", name: "Harbor clerk", presence: "background", at: 1 }] } })),
    changeSceneParticipants: rec("changeSceneParticipants", () => ({ participants: { people: [{ id: "n1", kind: "npc", name: "Harbor clerk", presence: "absent", at: 1 }] } })),
    getSceneDirector: rec("getSceneDirector", () => panel),
    setSceneDirectorSettings: rec("setSceneDirectorSettings", () => panel),
  };
  const scene = { chat, messages: [], messageCount: 214, snapshot: { character: { body: { identity: { name: "Vera", description: "An archivist who keeps two sets of maps.", tagline: "" }, discovery: { rating: "mature", tags: ["river", "maps"] }, variants: [{ id: "v1", label: "Rain" }], ...o.character }, kind: "character" }, persona: { body: { name: "Mina Okafor" }, kind: "persona" } } };
  const a = {
    ctx: { api, prefs: { get: (k: string) => prefs.get(k), set: (k: string, v: unknown) => { prefs.set(k, v); } }, setStatus: (s: string) => { status.push(s); }, workbench: { open: (x: unknown) => { (calls["workbench.open"] ??= []).push([x]); } } },
    scene, name: "Vera", charArt: null, cardPinned: false, busy: false, card: o.card ?? null,
    registeredProps: o.registeredProps ?? [], propsOn: o.propsOn ?? null,
    propsState: { load: { state: "ready", on: o.propsOn ?? [] }, toggle: (id: string, on: boolean) => { props.toggled.push([id, on]); }, reload: () => undefined },
    setScene: (next: unknown) => { const s = typeof next === "function" ? (next as (s: unknown) => { chat: Chat } | null)(scene) : (next as { chat: Chat } | null); if (s) chats.push(s.chat); },
    replaceScene: () => undefined, setLoreBooks: () => undefined, repaint: () => undefined, onUpdate: () => { (calls["onUpdate"] ??= []).push([]); }, onRevert: () => { (calls["onRevert"] ??= []).push([]); },
  } as unknown as WingArgs;
  return { a, calls, opened, open: (id) => { opened.push(id); }, prefs, status, chats, props };
}

/** The body of one section of a category, as the settings window would draw it. */
export const bodyOfSection = (cat: SettingsCategory, id: string): ReactNode => cat.sections.find((s) => s.id === id)?.body;

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const win = (el: Element): Window & typeof globalThis => el.ownerDocument.defaultView as Window & typeof globalThis;

/** The rows of a kind whose text holds `text`. */
export function rowOf(host: HTMLElement, text: string): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>('[data-part^="scene.messenger.settings.row."]')].find((e) => !e.dataset["part"]?.includes(".switch") && !e.dataset["part"]?.includes(".button") && (e.textContent ?? "").includes(text));
  if (!hit) throw new Error(`no row with "${text}"`);
  return hit;
}

export const control = <T extends HTMLElement>(host: HTMLElement, label: string): T => {
  const hit = host.querySelector<T>(`[aria-label="${label}"]`);
  if (!hit) throw new Error(`no control labelled "${label}"`);
  return hit;
};

/** Types into an input, text area or select the way a person does, so React sees the change. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const w = win(el);
  const proto = el instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new w.Event(el instanceof w.HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

export const none = (host: HTMLElement, ...parts: string[]): void => {
  for (const p of parts) if (host.querySelector(`[data-part="${p}"]`) !== null) throw new Error(`${p} is drawn inside the section`);
};
