/** Foreground verification preserves appearance; authority changes, failures and lock still clear it. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { installDom, flushTasks, type InstalledDom } from "../_shared/test-dom";
import { unifiedThemeService } from "../../extensions/theme-test-fixture";
import { parseSettings } from "../../studio/settings-shape";
import { LIBRARY_LOCKED_EVENT } from "../_shared/api-fetch";
import { BROWSER_THEME_REVISION_EVENT } from "../../browser-mode";
import { useShellStore } from "./store";
import { paintTheme, CORE_THEME_APPEARANCE } from "./theme";
import { removeMod } from "./theme-mod";
import { useThemeChangeStream } from "./use-theme-events";

const themes = await unifiedThemeService(true);
const effective = await themes.themeEffective("theater");
const original = useShellStore.getState(), originalFetch = globalThis.fetch;
let installed: InstalledDom, root: Root, revision: unknown, pending: boolean;
let finish: ((value: Response) => void) | null, reads: number, cleared: number;
let unsubscribe: () => void;
beforeAll(() => { installed = installDom('<html><head><meta name="vaude-session" content="test"></head><body></body></html>', {
  url: "http://127.0.0.1:8324/", pretendToBeVisual: true,
  extraGlobals: ["location", "MutationObserver", "Event", "CustomEvent"],
  boundGlobals: ["requestAnimationFrame"], globals: { IS_REACT_ACT_ENVIRONMENT: true },
}); });
beforeEach(() => {
  installed.reinstall();
  document.querySelector('meta[name="bunzai-runtime"]')?.remove();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  revision = { epoch: "a".repeat(48), revision: 1 };
  pending = false; finish = null; reads = cleared = 0;
  useShellStore.setState({ settings: parseSettings({ theme: "theater" }), theme: "theater", appearance: effective, appearanceAssetUrls: {} });
  paintTheme(effective);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === "/api/themes/revision") return Response.json(revision);
    if (String(input) === "/api/themes/effective") {
      reads++;
      return pending ? new Promise<Response>((resolve) => { finish = resolve; }) : Response.json(effective);
    }
    throw new Error("unexpected appearance request");
  }) as typeof fetch;
  unsubscribe = useShellStore.subscribe((state) => { if (state.appearance.themeId === null) cleared++; });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); finish?.(Response.json(effective)); await flushTasks(); });
  unsubscribe(); removeMod(); globalThis.fetch = originalFetch; useShellStore.setState(original); document.body.replaceChildren();
});
afterAll(async () => { await installed.teardown(); await themes.close(); });
function Watch() { useThemeChangeStream(); return null; }
const mount = async () => { await act(async () => { root.render(<Watch />); await flushTasks(); }); };
const focus = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); await flushTasks(); }); };

test("the initial revision check does not clear an already verified boot appearance", async () => {
  await mount();
  expect(reads).toBe(1);
  expect(cleared).toBe(0);
  expect(document.documentElement.dataset.theme).toBe("theater");
});

test("focus keeps the verified appearance while its effective read is delayed", async () => {
  await mount(); cleared = 0; pending = true;
  await focus();
  expect(finish).not.toBeNull();
  expect(cleared).toBe(0);
  expect(document.documentElement.dataset.theme).toBe("theater");
});

test("returning from a hidden tab with the same revision does not clear the theme", async () => {
  await mount(); cleared = 0;
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange")); await flushTasks();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); await flushTasks();
  });
  expect(cleared).toBe(0);
  expect(document.documentElement.dataset.theme).toBe("theater");
});

test("a changed lifecycle revision clears until a new effective response verifies", async () => {
  await mount(); cleared = 0; pending = true;
  revision = { epoch: "a".repeat(48), revision: 2 };
  await focus();
  expect(cleared).toBeGreaterThan(0);
  expect(document.documentElement.dataset.theme).toBe("core");
});

test("an invalid authenticated revision fails closed", async () => {
  await mount(); cleared = 0;
  revision = { epoch: "invalid", revision: 1 };
  await focus();
  expect(cleared).toBeGreaterThan(0);
  expect(document.documentElement.dataset.theme).toBe("core");
});

test("lock fences a pending foreground read so it cannot resurrect a theme", async () => {
  await mount(); pending = true; await focus();
  await act(async () => { window.dispatchEvent(new Event(LIBRARY_LOCKED_EVENT)); finish?.(Response.json(effective)); await flushTasks(); });
  expect(document.documentElement.dataset.theme).toBe("core");
  expect(useShellStore.getState().appearance).toEqual(CORE_THEME_APPEARANCE);
});

test("Pocket focus preserves appearance but its lifecycle event clears pending authorization", async () => {
  const meta = document.createElement("meta"); meta.name = "bunzai-runtime"; meta.content = "browser"; document.head.append(meta);
  await mount(); cleared = 0; pending = true; await focus();
  expect(cleared).toBe(0);
  await act(async () => {
    window.dispatchEvent(new CustomEvent(BROWSER_THEME_REVISION_EVENT, { detail: { revision: 2 } }));
    finish?.(Response.json(effective)); await flushTasks();
  });
  expect(cleared).toBeGreaterThan(0);
});
