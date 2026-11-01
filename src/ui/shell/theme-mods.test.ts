/** The shell side of the optional powers: what the lifecycle serves is what the renderer accepts, and nothing else. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { installThemeFixture, unifiedThemeService } from "../../extensions/theme-test-fixture";
import { modThemePackage } from "../../extensions/theme-mod-fixture";
import { PROTECTED_SCOPE } from "../../extensions/theme-css";
import { paintTheme, readEffectiveTheme } from "./theme";
import { checkProtectedNow, clearModSuppression, MOD_STYLE_ID, paintMod, removeMod, setModHandlers, setModProbe, SLOT_ATTRIBUTE } from "./theme-mod";

let installed: InstalledDom;
const services: Awaited<ReturnType<typeof unifiedThemeService>>[] = [];
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8324/", pretendToBeVisual: true, extraGlobals: ["localStorage", "location", "MutationObserver", "Element"], boundGlobals: ["requestAnimationFrame", "getComputedStyle"] }); });
afterAll(async () => { removeMod(); await Promise.all(services.map((service) => service.close())); await installed.teardown(); }); // removeMod stops the watcher timer a painted mod starts
beforeEach(() => installed.reinstall());

const ID = "bunzai.theme.modtest";
async function installed_() {
  const themes = await unifiedThemeService();
  services.push(themes);
  await installThemeFixture(themes, await modThemePackage());
  return themes;
}

describe("effective response with every power", () => {
  test("round-trips: inspect, install, effective, then the renderer's reader keeps styles, fonts and slots", async () => {
    const themes = await installed_();
    const served = await themes.themeEffective(ID);
    expect(served.grantedScopes).toEqual(expect.arrayContaining(["appearance.styles", "appearance.fonts", "ui.slots", "appearance.assets"]));
    const read = readEffectiveTheme(JSON.parse(JSON.stringify(served)));
    expect(read).not.toBeNull();
    expect(read!.styles).toBe(served.styles);
    expect(read!.fonts.map((f) => f.id)).toEqual(["face"]);
    expect(Object.keys(read!.slots)).toEqual(expect.arrayContaining(["shell.nav.end", "library.header"]));
  });

  test("the renderer refuses a response whose scopes, styles or slots do not match what was granted", async () => {
    const served = JSON.parse(JSON.stringify(await (await installed_()).themeEffective(ID)));
    const without = (scope: string) => ({ ...served, grantedScopes: served.grantedScopes.filter((s: string) => s !== scope) });
    for (const scope of ["appearance.styles", "appearance.fonts", "ui.slots", "appearance.assets"]) expect(readEffectiveTheme(without(scope)), scope).toBeNull();
    expect(readEffectiveTheme({ ...served, styles: served.styles + "\n@import 'https://evil.example/x.css';" })).toBeNull();
    expect(readEffectiveTheme({ ...served, styles: served.styles + "\n.host-protected{display:none}" })).toBeNull();
    expect(readEffectiveTheme({ ...served, slots: { "library.header": [{ kind: "text", text: "x", class: "gate-card" }] } })).toBeNull();
    expect(readEffectiveTheme({ ...served, fonts: [{ ...served.fonts[0], url: "https://evil.example/f.woff2" }] })).toBeNull();
    expect(readEffectiveTheme({ ...served, fonts: [{ ...served.fonts[0], mediaType: "image/png" }] })).toBeNull();
    expect(readEffectiveTheme({ ...served, extra: 1 })).toBeNull();
  });
});

describe("applying styles and slots", () => {
  const served = async (themes: Awaited<ReturnType<typeof unifiedThemeService>>) => readEffectiveTheme(JSON.parse(JSON.stringify(await themes.themeEffective(ID))))!;
  const CLEAN = { display: "block", visibility: "visible", opacity: "1", filter: "none", clipPath: "none", maskImage: "none", mixBlendMode: "normal", pointerEvents: "auto", position: "static", content: "none", width: "10px", height: "10px", fontSize: "16px" };
  beforeEach(() => { removeMod(); clearModSuppression(); setModProbe(null); setModHandlers(null); document.head.innerHTML = ""; });

  test("injects one unlayered style last in the head, scoped off the protected layer, and writes the slot payload", async () => {
    document.head.innerHTML = "<style id='host'></style>";
    paintTheme(await served(await installed_()), undefined, { badge: "blob:badge", face: "blob:face" });
    const style = document.getElementById(MOD_STYLE_ID)!;
    expect(document.head.lastElementChild).toBe(style);
    expect(style.textContent).toContain(PROTECTED_SCOPE);
    expect(style.textContent).toContain('url("blob:face")');
    expect(style.textContent).not.toContain("asset:");
    expect(style.textContent).not.toContain("@layer");
    const payload = JSON.parse(document.documentElement.getAttribute(SLOT_ATTRIBUTE)!);
    expect(payload.assets.badge).toBe("blob:badge");
    expect(payload.classes).toContain("mod-stamp-note");
    expect(Object.keys(payload.slots)).toEqual(expect.arrayContaining(["shell.nav.end", "library.header"]));
  });

  test("an unchanged serialized appearance preserves the stylesheet node", async () => {
    const theme = await served(await installed_());
    paintTheme(theme);
    const style = document.getElementById(MOD_STYLE_ID);
    paintTheme(JSON.parse(JSON.stringify(theme)));
    expect(document.getElementById(MOD_STYLE_ID) === style).toBe(true);
  });

  test("changed resources and digests still update the mounted stylesheet", async () => {
    const theme = await served(await installed_());
    paintTheme(theme, undefined, { face: "blob:first" });
    const first = document.getElementById(MOD_STYLE_ID);
    paintTheme(theme, undefined, { face: "blob:second" });
    expect(document.getElementById(MOD_STYLE_ID) === first).toBe(false);
    expect(document.getElementById(MOD_STYLE_ID)?.textContent).toContain('url("blob:second")');
    const second = document.getElementById(MOD_STYLE_ID);
    paintMod({ ...theme, digest: "b".repeat(64) }, { face: "blob:second" });
    expect(document.getElementById(MOD_STYLE_ID) === second).toBe(false);
  });

  test("revoking the theme on the host removes its styles and slots from the page on the next effective read", async () => {
    const themes = await installed_();
    paintTheme(await served(themes));
    expect(document.getElementById(MOD_STYLE_ID)).not.toBeNull();
    const current = (await themes.list()).find((item) => item.id === ID)!;
    await themes.revoke(ID, current.revision);
    const after = readEffectiveTheme(JSON.parse(JSON.stringify(await themes.themeEffective(ID))));
    expect(after).toMatchObject({ themeId: null, styles: null, fallbackReason: "revoked" });
    paintTheme(after!);
    expect(document.getElementById(MOD_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute(SLOT_ATTRIBUTE)).toBe(false);
  });

  test("a mod that hides a protected surface is dropped at once, reported, and not reapplied for the same digest", async () => {
    const theme = await served(await installed_());
    const gate = document.createElement("div");
    setModProbe({
      surfaces: () => [gate], all: () => [], parent: () => null, contains: () => true, box: () => ({ left: 0, top: 0, width: 400, height: 300 }), visibleBox: () => ({ left: 0, top: 0, width: 400, height: 300 }), hit: () => gate, topLayer: () => false, viewport: () => ({ width: 1000, height: 800 }),
      style: () => ({ ...CLEAN, opacity: (document.getElementById(MOD_STYLE_ID) as HTMLStyleElement | null)?.disabled === false ? "0" : "1" }),
    });
    const broken: unknown[] = [];
    setModHandlers({ broken: (info) => broken.push(info), healthy: () => undefined });
    paintTheme(theme);
    expect(checkProtectedNow()).toBe(true);
    expect(document.getElementById(MOD_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute(SLOT_ATTRIBUTE)).toBe(false);
    expect(broken).toEqual([{ themeId: ID, digest: theme.digest, reasons: ["opacity"] }]);
    paintTheme(theme);
    expect(document.getElementById(MOD_STYLE_ID)).toBeNull();
    paintMod({ ...theme, digest: "b".repeat(64) });
    expect(document.getElementById(MOD_STYLE_ID)).not.toBeNull();
  });

  test("a host-caused failure, present with the mod off too, leaves the mod alone", async () => {
    const gate = document.createElement("div");
    setModProbe({
      surfaces: () => [gate], all: () => [], parent: () => null, contains: () => true, box: () => ({ left: 0, top: 0, width: 400, height: 300 }), visibleBox: () => ({ left: 0, top: 0, width: 400, height: 300 }), hit: () => gate, topLayer: () => false, viewport: () => ({ width: 1000, height: 800 }),
      style: () => ({ ...CLEAN, opacity: "0" }),
    });
    paintTheme(await served(await installed_()));
    expect(checkProtectedNow()).toBe(false);
    expect(document.getElementById(MOD_STYLE_ID)).not.toBeNull();
  });
});
