/** Purpose: ensure selected resources travel as separate host context and over-limit selections are not truncated. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import type { InstalledExtensionSummary } from "../../extensions/runtime/service-api";
import { HostCommandMenu, type HostCommandMenuProps } from "./host-command-menu";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/" }); dom = installed.dom; });
afterAll(() => installed.teardown());

const extension: InstalledExtensionSummary = {
  id: "demo.audit", hostTrusted: true, revision: 1, digest: "a".repeat(64), name: "Audit", version: "1", description: "", enabled: true, recoveryRequired: false,
  grants: [], requirements: [], contributions: [{ type: "command", id: "inspect", label: "Inspect", operation: "demo.inspect" }], settings: undefined,
  theme: null, themeScopes: [], eventSubscriptions: [], dataKeys: [], dataBytes: 0, registeredCommands: ["inspect"], promptFailures: [], suspendedPromptIds: [], activity: [],
};

async function mount(resources: readonly { kind: string; id: string }[], onActivate: HostCommandMenuProps["onActivate"]) {
  const [{ flushSync }, { createRoot }] = await Promise.all([import("react-dom"), import("react-dom/client")]);
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<HostCommandMenu api={{ list: async () => [extension] }} resources={resources} onActivate={onActivate} />));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { host, root, flushSync };
}

test("passes focused refs separately from guest input for a registered command", async () => {
  const calls: unknown[][] = [];
  const ref = { kind: "character", id: "vera" };
  const view = await mount([ref], async (...args) => { calls.push(args); return { status: "completed", output: null }; });
  view.flushSync(() => view.host.querySelector("button")!.click());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual([["demo.audit", "inspect", null, [ref]]]);
  view.flushSync(() => view.root.unmount()); view.host.remove();
});

test("refuses more than sixteen focused refs without truncating them", async () => {
  let calls = 0;
  const resources = Array.from({ length: 17 }, (_, index) => ({ kind: "character", id: `card-${index}` }));
  const view = await mount(resources, async () => { calls++; return { status: "completed", output: null }; });
  expect(view.host.textContent).toContain("Choose at most 16 pieces");
  expect((view.host.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  expect(calls).toBe(0);
  view.flushSync(() => view.root.unmount()); view.host.remove();
});
