/** Additional layouts keep the chat and visited tool drafts mounted while navigating. */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { installDom, flushTasks, type InstalledDom } from "../../../_shared/test-dom";
import type { Root } from "react-dom/client";
import { AdditionalLayout } from "./additional-layout";
import type { LayoutProps } from "./layout-props";
import { useWingDismiss } from "../wing-dismiss";
import { WINGS } from "../scene-wing-data";
let dom: InstalledDom, root: Root, host: HTMLDivElement;
beforeAll(() => { dom = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", extraGlobals: ["SVGElement", "Event", "MouseEvent", "KeyboardEvent"] }); });
afterEach(async () => { const { flushSync } = await import("react-dom"); flushSync(() => root?.unmount()); host?.remove(); });
afterAll(() => dom.teardown());
const programs = [{ id: "model", wing: "ai", title: "AI Connection", icon: "lucide:cpu" }, { id: "core", wing: "core", title: "rp-core", icon: "lucide:cpu" }] as const;
async function mount(layout: LayoutProps["layout"]): Promise<void> {
  const { createRoot } = await import("react-dom/client"), { flushSync } = await import("react-dom"), { useState, useRef } = await import("react");
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  function Fixture() { const [wing, onWing] = useState<string | null>(null); const surface = useRef<HTMLDivElement>(null); useWingDismiss(wing !== null, surface, () => onWing(null)); return <div ref={surface}><AdditionalLayout layout={layout} name="Vera" chatId="test" portrait={<span>Portrait</span>} backdrop={null} actions={null} wings={WINGS} wing={wing} onWing={onWing} renderWing={(id) => <textarea aria-label={`${id} draft`} defaultValue="kept" />} programs={programs} request={null} renderProgram={(p) => <textarea aria-label={`${p.id} draft`} defaultValue="kept" />} onSurface={() => undefined} onBack={() => undefined}><textarea aria-label="Chat draft" defaultValue="unsent" /></AdditionalLayout></div>; }
  flushSync(() => root.render(<Fixture />)); await flushTasks();
}
async function click(label: string): Promise<void> {
  const { flushSync } = await import("react-dom");
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label);
  expect(Boolean(button)).toBe(true); flushSync(() => button!.dispatchEvent(new dom.dom.window.MouseEvent("pointerdown", { bubbles: true }))); flushSync(() => button!.click()); await flushTasks();
}
for (const layout of ["familiar", "basic", "immersive"] as const) test(`${layout} opens tools and retains chat and tool drafts`, async () => {
  await mount(layout); const chat = host.querySelector('[aria-label="Chat draft"]');
  if (layout === "familiar") await click("AI"); else { await click("Scene settings"); await click("AI"); }
  const draft = host.querySelector<HTMLTextAreaElement>('[aria-label="ai draft"]')!; expect(Boolean(draft)).toBe(true); draft.value = "edited";
  await click("Close scene settings");
  expect(host.querySelector('[aria-label="Chat draft"]') === chat).toBe(true);
  if (layout === "familiar") await click("AI"); else { await click("Scene settings"); await click("AI"); }
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="ai draft"]')?.value).toBe("edited");
});
test("Desktop 98 minimizes, restores and reopens a program without replacing its draft", async () => {
  await mount("desktop98"); const chat = host.querySelector('[aria-label="Chat draft"]');
  await click("AI Connection");
  const draft = host.querySelector<HTMLTextAreaElement>('[aria-label="model draft"]')!; expect(Boolean(draft)).toBe(true); draft.value = "edited";
  await click("Minimize AI Connection");
  expect(host.querySelector('[aria-label="Chat draft"]') === chat).toBe(true);
  await click("AI Connection"); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="model draft"]')?.value).toBe("edited");
  await click("Close AI Connection"); await click("AI Connection");
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="model draft"]')?.value).toBe("edited");
  await click("Maximize Vera — Bunzai Instant Messenger"); await click("Restore Vera — Bunzai Instant Messenger");
  expect(host.querySelector('[aria-label="Chat draft"]') === chat).toBe(true);
});

test("Desktop 98 reopens a closed program requested by another scene tool", async () => {
  await mount("desktop98");
  const ask = async (): Promise<void> => { const { flushSync } = await import("react-dom"); const { PROGRAM_OPEN_EVENT } = await import("../messenger/program-open"); flushSync(() => window.dispatchEvent(new dom.dom.window.CustomEvent(PROGRAM_OPEN_EVENT, { detail: { program: "model" } }))); await flushTasks(); };
  await ask(); await click("Close AI Connection"); await ask();
  expect(host.querySelector<HTMLElement>('[data-desktop-window="model"]')?.hidden).toBe(false);
});

test("Desktop 98 activates a retained portal's window when its field receives focus", async () => {
  await mount("desktop98"); await click("AI Connection"); await click("rp-core");
  const { flushSync } = await import("react-dom");
  flushSync(() => host.querySelector<HTMLTextAreaElement>('[aria-label="model draft"]')!.focus()); await flushTasks();
  expect(host.querySelector('[data-desktop-window="model"]')?.getAttribute("data-active")).toBe("true");
});

test("Familiar toggles an active rail button closed through the scene outside-press boundary", async () => {
  await mount("familiar"); await click("AI"); await click("AI");
  expect(host.querySelector('[aria-label="AI"]')?.getAttribute("aria-pressed")).toBe("false");
});
