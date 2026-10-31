/** Paint only the verified effective theme descriptor; the core fallback is not a package. */
import { isSha256Hex } from "../../core/sha256";
import { isRecord } from "../../core/guards";
import { deriveThemeScopes, parseAppearance, THEME_SCOPES } from "../../extensions/theme-appearance";
import { parseSlots, slotItemCount } from "../../extensions/slot-registry";
import { checkThemeCss } from "../../extensions/theme-css";
import type { EffectiveThemeAppearance } from "../../extensions/theme-contract";
import { surfaceAttribute, SURFACES, type SurfaceId } from "../../extensions/surface-registry";
import { installControlsStyle } from "../_shared/controls-style";
import { DEFAULT_STUDIO_THEME, isStudioTheme, studioThemePackageId, type StudioTheme } from "../../studio/settings-shape";
import { relativeLuminance } from "../_shared/color-math";
import { paintMod } from "./theme-mod";
import { FLOOR_PROPS, floorsFromStyle, houseAccentProperties, THEME_PROPERTY_NAMES, themeProperties } from "./theme-tokens";

export const CORE_THEME_APPEARANCE: EffectiveThemeAppearance = {
  themeId: null,
  packageId: null,
  digest: null,
  grantedScopes: [],
  appearance: null,
  assets: [],
  fonts: [],
  styles: null,
  slots: {},
};
const allowedKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

/** One list of asset or font references: ids unique across both, urls only the digest route of this package. */
function validRefs(list: unknown[], media: readonly string[], value: Record<string, unknown>, ids: Set<string>): boolean {
  return list.every((asset) => {
    if (!isRecord(asset) || !allowedKeys(asset, ["id", "url", "digest", "mediaType"]) || typeof asset.id !== "string" || !/^[a-z0-9-]+$/.test(asset.id) || ids.has(asset.id) || !isSha256Hex(asset.digest) || typeof asset.url !== "string" || typeof asset.mediaType !== "string" || !media.includes(asset.mediaType)) return false;
    ids.add(asset.id);
    try {
      const url = new URL(asset.url, location.origin);
      return url.origin === location.origin && url.pathname === `/api/themes/assets/${encodeURIComponent(value.packageId as string)}/${encodeURIComponent(asset.id)}` && url.searchParams.size === 1 && url.searchParams.get("digest") === value.digest;
    } catch { return false; }
  });
}

/** Validate the response shape at the renderer boundary; unknown theme parts never reach DOM state. */
export function readEffectiveTheme(value: unknown): EffectiveThemeAppearance | null {
  if (!isRecord(value) || !allowedKeys(value, ["themeId", "packageId", "digest", "grantedScopes", "appearance", "assets", "fonts", "styles", "slots", "fallbackReason", "name"]) || !(value.themeId === null || isStudioTheme(value.themeId))) return null;
  if (!(value.packageId === null || typeof value.packageId === "string") || !(value.digest === null || isSha256Hex(value.digest))) return null;
  if (!Array.isArray(value.grantedScopes) || value.grantedScopes.length > THEME_SCOPES.length || !Array.isArray(value.assets) || value.assets.length > 24 || !Array.isArray(value.fonts) || value.fonts.length > 4) return null;
  if (!(value.styles === null || typeof value.styles === "string") || !isRecord(value.slots)) return null;
  const ids = new Set<string>();
  if (!validRefs(value.assets, ["image/svg+xml", "image/png", "image/webp"], value, ids) || !validRefs(value.fonts, ["font/woff2"], value, new Set(ids))) return null;
  const imageIds = new Set(ids);
  const fontIds = new Set((value.fonts as { id: string }[]).map((f) => f.id));
  if (value.themeId === null) {
    if (value.name !== undefined || value.grantedScopes.length !== 0 || value.packageId !== null || value.digest !== null || value.appearance !== null || value.assets.length !== 0 || value.fonts.length !== 0 || value.styles !== null || Object.keys(value.slots).length !== 0 || (value.fallbackReason !== undefined && !["not-installed", "disabled", "revoked", "invalid-state"].includes(String(value.fallbackReason)))) return null;
    return value as unknown as EffectiveThemeAppearance;
  }
  if (value.fallbackReason !== undefined || value.packageId !== studioThemePackageId(value.themeId) || value.digest === null) return null;
  if (value.name !== undefined && (typeof value.name !== "string" || value.name.length === 0 || value.name.length > 80)) return null;
  try {
    const classes = value.styles === null ? new Set<string>() : checkThemeCss(value.styles, { images: imageIds, fonts: fontIds }).classes;
    const slots = parseSlots(value.slots, imageIds, classes);
    const expectedScopes = deriveThemeScopes({ assets: value.assets.length, fonts: value.fonts.length, styles: value.styles !== null, slots: slotItemCount(slots) });
    if (new Set(value.grantedScopes).size !== value.grantedScopes.length || expectedScopes.length !== value.grantedScopes.length || [...value.grantedScopes].sort().some((scope, i) => scope !== expectedScopes[i])) return null;
    return { ...value, slots, appearance: parseAppearance(value.appearance, imageIds) } as unknown as EffectiveThemeAppearance;
  } catch { return null; }
}

/**
 * Write the theme's validated tokens and surface picks to the root; anything invalid paints the core appearance.
 * The user's accent follows into core too, held to the tokens.css palette read back from the cleared root.
 */
export function paintTheme(appearance: EffectiveThemeAppearance, houseAccent?: string, assetUrls: Record<string, string> = {}): void {
  const checked = readEffectiveTheme(appearance) ?? CORE_THEME_APPEARANCE;
  const root = document.documentElement;
  installControlsStyle();
  const themeId = checked.themeId ?? "core";
  if (root.dataset.theme !== themeId) root.dataset.theme = themeId;
  const chrome = checked.appearance?.shape.chrome ?? "bunzai";
  if (root.dataset.chrome !== chrome) root.dataset.chrome = chrome;
  const scheme = hostScheme(checked);
  if (root.dataset.hostScheme !== scheme) root.dataset.hostScheme = scheme;
  const props = checked.appearance ? themeProperties(checked.appearance, houseAccent) : {};
  const view = root.ownerDocument?.defaultView;
  if (!checked.appearance && houseAccent && view) {
    paintMod(checked, assetUrls);
    for (const name of FLOOR_PROPS) if (root.style.getPropertyValue(name)) root.style.removeProperty(name);
    const floors = floorsFromStyle(view.getComputedStyle(root));
    if (floors) Object.assign(props, houseAccentProperties(houseAccent, floors));
  }
  for (const name of THEME_PROPERTY_NAMES) {
    const value = props[name] ?? "";
    if (root.style.getPropertyValue(name) === value) continue;
    if (value) root.style.setProperty(name, value); else root.style.removeProperty(name);
  }
  const surfaces = checked.appearance?.surfaces ?? {};
  for (const id of Object.keys(SURFACES) as SurfaceId[]) {
    const variant = surfaces[id];
    const attribute = surfaceAttribute(id);
    if (root.getAttribute(attribute) === (variant ?? null)) continue;
    if (variant) root.setAttribute(attribute, variant); else root.removeAttribute(attribute);
  }
  paintMod(checked, assetUrls);
}

/**
 * Which of the host's two palettes the protected surfaces wear (tokens.css): light when the theme's base surface is
 * light, so a permission panel is not a dark island in a light theme. 0.179 is the luminance where black text and
 * white text read equally well on a surface. Core paints the dark fallback palette, so it keeps the dark one.
 */
function hostScheme(checked: EffectiveThemeAppearance): "light" | "dark" {
  const base = checked.appearance?.palette.surface.base;
  return base && relativeLuminance(base) > 0.179 ? "light" : "dark";
}

/** The requested setting remains user intent; effective package authorization is resolved separately. */
export const initialTheme = (value?: unknown): StudioTheme => isStudioTheme(value) ? value : DEFAULT_STUDIO_THEME;
