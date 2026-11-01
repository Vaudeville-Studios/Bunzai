/** Settings > Appearance > Chat layout reads and writes the same key the first-open chooser saves. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, teardownAllDoms, flushTasks, type InstalledDom } from "../../../_shared/test-dom";
import { CHAT_LAYOUT_KEY } from "../../scenes/chat-layout";

afterAll(teardownAllDoms);
let dom: JSDOM;
let installed: InstalledDom;
let store: Map<string, unknown>;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", extraGlobals: ["SVGElement", "Event"] });
  dom = installed.dom;
});
beforeEach(() => { installed.reinstall(); store = new Map(); });

async function mount(): Promise<HTMLElement> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { ChatLayoutRow } = await import("./chat-layout-row");
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const prefs = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) };
  flushSync(() => createRoot(host).render(<ChatLayoutRow prefs={prefs} />));
  await flushTasks();
  return host;
}
const heading = (b: Element): string => b.querySelector("[data-slot=heading]")?.textContent ?? "";
const pressed = (host: HTMLElement): string[] => [...host.querySelectorAll("button[aria-pressed=true]")].map(heading);

test("the row shows the saved layout and a pick writes the key", async () => {
  store.set(CHAT_LAYOUT_KEY, "messenger");
  const host = await mount();
  expect(host.textContent).toContain("How every chat is laid out.");
  expect(pressed(host)).toContain("Messenger");
  const { flushSync } = await import("react-dom");
  const full = [...host.querySelectorAll("button")].find((b) => heading(b) === "Full Chat")!;
  flushSync(() => full.click());
  expect(store.get(CHAT_LAYOUT_KEY)).toBe("stage");
  expect(pressed(host)).toEqual(["Full Chat"]);
});

test("every layout is offered as a card, the paper layouts included", async () => {
  const host = await mount();
  const titles = [...host.querySelectorAll("button")].map(heading);
  for (const title of ["Full Chat", "Familiar", "Basic", "Desktop 98", "Messenger", "Immersive", "Letters", "Notebook", "Storybook"]) expect(titles).toContain(title);
  expect(pressed(host)).toEqual(["Full Chat"]);
});
