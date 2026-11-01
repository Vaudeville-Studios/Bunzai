/**
 * The Nodes view rendered: wires and ghosts from stored references, a drag from a port that links,
 * Delete on a wire that unlinks, a dirty piece that cannot link, board edits that persist, and the
 * Workbench's view switch leaving open editors mounted.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../../app-contract";
import { PieceStore } from "../../../_shared/piece-store";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import { CANONICAL_SCHEMA_VERSION } from "../../../../core/canonical";

const names = new Proxy({}, { get: (_t, property) => String(property) });
mock.module("./nodes.module.css", () => ({ default: names }));
mock.module("../styles.module.css", () => ({ default: names }));
mock.module("../htmldoc.module.css", () => ({ default: names }));

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8324/", observers: true,
    extraGlobals: ["SVGElement", "Event", "KeyboardEvent", "DOMParser", "HTMLInputElement", "HTMLTextAreaElement", "CustomEvent"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) },
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
});
afterAll(() => installed.teardown());
beforeEach(() => installed.reinstall());

const vera: StudioEntitySummary = { kind: "character", id: "c1", name: "Vera" };
const velvet: StudioEntitySummary = { kind: "lorebook", id: "b1", name: "Velvet City" };
const character = (refs: string[]) => ({
  schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: "c1",
  body: { identity: { name: "Vera" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {}, ...(refs.length ? { knowledgeRefs: refs } : {}) },
});

interface Harness { ctx: AppContext; prefs: Record<string, unknown>; patches: unknown[][]; status: string[]; open: StudioEntitySummary[]; dirty: Record<string, boolean>; views: string[] }

function harness(refs: string[], open: StudioEntitySummary[] = [vera]): Harness {
  const h: Harness = { prefs: {}, patches: [], status: [], open, dirty: {}, views: [], ctx: null as unknown as AppContext };
  const store = new PieceStore();
  h.ctx = {
    pieces: store,
    api: {
      extensions: { list: async () => [] },
      getEditableEntity: async () => ({ entity: character(refs), revision: "r1" }),
      patchEditedEntity: async (...args: unknown[]) => { h.patches.push(args); return { revision: "r2" }; },
    },
    prefs: { get: (k: string) => h.prefs[k], set: (k: string, v: unknown) => { h.prefs[k] = v; } },
    setStatus: (s: string) => h.status.push(s),
    openApp: () => undefined,
    workbench: { dirty: () => h.dirty, focus: () => undefined, send: () => undefined },
  } as unknown as AppContext;
  store.replace([velvet]);
  return h;
}

let root: Root;
let host: HTMLElement;
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await new Promise((r) => dom.window.setTimeout(r, 15)); };
const q = <T extends Element>(sel: string): T | null => host.querySelector<T>(sel);
const fire = (target: EventTarget, type: string, props: Record<string, unknown> = {}): void => {
  target.dispatchEvent(Object.assign(new dom.window.Event(type, { bubbles: true, cancelable: true }), props));
};
const press = (button: Element): void => fire(button, "click");

async function mountView(h: Harness): Promise<void> {
  const { NodesView } = await import("./NodesView");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  root.render(<NodesView ctx={h.ctx} pieces={h.open} onView={(v) => h.views.push(v)} />);
  await flush();
}

test("open pieces are nodes, a stored reference to an unopened piece is a faded ghost with one wire", async () => {
  const h = harness(["b1"]);
  await mountView(h);
  expect(q('[data-node="character:c1"]')).not.toBeNull();
  const ghost = q('[data-node="lorebook:b1"]')!;
  expect(ghost.className).toContain("nodeGhost");
  expect(ghost.textContent).toContain("Velvet City");
  expect([...host.querySelectorAll("[data-wire]")].map((w) => w.getAttribute("data-wire"))).toEqual(["character:c1>knowledgeRefs>lorebook:b1"]);
  root.unmount();
});

test("an empty bench shows the empty state", async () => {
  const h = harness([], []);
  await mountView(h);
  expect(host.textContent).toContain("Nothing on the canvas yet");
  root.unmount();
});

test("dragging a port onto a compatible node links it with one patch", async () => {
  const h = harness([], [vera, velvet]);
  await mountView(h);
  const target = q<HTMLElement>('[data-node="lorebook:b1"]')!;
  const dot = q<HTMLButtonElement>('[data-node="character:c1"] button[aria-label^="Link Lorebooks"]')!;
  expect(dot.disabled).toBe(false);
  const x = parseFloat(target.style.left) + 40;
  const y = parseFloat(target.style.top) + 30;
  fire(dot, "pointerdown", { button: 0, clientX: 0, clientY: 0 });
  fire(dom.window as unknown as EventTarget, "pointermove", { clientX: x, clientY: y });
  fire(dom.window as unknown as EventTarget, "pointerup", { clientX: x, clientY: y });
  await flush();
  expect(h.patches).toHaveLength(1);
  const [kind, id, revision, patch] = h.patches[0]!;
  expect([kind, id, revision]).toEqual(["character", "c1", "r1"]);
  expect((patch as { head: { body: { knowledgeRefs: string[] } } }).head.body.knowledgeRefs).toEqual(["b1"]);
  root.unmount();
});

test("dropping a wire on empty space or an incompatible node writes nothing", async () => {
  const h = harness([], [vera, { kind: "persona", id: "p1", name: "Chi" }, velvet]);
  await mountView(h);
  const persona = q<HTMLElement>('[data-node="persona:p1"]')!;
  const dot = q<HTMLButtonElement>('[data-node="character:c1"] button[aria-label^="Link Lorebooks"]')!;
  const drop = (x: number, y: number): void => {
    fire(dot, "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    fire(dom.window as unknown as EventTarget, "pointermove", { clientX: x, clientY: y });
    fire(dom.window as unknown as EventTarget, "pointerup", { clientX: x, clientY: y });
  };
  drop(5000, 5000);
  drop(parseFloat(persona.style.left) + 40, parseFloat(persona.style.top) + 30);
  await flush();
  expect(h.patches).toHaveLength(0);
  root.unmount();
});

test("selecting a wire and pressing Delete unlinks it", async () => {
  const h = harness(["b1"]);
  await mountView(h);
  fire(q('[data-wire] path')!, "pointerdown", { button: 0 });
  await flush();
  fire(q('[data-nodes-canvas]')!, "keydown", { key: "Delete" });
  await flush();
  expect(h.patches).toHaveLength(1);
  expect("knowledgeRefs" in (h.patches[0]![3] as { head: { body: object } }).head.body).toBe(false);
  root.unmount();
});

test("a piece with unsaved Desk edits has disabled ports and no wire can be dragged from it", async () => {
  const h = harness([]);
  h.dirty = { "character:c1": true };
  await mountView(h);
  const dot = q<HTMLButtonElement>('button[aria-label^="Link Lorebooks"]')!;
  expect(dot.disabled).toBe(true);
  expect(dot.title).toBe("Save or discard Vera's edits first");
  root.unmount();
});

test("a note added to the board is saved to prefs and comes back on the next mount", async () => {
  const h = harness([], []);
  await mountView(h);
  press([...host.querySelectorAll("button")].find((b) => b.textContent === "+ Add")!);
  await flush();
  press([...host.querySelectorAll("button")].find((b) => b.textContent === "Note")!);
  await flush();
  expect(host.querySelectorAll("[data-board]")).toHaveLength(1);
  root.unmount(); // leaving the view flushes the pending save
  const saved = h.prefs["workbench.nodes"] as { v: number; board: { type: string }[] };
  expect(saved.v).toBe(1);
  expect(saved.board.map((i) => i.type)).toEqual(["note"]);
  await mountView(h);
  expect(host.querySelectorAll("[data-board]")).toHaveLength(1);
  root.unmount();
});

test("a canvas record from a newer version is never saved over, even after an edit", async () => {
  const h = harness([], []);
  const newer = { v: 2, board: [{ id: "s1", type: "sticker", x: 0, y: 0 }], layout: "future" };
  h.prefs["workbench.nodes"] = newer;
  await mountView(h);
  press([...host.querySelectorAll("button")].find((b) => b.textContent === "+ Add")!);
  await flush();
  press([...host.querySelectorAll("button")].find((b) => b.textContent === "Note")!);
  await flush();
  root.unmount(); // the unmount flush is where an overwrite would land
  expect(h.prefs["workbench.nodes"]).toEqual(newer);
});

test("the Workbench keeps an open editor mounted, with its state, while Nodes is showing", async () => {
  const h = harness([], []);
  const doc: StudioEntitySummary = { kind: "htmldoc", id: "d1", name: "A drawing" };
  (h.ctx.workbench as unknown as Record<string, unknown>) = {
    ...h.ctx.workbench,
    pieces: () => [doc], active: () => doc, beside: () => null, recents: () => ({}), restoring: () => false,
    restoreFailure: () => null, onChange: () => () => undefined, setDirty: () => undefined,
  };
  (h.ctx.api as unknown as Record<string, unknown>).getLightEditableEntity = async () => ({
    entity: { body: { name: "A drawing", html: "<b>hi</b>" }, original: {} }, revision: "r1", version: 1, assets: {},
  });
  (h.ctx as unknown as Record<string, unknown>).agent = { publish: () => undefined, current: () => null, onChange: () => () => undefined };
  (h.ctx as unknown as Record<string, unknown>).menus = { useContextMenu: () => () => undefined };
  const { default: app } = await import("../index");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  root.render(<app.Component ctx={h.ctx} />);
  await flush();
  const hide = (): HTMLButtonElement => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Hide"))!;
  const source = q<HTMLTextAreaElement>("textarea")!;
  press(hide());
  await flush();
  const pane = source.closest("div")!;
  expect(pane.hasAttribute("hidden")).toBe(true);

  press([...host.querySelectorAll("button")].find((b) => b.textContent === "Nodes")!);
  await flush();
  expect(h.prefs["workbench.view"]).toBe("nodes");
  expect(source.isConnected).toBe(true);
  expect(source.closest(".paneWrapHidden")).not.toBeNull();
  expect(q('[data-part="nodes.root"]')).not.toBeNull();

  press([...host.querySelectorAll("button")].find((b) => b.textContent === "Desk")!);
  await flush();
  expect(q('[data-part="nodes.root"]')).toBeNull();
  expect(q("textarea")).toBe(source);
  expect(source.closest(".paneWrapHidden")).toBeNull();
  expect(pane.hasAttribute("hidden")).toBe(true);
  root.unmount();
});
