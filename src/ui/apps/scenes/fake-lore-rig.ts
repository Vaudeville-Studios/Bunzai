/**
 * A scripted World wing for its tests (scene-lore-*.test.tsx): a scene that reads three books, a
 * library that answers like the server (light reads, revision-checked patches applied to what it
 * holds), recorders for every call, and the DOM helpers the files drive it with. Stand-in only:
 * tests import it.
 */
import { createElement } from "react";
import type { JSX } from "react";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import type { LorebookBody, LorebookEntry } from "../../../entities/lorebook/schema";
import type { ParsedCanonicalEntity } from "../../../entities/runtime-schema";
import type { Chat } from "../../../stage/contracts/chat-store";
import type { PiecePatch } from "../../../stage/contracts/piece-patch";
import type { SceneLore, SceneLoreBook, SceneLoreChoice } from "../../app-contract-scenes";
import { emptyLoreEntry } from "../../../core/lore";
import { ApiHttpError } from "../../_shared/api-fetch";
import { applyPiecePatch } from "../../_shared/editor-patch";
import { installDom, type InstalledDom } from "../../_shared/test-dom";

export type FlushSync = typeof import("react-dom")["flushSync"];
export interface Patched { id: string; revision: string; patch: PiecePatch; intent: string | undefined }
type Held = { entity: { kind: string; id: string; body: LorebookBody }; revision: number };

export const entry = (id: string, over: Partial<LorebookEntry> = {}): LorebookEntry => ({
  ...emptyLoreEntry(id), title: id, content: `content-${id}`, triggers: [{ keyword: "storm", isRegex: false }], sortOrder: 100, ...over,
});

export const bodyOf = (name: string, entries: LorebookEntry[]): LorebookBody => ({
  name, tags: [], globalCaseSensitive: false, globalMatchWholeWords: false, globalScanDepth: 4, globalRecursion: true,
  tokenBudget: 2000, budgetMode: "token", entryBudget: 100, entries,
});

export const BOOKS: SceneLoreBook[] = [
  { id: "b1", name: "Keeper's Log", source: "character", enabled: true, missing: false, entries: 2, tokens: 200 },
  { id: "b2", name: "The Drowned Coast", source: "scene", enabled: true, missing: false, entries: 21, tokens: 1000 },
  { id: "b3", name: "My quirks", source: "persona", enabled: false, missing: false, entries: 3, tokens: 40 },
];
export const LIBRARY: StudioEntitySummary[] = [
  { id: "b1", kind: "lorebook", name: "Keeper's Log", facts: { lore: { entryCount: 2, searchKeys: [], enabled: true } } },
  { id: "b4", kind: "lorebook", name: "Sea Reckoning", facts: { lore: { entryCount: 7, searchKeys: [], enabled: true } } },
];
export const CHAT = { id: "chat1", title: "Scene", cast: { character: { id: "c1", version: 1, name: "Marguerite Vane" } }, activeBranchId: "b1", createdAt: 0, updatedAt: 0 } as Chat;

export const rig = {
  dom: null as unknown as JSDOM,
  host: null as unknown as HTMLElement,
  root: null as unknown as Root,
  installed: null as InstalledDom | null,
  mounted: false,
  /** What the scene reads, and what the library holds for each book (keyed by id). */
  books: BOOKS as SceneLoreBook[],
  held: new Map<string, Held>(),
  library: LIBRARY as StudioEntitySummary[],
  lastTurn: null as SceneLore["lastTurn"],
  getLore: [] as string[],
  setLore: [] as { chatId: string; lore: SceneLoreChoice | null }[],
  loads: [] as string[],
  patches: [] as Patched[],
  created: [] as string[],
  statuses: [] as string[],
  opened: [] as unknown[],
  prefs: new Map<string, unknown>(),
  /** Throws from patchEditedEntity when set, to script a 409 or a refusal. */
  failPatch: null as (() => never) | null,
  /** Holds each patch until released (a slow save). */
  gate: null as Promise<void> | null,
};

/** The virtualizer touches ResizeObserver and reads the scroll box's size, which plain jsdom has neither of. */

export function installLoreDom(): void {
  rig.installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8328/",
    pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "SVGElement", "Event", "CustomEvent", "KeyboardEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) },
  });
  rig.dom = rig.installed.dom;
  const proto0 = rig.dom.window.HTMLElement.prototype;
  Object.defineProperty(proto0, "offsetWidth", { configurable: true, get(this: HTMLElement) { return (this.classList.contains("wl-scroll") || this.classList.contains("cp-vs")) ? 200 : 100; } });
  Object.defineProperty(proto0, "offsetHeight", { configurable: true, get(this: HTMLElement) { return (this.classList.contains("wl-scroll") || this.classList.contains("cp-vs")) ? 640 : 40; } });
  const proto = rig.dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
}

/** Fresh recorders and the library: book b1 holds `entries` (default: one constant, one selective). */
export function resetLore(entries: LorebookEntry[] = [entry("always1", { constant: true, triggers: [] }), entry("key1", { title: "The storm" })]): void {
  rig.installed?.reinstall();
  Object.assign(rig, { books: BOOKS, library: LIBRARY, lastTurn: null, getLore: [], setLore: [], loads: [], patches: [], created: [], statuses: [], opened: [], prefs: new Map(), failPatch: null, gate: null });
  rig.held = new Map([["b1", { entity: { kind: "lorebook", id: "b1", body: bodyOf("Keeper's Log", entries) }, revision: 1 }]]);
}

/** The body the library holds for a book now: what the next turn would read. */
export const heldBody = (id = "b1"): LorebookBody => rig.held.get(id)!.entity.body;
export const heldEntry = (entryId: string, id = "b1"): LorebookEntry => heldBody(id).entries.find((e) => e.id === entryId)!;

export function loreCtx(): AppContext {
  const api = {
    getSceneLore: async (chatId: string): Promise<SceneLore> => { rig.getLore.push(chatId); return { books: rig.books, lastTurn: rig.lastTurn }; },
    setSceneLore: async (chatId: string, lore: SceneLoreChoice | null): Promise<SceneLore> => {
      rig.setLore.push({ chatId, lore });
      const off = lore?.off ?? [];
      const added = lore?.added ?? [];
      // a book the scene adds comes from the library (or was just created): it joins the list, switched on
      const joined = added.filter((id) => !rig.books.some((b) => b.id === id)).map((id): SceneLoreBook => ({ id, name: rig.library.find((s) => s.id === id)?.name ?? "Sea Log", source: "scene", enabled: true, missing: false, entries: 0, tokens: 0 }));
      return { books: [...rig.books, ...joined].map((b) => ({ ...b, enabled: !off.includes(b.id) })).filter((b) => b.source !== "scene" || added.includes(b.id)), lastTurn: rig.lastTurn };
    },
    getLightEditableEntity: async (query: string) => {
      const id = decodeURIComponent(/id=([^&]+)/.exec(query)![1]!);
      rig.loads.push(id);
      const held = rig.held.get(id);
      if (!held) throw new ApiHttpError(404, "gone");
      return { entity: structuredClone(held.entity), revision: `r${held.revision}`, version: 1 };
    },
    patchEditedEntity: async (_kind: string, id: string, revision: string, patch: PiecePatch, _uploads?: string[], intent?: string) => {
      if (rig.gate) await rig.gate;
      if (rig.failPatch) rig.failPatch();
      const held = rig.held.get(id)!;
      if (revision !== `r${held.revision}`) throw new ApiHttpError(409, "conflict");
      rig.patches.push({ id, revision, patch, intent });
      held.entity = applyPiecePatch(held.entity as unknown as ParsedCanonicalEntity, patch) as unknown as Held["entity"];
      held.revision += 1;
      return { revision: `r${held.revision}` };
    },
    listEntities: async () => rig.library,
    saveEntity: async (ent: { body: { name: string } }) => { rig.created.push(ent.body.name); return { id: "newbook1", kind: "lorebook", name: ent.body.name }; },
  };
  return {
    api, setStatus: (s: string) => { rig.statuses.push(s); },
    prefs: { get: (k: string) => rig.prefs.get(k), set: (k: string, v: unknown) => { rig.prefs.set(k, v); } },
    workbench: { open: (target: unknown) => { rig.opened.push(target); } }, openApp: () => undefined,
  } as unknown as AppContext;
}

export const settle = async (flushSync: FlushSync, ms = 20): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };

/** Waits for what a step needs rather than a guessed number of milliseconds (the shared test helper). */
import { waitFor } from "../../_shared/test-dom";
export { waitFor };

export async function mountWing(ctx: AppContext = loreCtx(), tab: (props: { ctx: AppContext }) => JSX.Element | null = () => null): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { LoreWing } = await import("./scene-lore-wing");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  rig.mounted = true;
  flushSync(() => rig.root.render(createElement("div", null, createElement(LoreWing, { ctx, chat: CHAT, characterName: "Marguerite Vane", onLore: () => undefined }), tab({ ctx }))));
  await settle(flushSync);
  await settle(flushSync);
  return flushSync;
}
export const unmount = (flushSync: FlushSync): void => {
  if (!rig.mounted) return;
  rig.mounted = false;
  try { flushSync(() => rig.root.unmount()); } finally { rig.host.remove(); }
};

// -- finding and driving things -------------------------------------------------------------------------

export const text = (): string => rig.host.textContent ?? "";
export const q = <T extends Element = HTMLElement>(sel: string): T | null => rig.host.querySelector<T>(sel);
export const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...rig.host.querySelectorAll<T>(sel)];
export const byText = (sel: string, t: string): HTMLElement | undefined => qa(sel).find((e) => (e.textContent ?? "").includes(t));
export const byLabel = (label: string): HTMLElement | null => q(`[aria-label="${label}"]`);
export const props = (el: Element): Record<string, (e: unknown) => void> => (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[Object.keys(el).find((k) => k.startsWith("__reactProps$"))!]!;

export async function press(flushSync: FlushSync, el: Element | null | undefined, ms = 30): Promise<void> {
  if (!el) throw new Error("nothing to press");
  flushSync(() => (el as HTMLElement).click());
  await settle(flushSync, ms);
}
/** Typing cannot be simulated through a dispatched DOM event here; the real onChange runs off the fiber's props. */
export function typeInto(flushSync: FlushSync, el: Element | null, value: string): void {
  if (!el) throw new Error("nothing to type into");
  flushSync(() => props(el)["onChange"]!({ target: { value } }));
}
export function pressKey(flushSync: FlushSync, el: Element, key: string): void {
  flushSync(() => props(el)["onKeyDown"]!({ key, preventDefault: () => undefined, target: el, currentTarget: el }));
}

/** The book list's row and the open book's entry row, found by class and text. */
export const bookRow = (name: string): HTMLElement | undefined => byText(".wl-bk", name);
export const entryRow = (title: string): HTMLElement | undefined => byText(".wl-en", title);

/** Open the first book and (optionally) one entry by its title, with the saves' two-second pause waited out where asked. */
export async function openBook(flushSync: FlushSync, name = "Keeper's Log"): Promise<void> {
  await press(flushSync, bookRow(name), 40);
  await waitFor(flushSync, () => q(".wl-ents"), "the book to open");
}
export async function openEntry(flushSync: FlushSync, title: string): Promise<void> {
  await press(flushSync, entryRow(title), 20);
  await waitFor(flushSync, () => q(".wl-e"), "the entry editor");
}
export const PAUSE = 2050;
