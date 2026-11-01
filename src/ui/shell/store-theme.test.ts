/** Theme-cycle store contract: the UI toggle must request the next persisted theme. */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { DEFAULT_STUDIO_THEME, SETTING_KEYS, parseSettings, studioThemePackageId, type StudioTheme } from "../../studio/settings-shape";
import { deriveThemeScopes } from "../../extensions/theme-appearance";
import { inspectThemePackage } from "../../extensions/theme-contract";
import { themeInventory } from "../../extensions/theme-inventory";
import { useShellStore } from "./store";
import { removeMod } from "./theme-mod";

const paper = await inspectThemePackage((await themeInventory()).find((i) => (i.manifest as { id: string }).id === "paper"), "paper");

let installed: InstalledDom;
beforeAll(() => { installed = installDom(); });
afterAll(async () => { removeMod(); await installed.teardown(); }); // removeMod stops the watcher timer a painted mod starts

const original = useShellStore.getState();
afterEach(() => useShellStore.setState({
  appearance: original.appearance,
  theme: original.theme,
  settings: original.settings,
  patchSettings: original.patchSettings,
}));

test("toggleTheme requests each next theme through the settings owner", () => {
  const cases: [StudioTheme, StudioTheme][] = [
    [DEFAULT_STUDIO_THEME, "theater"],
    ["theater", "paper"],
    ["paper", "stage"],
    ["stage", DEFAULT_STUDIO_THEME],
  ];
  for (const [theme, next] of cases) {
    let requested: Record<string, unknown> | undefined;
    useShellStore.setState({
      theme,
      settings: parseSettings({ theme }),
      patchSettings(patch) { requested = patch; },
    });
    useShellStore.getState().toggleTheme();
    expect(requested).toEqual({ [SETTING_KEYS.theme]: next });
  }
});

test("a concurrent refresh waits through superseding settings writes before verifying theme selection", async () => {
  const originalFetch = globalThis.fetch;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  let releaseFirst!: (response: Response) => void;
  const firstPatch = new Promise<Response>((resolve) => { releaseFirst = resolve; });
  let settingsPatches = 0;
  let effectiveReads = 0;
  let serverTheme: StudioTheme = "theater";
  const root = { dataset: {} as Record<string, string>, style: { getPropertyValue: () => "", setProperty() {}, removeProperty() {} }, getAttribute: () => null, setAttribute() {}, removeAttribute() {} };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => ({ getAttribute: () => "test-token" }), documentElement: root } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    if (path === "/api/settings" && init?.method === "PATCH") {
      settingsPatches++;
      return settingsPatches === 1
        ? firstPatch.then((response) => { serverTheme = "paper"; return response; })
        : new Response(JSON.stringify({ setupComplete: true, theme: "paper", dockSlim: true }));
    }
    if (path === "/api/themes/effective") {
      effectiveReads++;
      return new Response(JSON.stringify({ themeId: serverTheme, packageId: studioThemePackageId(serverTheme), digest: "a".repeat(64), grantedScopes: deriveThemeScopes({ assets: 0, fonts: 0, styles: false, slots: 0 }), appearance: paper.appearance, assets: [], fonts: [], styles: null, slots: {} }));
    }
    throw new Error(`unexpected theme test request: ${path}`);
  }) as typeof fetch;
  try {
    useShellStore.getState().patchSettings({ theme: "paper" });
    const refresh = useShellStore.getState().refreshAppearance();
    useShellStore.getState().patchSettings({ dockSlim: true });
    while (settingsPatches === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst(new Response(JSON.stringify({ setupComplete: true, theme: "paper" })));
    await refresh;
    for (let i = 0; i < 20 && (effectiveReads === 0 || useShellStore.getState().appearance.themeId !== "paper"); i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settingsPatches).toBe(2);
    expect(effectiveReads).toBe(1);
    expect(useShellStore.getState().appearance.themeId).toBe("paper");
  } finally {
    globalThis.fetch = originalFetch;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
