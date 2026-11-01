/** Theme response validation and painting never trust cached user data as entitlement. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { surfaceVariant } from "../_shared/surface-variant";
import { deriveThemeScopes } from "../../extensions/theme-appearance";
import { inspectThemePackage } from "../../extensions/theme-contract";
import { exampleThemeInventory, themeInventory } from "../../extensions/theme-inventory";
import { contrastRatio, hexToHsv } from "../_shared/color-math";
import { CORE_THEME_APPEARANCE, initialTheme, paintTheme, readEffectiveTheme } from "./theme";
import { removeMod } from "./theme-mod";
import { effectiveThemeLabel } from "./status-bar-label";
import { DEFAULT_STUDIO_THEME } from "../../studio/settings-shape";
import { STUDIO_THEMES, studioThemePackageId } from "../../studio/settings-shape";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createExtensionService } from "../../extensions/runtime/service";
import { adaptBundledThemePackage } from "../../extensions/contracts/package-validation";
import { THEME_PROPERTY_NAMES } from "./theme-tokens";

let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8324/", extraGlobals: ["localStorage", "location"] }); });
afterAll(async () => { removeMod(); await installed.teardown(); }); // removeMod stops the watcher timer a painted mod starts
beforeEach(() => { installed.reinstall(); const html = document.documentElement; html.removeAttribute("style"); for (const a of [...html.attributes]) if (a.name.startsWith("data-")) html.removeAttribute(a.name); });

const inputs = [...(await themeInventory()), ...(await exampleThemeInventory())];
const previews = Object.fromEntries(await Promise.all(inputs.map(async (i) => {
  const id = (i.manifest as { id: string }).id;
  return [id, await inspectThemePackage(i, id.startsWith("bunzai.") ? undefined : id)] as const;
})));
const active = (id = "paper") => {
  const packageId = studioThemePackageId(id) ?? id;
  return {
  themeId: id, packageId, digest: "a".repeat(64), grantedScopes: deriveThemeScopes({ assets: previews[id]!.assets.length, fonts: 0, styles: false, slots: 0 }),
  appearance: JSON.parse(JSON.stringify(previews[id]!.appearance)),
  fonts: [] as unknown[], styles: null, slots: {},
  assets: previews[id]!.assets.map((a) => ({ id: a.id, digest: a.digest, mediaType: a.mediaType, url: `/api/themes/assets/${packageId}/${a.id}?digest=${"a".repeat(64)}` })) as unknown[],
};
};
const rootEl = (): HTMLElement => document.documentElement;
const prop = (name: string): string => rootEl().style.getPropertyValue(name);

test("no cache is read; absent or invalid settings take the default theme and a saved choice always wins", () => {
  expect(initialTheme()).toBe(DEFAULT_STUDIO_THEME);
  expect(initialTheme("bunzai.theme.encore")).toBe("bunzai.theme.encore");
  for (const saved of ["theater", "paper", "stage"] as const) expect(initialTheme(saved)).toBe(saved);
  expect(initialTheme("invalid")).toBe(DEFAULT_STUDIO_THEME);
  expect(localStorage.getItem("vaude.theme")).toBeNull();
});

test("all bundled appearance aliases resolve to their trusted package IDs at the renderer boundary", async () => {
  const inventory = await themeInventory();
  const builtins = await Promise.all(inventory.map((theme) => adaptBundledThemePackage(theme, (theme.manifest as { id: string }).id)));
  let sequence = 0;
  const service = createExtensionService({ store: memoryExtensionStore(() => 1), storeId: "renderer-builtins", host: "terminal", operations: [], builtinPackages: builtins,
    now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    for (const alias of STUDIO_THEMES) {
      const effective = await service.themeEffective(alias);
      const read = readEffectiveTheme(JSON.parse(JSON.stringify(effective)));
      expect(read, alias).not.toBeNull();
      expect(read!.themeId).toBe(alias);
      expect(read!.packageId).toBe(studioThemePackageId(alias));
      for (const asset of [...read!.assets, ...read!.fonts]) expect(new URL(asset.url, location.origin).pathname).toContain(encodeURIComponent(read!.packageId!));
    }
  } finally { await service.close(); }
});

test("the status label follows the verified appearance rather than the old setting shape", () => {
  expect(effectiveThemeLabel(CORE_THEME_APPEARANCE)).toBe("Core");
  expect(effectiveThemeLabel({ themeId: "paper", name: "Paper" })).toBe("Paper");
  expect(effectiveThemeLabel({ themeId: "stage", name: "GirliePop" })).toBe("GirliePop");
  expect(effectiveThemeLabel({ themeId: "theater", name: "Theater" })).toBe("Theater");
  expect(effectiveThemeLabel({ themeId: "bunzai.theme.neon-pop", name: "Neon Pop Deluxe" })).toBe("Neon Pop Deluxe");
  expect(effectiveThemeLabel({ themeId: "bunzai.theme.encore" })).toBe("Encore");
  expect(effectiveThemeLabel({ themeId: "bunzai.theme.neon-pop" })).toBe("Neon Pop");
});

test("the renderer accepts bounded package IDs and refuses a tampered appearance or remote asset URLs", () => {
  expect(readEffectiveTheme(active("bunzai.theme.encore"))?.themeId).toBe("bunzai.theme.encore");
  expect(readEffectiveTheme({ ...active(), name: "Paper" })?.name).toBe("Paper");
  expect(readEffectiveTheme({ ...active(), name: "x".repeat(81) })).toBeNull();
  expect(readEffectiveTheme({ ...CORE_THEME_APPEARANCE, name: "Paper" })).toBeNull();
  expect(readEffectiveTheme({ ...active(), appearance: {} })).toBeNull();
  expect(readEffectiveTheme({ ...active(), appearance: null })).toBeNull();
  const lowContrast = active();
  lowContrast.appearance.palette.text.text = "#777777";
  expect(readEffectiveTheme(lowContrast)).toBeNull();
  const unknownVariant = active();
  unknownVariant.appearance.surfaces["shell.nav"] = "raw-css";
  expect(readEffectiveTheme(unknownVariant)).toBeNull();
  const extra = active();
  extra.appearance.shape.radius = 8;
  expect(readEffectiveTheme(extra)).toBeNull();
  expect(readEffectiveTheme({ ...active(), assets: [{ id: "x", digest: "a".repeat(64), url: "https://elsewhere/x.svg" }] })).toBeNull();
  expect(readEffectiveTheme({ ...active(), assets: [{ id: "x", digest: "a".repeat(64), url: "/secret" }] })).toBeNull();
  const asset = { id: "x", digest: "b".repeat(64), mediaType: "image/svg+xml", url: `/api/themes/assets/${studioThemePackageId("paper")}/x?digest=${"a".repeat(64)}` };
  const marked = active();
  marked.appearance.marks.dock = "x";
  expect(readEffectiveTheme({ ...marked, grantedScopes: deriveThemeScopes({ assets: 1, fonts: 0, styles: false, slots: 0 }), assets: [asset] })).not.toBeNull();
  expect(readEffectiveTheme({ ...marked, grantedScopes: deriveThemeScopes({ assets: 1, fonts: 0, styles: false, slots: 0 }), assets: [] })).toBeNull();
  expect(readEffectiveTheme({ ...active(), grantedScopes: ["appearance.palette"] })).toBeNull();
  expect(readEffectiveTheme({ ...active(), grantedScopes: deriveThemeScopes({ assets: 1, fonts: 0, styles: false, slots: 0 }), assets: [{ ...asset, url: `/api/themes/assets/other/x?digest=${"a".repeat(64)}` }] })).toBeNull();
});

test("painting writes the validated palette, shape and surface picks, and the core appearance removes every one", () => {
  paintTheme(readEffectiveTheme(active("paper"))!);
  expect(rootEl().dataset.theme).toBe("paper");
  expect(prop("--bk-surface-base")).toBe(previews.paper!.appearance.palette.surface.base);
  expect(prop("--bk-role-danger-deep")).toBe(previews.paper!.appearance.palette.roles.danger.deep);
  expect(prop("--bk-frame-w")).toBe("1px");
  expect(prop("--bk-density")).toBe("1.3");
  expect(prop("--bk-dur-base")).toBe("0ms");
  expect(rootEl().getAttribute("data-surface-shell-nav")).toBe("index-rail");
  expect(rootEl().getAttribute("data-surface-scene-message")).toBe("screenplay");
  expect(surfaceVariant("shell.nav")).toBe("index-rail");
  paintTheme(readEffectiveTheme(active("stage"))!);
  expect(prop("--bk-frame-w")).toBe("3px");
  expect(rootEl().getAttribute("data-surface-shell-nav")).toBe("tab-bar");
  paintTheme(CORE_THEME_APPEARANCE);
  expect(rootEl().dataset.theme).toBe("core");
  for (const name of THEME_PROPERTY_NAMES) expect(prop(name)).toBe("");
  expect(rootEl().getAttributeNames().filter((n) => n.startsWith("data-surface-"))).toEqual([]);
  expect(surfaceVariant("shell.nav")).toBe("core");
});

test("the chrome sizing paints as html[data-chrome] and the UI font role as --bk-font-ui; core and the other bundled themes stay bunzai", () => {
  paintTheme(readEffectiveTheme(active(DEFAULT_STUDIO_THEME))!);
  expect(rootEl().dataset.chrome).toBe("rolecall");
  expect(prop("--bk-font-ui")).toBe("system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
  expect(prop("--bk-font-body")).toBe(prop("--bk-font-ui"));
  expect(prop("--bk-font-mono")).toStartWith("ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas");
  expect(prop("--bk-font-display")).toBe('"Cinzel", serif');
  for (const id of ["paper", "stage", "theater", "bunzai.theme.encore"]) {
    paintTheme(readEffectiveTheme(active(id))!);
    expect(rootEl().dataset.chrome, id).toBe("bunzai");
    expect(prop("--bk-font-ui"), id).toBe(prop("--bk-font-display")); // --font-big used to resolve to the display face, so it still does
  }
  paintTheme(CORE_THEME_APPEARANCE);
  expect(rootEl().dataset.chrome).toBe("bunzai");
});

test("protected surfaces take the host's light palette under a light theme and its dark one under a dark theme or core", () => {
  paintTheme(readEffectiveTheme(active("paper"))!);
  expect(rootEl().dataset.hostScheme).toBe("light");
  paintTheme(readEffectiveTheme(active("theater"))!);
  expect(rootEl().dataset.hostScheme).toBe("dark");
  paintTheme(readEffectiveTheme(active("paper"))!);
  paintTheme(CORE_THEME_APPEARANCE);
  expect(rootEl().dataset.hostScheme).toBe("dark");
});

test("the Settings accent follows into the brand and action roles of a theme that follows the user, and never into a locked one", () => {
  const accent = "#12a05f";
  const theater = previews.theater!.appearance.palette;
  paintTheme(readEffectiveTheme(active("theater"))!, accent);
  expect(prop("--bk-role-brand")).toBe(accent);
  // Action and select are the accent's neighbours on either side of the wheel, so the chrome has a little range.
  const hue = (hex: string) => hexToHsv(hex).h;
  const turn = (from: number, to: number) => ((to - from + 540) % 360) - 180;
  expect(turn(hue(accent), hue(prop("--bk-role-action")))).toBeGreaterThan(15);
  expect(turn(hue(accent), hue(prop("--bk-role-select")))).toBeLessThan(-15);
  for (const role of ["brand", "action", "select"]) {
    expect(contrastRatio("#ffffff", prop(`--bk-role-${role}-deep`))).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["well", "base", "panel", "raised"] as const) expect(contrastRatio(prop(`--bk-role-${role}-text`), theater.surface[surface])).toBeGreaterThanOrEqual(4.5);
  }
  expect(prop("--bk-role-ok")).toBe(theater.roles.ok.fill);
  const locked = active("theater");
  locked.appearance.accent.follows = "locked";
  paintTheme(readEffectiveTheme(locked)!, accent);
  expect(prop("--bk-role-action")).toBe(theater.roles.action.fill);
  expect(prop("--bk-role-select")).toBe(theater.roles.select.fill);
  paintTheme(readEffectiveTheme(active("theater"))!, "not a color");
  expect(prop("--bk-role-action")).toBe(theater.roles.action.fill);
});

test("invalid values reset to host core and never retain an accent or a surface pick", () => {
  paintTheme(readEffectiveTheme(active())!, "#123456");
  expect(prop("--bk-role-action")).not.toBe(""); // a dark pick is lifted to clear the onTint floor, never refused
  expect(contrastRatio(prop("--bk-text-on-tint"), prop("--bk-role-action"))).toBeGreaterThanOrEqual(4.5);
  paintTheme({ ...active(), appearance: {} } as never, "#123456");
  expect(rootEl().dataset.theme).toBe("core");
  expect(prop("--bk-role-action")).toBe("");
  expect(rootEl().getAttribute("data-surface-shell-nav")).toBeNull();
  expect(CORE_THEME_APPEARANCE.appearance).toBeNull();
});

test("the painter never writes a character or persona accent on the root, whatever house accent it is given", () => {
  paintTheme(readEffectiveTheme(active("theater"))!, "#008080");
  const written = Array.from({ length: rootEl().style.length }, (_, i) => rootEl().style.item(i));
  expect(written.filter((n) => /^--bk-(character|persona)-accent/.test(n))).toEqual([]);
});

test("core, which paints no palette of its own, still takes the Settings accent, held to the tokens.css floors", () => {
  const core = document.createElement("style");
  core.textContent = ":root{--bk-surface-well:#09090a;--bk-surface-base:#111113;--bk-surface-sunken:#19191b;--bk-surface-field:#131315;--bk-surface-panel:#1b1b1e;--bk-surface-raised:#222225;--bk-line-track:#343230;--bk-text:#f3f1ee;--bk-text-on-tint:#111113;--bk-text-on-deep:#ffffff}";
  document.head.append(core);
  try {
    paintTheme(CORE_THEME_APPEARANCE, "#ec1e4b");
    expect(rootEl().dataset.theme).toBe("core");
    for (const role of ["brand", "action", "select"]) {
      expect(prop(`--bk-role-${role}`)).not.toBe("");
      expect(contrastRatio("#111113", prop(`--bk-role-${role}`))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", prop(`--bk-role-${role}-deep`))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(prop(`--bk-role-${role}-text`), "#222225")).toBeGreaterThanOrEqual(4.5);
    }
    paintTheme(CORE_THEME_APPEARANCE);
    for (const name of THEME_PROPERTY_NAMES) expect(prop(name)).toBe("");
    paintTheme(CORE_THEME_APPEARANCE, "not a color");
    expect(prop("--bk-role-brand")).toBe("");
  } finally { core.remove(); }
});

test("an identical verified appearance produces no root DOM mutations", () => {
  const appearance = readEffectiveTheme(active("theater"))!;
  paintTheme(appearance);
  const observer = new installed.dom.window.MutationObserver(() => undefined);
  observer.observe(rootEl(), { attributes: true });
  paintTheme(JSON.parse(JSON.stringify(appearance)));
  const changed = observer.takeRecords();
  observer.disconnect();
  expect(changed.length).toBe(0);
});

test("an unchanged core appearance with a house accent produces no root mutations", () => {
  const core = document.createElement("style");
  core.textContent = ":root{--bk-surface-well:#09090a;--bk-surface-base:#111113;--bk-surface-sunken:#19191b;--bk-surface-field:#131315;--bk-surface-panel:#1b1b1e;--bk-surface-raised:#222225;--bk-line-track:#343230;--bk-text:#f3f1ee;--bk-text-on-tint:#111113;--bk-text-on-deep:#ffffff}";
  document.head.append(core);
  try {
    paintTheme(CORE_THEME_APPEARANCE, "#12a05f");
    const observer = new installed.dom.window.MutationObserver(() => undefined);
    observer.observe(rootEl(), { attributes: true });
    paintTheme(CORE_THEME_APPEARANCE, "#12a05f");
    const changed = observer.takeRecords();
    observer.disconnect();
    expect(changed.length).toBe(0);
  } finally { core.remove(); }
});
