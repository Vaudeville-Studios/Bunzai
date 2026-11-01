/** Settings writes preserve the mounted, host-verified appearance unless selection or accent changes. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { unifiedThemeService } from "../../extensions/theme-test-fixture";
import { parseSettings } from "../../studio/settings-shape";
import { useShellStore } from "./store";
import { MOD_STYLE_ID, removeMod } from "./theme-mod";

const themes = await unifiedThemeService(true);
const effective = await themes.themeEffective("theater");
const original = useShellStore.getState(), originalFetch = globalThis.fetch;
let installed: InstalledDom, writes = 0, reads = 0;
beforeAll(() => { installed = installDom('<html><head><meta name="vaude-session" content="test"></head><body></body></html>', {
  url: "http://127.0.0.1:8324/", pretendToBeVisual: true,
  extraGlobals: ["location", "MutationObserver"], boundGlobals: ["requestAnimationFrame"],
}); });
beforeEach(async () => {
  installed.reinstall();
  useShellStore.setState({ settings: parseSettings({ theme: "theater" }), theme: "theater" });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH" || init?.method === "POST") {
      writes++;
      return Response.json(useShellStore.getState().settings);
    }
    reads++;
    return Response.json(effective);
  }) as typeof fetch;
  useShellStore.getState().invalidateAppearance();
  await useShellStore.getState().refreshAppearance();
  writes = reads = 0;
});
afterEach(() => { removeMod(); globalThis.fetch = originalFetch; useShellStore.setState(original); });
afterAll(async () => { await installed.teardown(); await themes.close(); });

test("unrelated optimistic PATCH and its acknowledgement leave appearance DOM untouched", async () => {
  const style = document.getElementById(MOD_STYLE_ID);
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  useShellStore.getState().patchSettings({ dockSlim: true });
  const optimistic = observer.takeRecords();
  for (let i = 0; i < 10 && writes === 0; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const acknowledged = observer.takeRecords();
  observer.disconnect();
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  expect(document.getElementById(MOD_STYLE_ID) === style).toBe(true);
  expect(optimistic.length + acknowledged.length).toBe(0);
});

test("a full settings save also skips an unrelated effective appearance read", async () => {
  const style = document.getElementById(MOD_STYLE_ID);
  await useShellStore.getState().saveSettings(parseSettings({ ...useShellStore.getState().settings, dockSlim: true }));
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  expect(document.getElementById(MOD_STYLE_ID) === style).toBe(true);
});

test("an accent update changes tokens without remounting the theme", () => {
  const style = document.getElementById(MOD_STYLE_ID);
  const prior = document.documentElement.style.getPropertyValue("--bk-role-brand");
  useShellStore.getState().applySettings(parseSettings({ ...useShellStore.getState().settings, houseAccent: "#12a05f" }));
  expect(document.documentElement.style.getPropertyValue("--bk-role-brand")).not.toBe(prior);
  expect(document.getElementById(MOD_STYLE_ID) === style).toBe(true);
});

test("selection changes still remove the previously verified package immediately", () => {
  useShellStore.getState().applySettings(parseSettings({ theme: "paper" }));
  expect(useShellStore.getState().appearance.themeId).toBeNull();
  expect(document.documentElement.dataset.theme).toBe("core");
  expect(document.getElementById(MOD_STYLE_ID)).toBeNull();
});
