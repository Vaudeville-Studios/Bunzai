/**
 * The chat layout gate: a scene shows only after a layout is chosen. Unset or unreadable saved values show the chooser;
 * Use saves the pick under chat-layout.ts's key and then the scene renders; Preview's Choose only selects.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { JSX } from "react";
import type { Root } from "react-dom/client";
import { installDom, teardownAllDoms, flushTasks, type InstalledDom } from "../../../_shared/test-dom";
import type { AppContext } from "../../../app-contract";
import { CHAT_LAYOUT_KEY } from "../chat-layout";
import { LayoutGate } from "./layout-gate";

afterAll(teardownAllDoms);

let dom: JSDOM;
let installed: InstalledDom;
let root: Root;
let host: HTMLElement;
let store: Map<string, unknown>;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8326/", extraGlobals: ["HTMLInputElement", "SVGElement", "Event", "MouseEvent", "KeyboardEvent"] });
  dom = installed.dom;
});
beforeEach(() => {
  installed.reinstall();
  store = new Map();
  // Reduced motion keeps the page's LightRays on its CSS fallback (no WebGL in the test DOM).
  (dom.window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

const ctx = (): AppContext => ({ prefs: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) } }) as unknown as AppContext;

async function mount(ui: JSX.Element): Promise<void> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(ui));
  for (let i = 0; i < 3; i++) { await flushTasks(); flushSync(() => undefined); }
}
const settle = async (): Promise<void> => { const { flushSync } = await import("react-dom"); for (let i = 0; i < 3; i++) { await flushTasks(); flushSync(() => undefined); } };
const click = async (el: Element | null): Promise<void> => { (el as HTMLElement).click(); await settle(); };
const byText = (text: string): HTMLButtonElement => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const Scene = (): JSX.Element => <div data-testid="scene">the scene</div>;

describe("chat layout gate", () => {
  test("unset shows the chooser with Full Chat preselected, and not the scene", async () => {
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    expect(host.querySelector("[data-testid=scene]")).toBeNull();
    expect(host.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("input[value=stage]")!.checked).toBe(true);
    expect(host.querySelector("[role=status]")!.textContent).toBe("Full Chat selected");
    expect(host.textContent).not.toContain("save it to your account");
  });

  test("picking Messenger and pressing Use saves it and shows the scene", async () => {
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    await click(host.querySelector("input[value=messenger]"));
    expect(host.querySelector("[role=status]")!.textContent).toBe("Messenger selected");
    expect(store.has(CHAT_LAYOUT_KEY)).toBe(false);
    await click(byText("Use Messenger"));
    expect(store.get(CHAT_LAYOUT_KEY)).toBe("messenger");
    expect(host.querySelector("[data-testid=scene]")).not.toBeNull();
    expect(host.querySelector("[role=radiogroup]")).toBeNull();
  });

  test("Preview opens the large view and Choose selects without saving", async () => {
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    await click(host.querySelector("button[aria-label='Preview Messenger']"));
    const dialog = dom.window.document.querySelector("[role=dialog]")!;
    expect(dialog.textContent).toContain("Messenger");
    await click(byText("Choose Messenger"));
    expect(dom.window.document.querySelector("[role=dialog]")).toBeNull();
    expect(host.querySelector<HTMLInputElement>("input[value=messenger]")!.checked).toBe(true);
    expect(store.has(CHAT_LAYOUT_KEY)).toBe(false);
  });

  test("the background shows the focused card's layout, then the selected one again", async () => {
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    const shown = (): string[] => [...host.querySelectorAll("[aria-hidden=true] img[data-shown=true]")].map((img) => img.getAttribute("data-layout")!);
    expect(shown()).toEqual(["stage"]);
    host.querySelector<HTMLInputElement>("input[value=messenger]")!.focus();
    await settle();
    expect(shown()).toEqual(["messenger"]);
    host.querySelector<HTMLInputElement>("input[value=messenger]")!.blur();
    await settle();
    expect(shown()).toEqual(["stage"]);
    expect(host.querySelector<HTMLInputElement>("input[value=stage]")!.checked).toBe(true);
  });

  test("a saved layout shows the scene directly", async () => {
    store.set(CHAT_LAYOUT_KEY, "stage");
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    expect(host.querySelector("[data-testid=scene]")).not.toBeNull();
  });

  test("an unreadable saved value asks again and is not overwritten until chosen", async () => {
    store.set(CHAT_LAYOUT_KEY, "unsupported-layout");
    await mount(<LayoutGate ctx={ctx()}><Scene /></LayoutGate>);
    expect(host.querySelector("[data-testid=scene]")).toBeNull();
    expect(host.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(store.get(CHAT_LAYOUT_KEY)).toBe("unsupported-layout");
  });
});
