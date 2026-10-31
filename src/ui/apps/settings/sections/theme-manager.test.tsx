/** Appearance picker uses unified extension metadata and keeps package writes in Extensions settings. */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";

let dom: JSDOM;
let installed: InstalledDom;
const classNames = new Proxy({}, { get: (_t, property) => String(property) });
mock.module("./theme-manager.module.css", () => ({ default: classNames }));
const appearance = { palette: { surface: { base: "#112233", panel: "#445566" }, text: { text: "#ffffff" }, roles: { brand: { fill: "#ff0000" }, action: { fill: "#00ff00" }, select: { fill: "#0000ff" }, ok: { fill: "#ffff00" } } } };
const entry = (id: string, name: string, enabled = true, hostTrusted = false) => ({ id, hostTrusted, name, version: "1.0.0", digest: "d".repeat(64), enabled, themeScopes: ["appearance.palette"], theme: { appearance }, grants: [], requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], settings: undefined, dataKeys: [], dataBytes: 0 });
let catalog: ReturnType<typeof entry>[] = [];
let apiCalls = 0;
let prefSets: unknown[][] = [];
let root: Root;
let host: HTMLElement;

beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/", extraGlobals: ["MouseEvent"] }); dom = installed.dom; });
afterAll(() => installed.teardown());
beforeEach(() => { installed.reinstall(); apiCalls = 0; prefSets = []; });

const ctx = { api: { extensions: { list: async () => { apiCalls++; return catalog; } } }, prefs: { get: () => "theater", set: (...args: unknown[]) => prefSets.push(args) }, appearance: { get: () => ({ themeId: "theater", name: "Theater" }), onChange: () => () => undefined } } as never;
const text = (): string => host.textContent ?? "";
const byText = (t: string): HTMLButtonElement | undefined => [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "") === t);
async function mount() {
  const { flushSync } = await import("react-dom"); const { createRoot } = await import("react-dom/client"); const { ThemeManager } = await import("./theme-manager");
  host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); root = createRoot(host);
  flushSync(() => root.render(<ThemeManager ctx={ctx} />)); await new Promise((r) => setTimeout(r, 20)); flushSync(() => undefined); return flushSync;
}

test("appearance choices come from unified extension list and save only the requested preference", async () => {
  catalog = [entry("theater", "Theater"), entry("paper", "Paper")];
  const flushSync = await mount();
  const cards = [...host.querySelectorAll("ul li")];
  expect(apiCalls).toBe(1); expect(cards[0]?.hasAttribute("data-selected")).toBe(true); expect(cards[1]?.hasAttribute("data-selected")).toBe(false);
  expect(cards[0]?.querySelectorAll("i").length).toBe(7); expect(byText("Requested")?.disabled).toBe(true);
  flushSync(() => byText("Request")!.click()); await new Promise((r) => setTimeout(r, 0));
  expect(prefSets).toEqual([["theme", "paper"]]); expect(text()).toContain("Theme selection saved.");
  flushSync(() => root.unmount()); host.remove();
});

test("disabled appearances remain visible but cannot be requested", async () => {
  catalog = [entry("paper", "Paper", false)];
  const flushSync = await mount();
  expect(text()).toContain("disabled"); expect(byText("Request")?.disabled).toBe(true);
  expect(prefSets).toEqual([]);
  flushSync(() => root.unmount()); host.remove();
});

test("host-owned theme IDs preserve legacy appearance aliases while selection stays user-controlled", async () => {
  catalog = [entry("bunzai.host.theme.theater", "Theater", true, true), entry("bunzai.host.theme.paper", "Paper", true, true)];
  const flushSync = await mount(); const cards = [...host.querySelectorAll("ul li")];
  expect(cards[0]?.hasAttribute("data-selected")).toBe(true); expect(text()).toContain("Effective: Theater.");
  flushSync(() => byText("Request")!.click()); await new Promise((r) => setTimeout(r, 0));
  expect(prefSets).toEqual([["theme", "paper"]]);
  flushSync(() => root.unmount()); host.remove();
});
