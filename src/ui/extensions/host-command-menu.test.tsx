/** Purpose: ensure selected resources travel as separate host context and over-limit selections are not truncated. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import type { JSDOM } from "jsdom";
import { expectWindowed, flushTasks, installDom, type InstalledDom } from "../_shared/test-dom";
import type { InstalledExtensionSummary } from "../../extensions/runtime/service-api";
import { HostCommandMenu, type HostCommandMenuProps } from "./host-command-menu";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/", observers: true, pretendToBeVisual: true, globals: { IS_REACT_ACT_ENVIRONMENT: true } }); dom = installed.dom; });
afterAll(() => installed.teardown());

const extension: InstalledExtensionSummary = {
  id: "demo.audit", hostTrusted: true, revision: 1, digest: "a".repeat(64), name: "Audit", version: "1", description: "", enabled: true, recoveryRequired: false,
  grants: [], requirements: [], contributions: [{ type: "command", id: "inspect", label: "Inspect", operation: "demo.inspect" }], settings: undefined,
  theme: null, themeScopes: [], eventSubscriptions: [], dataKeys: [], dataBytes: 0, registeredCommands: ["inspect"], promptFailures: [], suspendedPromptIds: [], activity: [],
};

async function mount(resources: readonly { kind: string; id: string }[], onActivate: HostCommandMenuProps["onActivate"], extensions: readonly InstalledExtensionSummary[] = [extension]) {
  const { createRoot } = await import("react-dom/client");
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<HostCommandMenu api={{ list: async () => extensions }} resources={resources} onActivate={onActivate} />); await flushTasks(6); });
  return { host, root, unmount: async () => { await act(async () => { root.unmount(); }); host.remove(); } };
}

async function scrollToEnd(scroller: HTMLElement, top: number): Promise<void> {
  let scrollTop = 0;
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
  scroller.getBoundingClientRect = () => ({ top: scrollTop, bottom: scrollTop, left: 0, right: 0, width: 0, height: 0, x: 0, y: scrollTop, toJSON: () => ({}) });
  await act(async () => { scroller.scrollTop = top; scroller.dispatchEvent(new dom.window.Event("scroll")); await flushTasks(6, 10); });
}

test("passes focused refs separately from guest input for a registered command", async () => {
  const calls: unknown[][] = [];
  const ref = { kind: "character", id: "vera" };
  const view = await mount([ref], async (...args) => { calls.push(args); return { status: "completed", output: null }; });
  await act(async () => { view.host.querySelector("button")!.click(); await flushTasks(3); });
  expect(calls).toEqual([["demo.audit", "inspect", null, [ref]]]);
  await view.unmount();
});

test("refuses more than sixteen focused refs without truncating them", async () => {
  let calls = 0;
  const resources = Array.from({ length: 17 }, (_, index) => ({ kind: "character", id: `card-${index}` }));
  const view = await mount(resources, async () => { calls++; return { status: "completed", output: null }; });
  expect(view.host.textContent).toContain("Choose at most 16 pieces");
  expect((view.host.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toBe(0);
  await view.unmount();
});

test("windows hundreds of registered commands and reaches a later command by scrolling", async () => {
  const extensions = Array.from({ length: 8 }, (_, extensionIndex): InstalledExtensionSummary => {
    const contributions = Array.from({ length: 64 }, (__, commandIndex) => ({ type: "command" as const, id: `command-${commandIndex}`, label: `Command ${commandIndex}`, operation: "demo.inspect" }));
    return { ...extension, id: `demo.audit${extensionIndex}`, name: `Audit ${extensionIndex}`, contributions, registeredCommands: contributions.map(({ id }) => id) };
  });
  const calls: unknown[][] = [];
  const view = await mount([], async (...args) => { calls.push(args); return { status: "completed", output: null }; }, extensions);
  expectWindowed(view.host, "[data-index]", 512, 60);
  expect(view.host.querySelector('[data-pick="demo.audit7:command-63"]')).toBeNull();
  const scroller = view.host.querySelector<HTMLElement>("[aria-label='Registered extension commands']")!;
  await scrollToEnd(scroller, 20_000);
  const last = view.host.querySelector<HTMLElement>('[data-pick="demo.audit7:command-63"]')!;
  expect(last.textContent).toBe("Audit 7: Command 63");
  await act(async () => { last.querySelector("button")!.click(); await flushTasks(3); });
  expect(calls).toEqual([["demo.audit7", "command-63", null, []]]);
  await view.unmount();
});
