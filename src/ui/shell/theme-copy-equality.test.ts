/**
 * A third-party copy of a built-in manifest, under a new id, must paint the same root as the built-in: every
 * custom property, surface pick and slot attribute, and the same mod stylesheet. Built-in themes get no power an
 * extension lacks (host CSS keyed on a theme id would show up as a difference here once it reads attributes).
 * Host CSS cannot be computed in the unit DOM, so scan:theme-keys proves the other half: no selector names an id.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { COLOUR_ONLY_THEMES } from "../../extensions/theme-difference";
import { exampleThemeInventory, themeInventory } from "../../extensions/theme-inventory";
import { installThemeFixture, unifiedThemeService } from "../../extensions/theme-test-fixture";
import type { ThemePackageInput } from "../../extensions/theme-contract";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { MOD_STYLE_ID, removeMod } from "./theme-mod";
import { CORE_THEME_APPEARANCE, paintTheme, readEffectiveTheme } from "./theme";

let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8324/", pretendToBeVisual: true, extraGlobals: ["localStorage", "location", "MutationObserver"], boundGlobals: ["requestAnimationFrame", "getComputedStyle"] }); });
afterAll(async () => { removeMod(); await installed.teardown(); }); // removeMod stops the watcher timer a painted mod starts
beforeEach(() => installed.reinstall());

const inputs = [...(await themeInventory()), ...(await exampleThemeInventory())];
type Pkg = { manifest: { id: string; name: string }; assets: Record<string, unknown> };
const idPattern = (id: string): RegExp => new RegExp("(?<![a-z-])" + id.replace(/[.]/g, "[.]") + "(?![a-z-])", "g");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The root as a theme leaves it: attributes (minus the id plumbing), inline custom properties, the mod stylesheet. */
function paintedRoot(effective: unknown, id: string): { attrs: Record<string, string>; props: Record<string, string>; mod: string } {
  paintTheme(readEffectiveTheme(effective)!, "#12a05f");
  const root = document.documentElement;
  const attrs: Record<string, string> = {};
  for (const name of root.getAttributeNames()) if (name !== "data-theme" && name !== "style") attrs[name] = (root.getAttribute(name) ?? "").replace(idPattern(id), "<id>").replace(/digest=[a-f0-9]{64}/g, "digest=<d>");
  const props: Record<string, string> = {};
  for (let i = 0; i < root.style.length; i++) { const n = root.style.item(i); props[n] = root.style.getPropertyValue(n); }
  return { attrs, props, mod: (document.getElementById(MOD_STYLE_ID)?.textContent ?? "").replace(idPattern(id), "<id>").replace(/digest=[a-f0-9]{64}/g, "digest=<d>") };
}

for (const input of inputs) {
  const original = input as unknown as Pkg;
  const sourceId = original.manifest.id;
  test(`${sourceId}: a copy under a new id paints an identical root`, async () => {
    const themes = await unifiedThemeService(true);
    try {
    const copy = clone(input) as unknown as ThemePackageInput;
    const copyManifest = copy.manifest as { id: string; name: string };
    const copyId = "bunzai.theme.copy-of-" + sourceId.replace(/^bunzai\.theme\./, "");
    copyManifest.id = copyId;
    copyManifest.name = "Copy of " + original.manifest.name;
    if (sourceId.startsWith("bunzai.theme.")) await installThemeFixture(themes, input);
    await installThemeFixture(themes, copy);

    const builtin = await themes.themeEffective(sourceId);
    const clone3p = await themes.themeEffective(copyId);
    expect(clone3p.themeId).toBe(copyId);
    expect(builtin.themeId).toBe(sourceId);
    // an identity theme picks variants on most surfaces; the colour-only default picks none and must still copy exactly
    if (!COLOUR_ONLY_THEMES.includes(sourceId)) expect(Object.keys(builtin.appearance?.surfaces ?? {}).length).toBeGreaterThan(20);
    else expect(Object.keys(builtin.appearance?.palette.surface ?? {}).length).toBeGreaterThan(0);
    const a = paintedRoot(builtin, sourceId);
    document.documentElement.removeAttribute("style");
    const b = paintedRoot(clone3p, copyId);
    paintTheme(CORE_THEME_APPEARANCE);
    expect(b).toEqual(a);
    } finally { await themes.close(); }
  });
}
