/**
 * The v2 appearance descriptor of a theme package: surface variant picks, palette, type, shape, accent
 * and asset marks. Parsed once here, by the package inspector at install and again by the renderer on
 * every effective-theme read, so the two cannot drift. Data only: ids, enums, bounded numbers, hex.
 * A palette that misses a contrast floor is rejected at parse time, not just in a test.
 */
import { isRecord } from "../core/guards";
import { contrastRatio } from "../ui/_shared/color-math";
import { isSurfaceId, isSurfaceVariant, SURFACES, type SurfaceId, type SurfaceVariants } from "./surface-registry";

export const THEME_SCOPES = ["appearance.palette", "appearance.type", "appearance.shape", "appearance.surfaces", "appearance.accent", "appearance.assets", "appearance.styles", "appearance.fonts", "ui.slots"] as const;
export type ThemeScope = (typeof THEME_SCOPES)[number];
export const THEME_BASE_SCOPES = ["appearance.palette", "appearance.type", "appearance.shape", "appearance.surfaces", "appearance.accent"] as const satisfies readonly ThemeScope[];
/** What a package ships beyond the descriptor; each optional power derives its own scope from the fields used. */
export interface ThemeUse { assets: number; fonts: number; styles: boolean; slots: number }
/** The descriptor's fields are all required, so its scopes are always derived; assets, fonts, styles and slots only when shipped. */
export const deriveThemeScopes = (use: ThemeUse): ThemeScope[] => THEME_SCOPES.filter((scope) =>
  scope === "appearance.assets" ? use.assets > 0 : scope === "appearance.fonts" ? use.fonts > 0 : scope === "appearance.styles" ? use.styles : scope === "ui.slots" ? use.slots > 0 : true).sort();

export const SURFACE_NAMES = ["well", "base", "sunken", "field", "panel", "raised", "ink"] as const;
export const LINE_NAMES = ["strong", "line", "track", "control", "focus"] as const;
export const TEXT_NAMES = ["text", "soft", "dim", "faint", "onTint", "onDeep"] as const;
export const ROLE_NAMES = ["brand", "action", "select", "ok", "warn", "danger", "info"] as const;
export const ROLE_PARTS = ["fill", "text", "deep"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
export interface ThemePalette {
  surface: Record<(typeof SURFACE_NAMES)[number], string>;
  line: Record<(typeof LINE_NAMES)[number], string>;
  text: Record<(typeof TEXT_NAMES)[number], string>;
  roles: Record<RoleName, Record<(typeof ROLE_PARTS)[number], string>>;
}
export const FRAME_STYLES = ["rule", "double", "bracket", "slab", "stamp"] as const;
export const DENSITIES = ["dense", "comfortable", "roomy", "airy"] as const;
export const MOTIONS = ["none", "calm", "snappy", "bouncy"] as const;
export const DISPLAY_FONTS = ["archivo", "cinzel", "fraunces", "atkinson", "fredoka"] as const;
export const BODY_FONTS = ["archivo", "atkinson", "fraunces", "inter", "system-ui"] as const;
export const UI_FONTS = ["archivo", "cinzel", "fraunces", "atkinson", "fredoka", "inter", "system-ui"] as const;
export const MONO_FONTS = ["plex-mono", "courier-prime", "jetbrains-mono", "system-mono"] as const;
/** The chrome sizing a theme wears: Bunzai's square corners and 12px floor, or RoleCall's radii and small-label scale. */
export const CHROMES = ["bunzai", "rolecall"] as const;
export interface ThemeAppearance {
  surfaces: SurfaceVariants;
  palette: ThemePalette;
  type: { display: (typeof DISPLAY_FONTS)[number]; ui: (typeof UI_FONTS)[number]; body: (typeof BODY_FONTS)[number]; mono: (typeof MONO_FONTS)[number]; scale: 0 | 1 | 2 };
  shape: { frame: (typeof FRAME_STYLES)[number]; frameWidth: 1 | 2 | 3; density: (typeof DENSITIES)[number]; motion: (typeof MOTIONS)[number]; chrome: (typeof CHROMES)[number] };
  accent: { follows: "user" | "locked" };
  marks: { dock?: string; bookFrame?: string };
}

const fail = (why: string): never => { throw new Error("invalid theme package: " + why); };
const obj = (v: unknown, what: string): Record<string, unknown> => isRecord(v) ? v : fail(what + " must be an object");
const exact = (v: Record<string, unknown>, names: readonly string[], what: string): void => {
  if (Object.keys(v).some((k) => !names.includes(k)) || names.some((k) => !(k in v))) fail(what + " must have exactly " + names.join(", "));
};
const hex = (v: unknown, what: string): string => typeof v === "string" && /^#[0-9a-f]{6}$/.test(v) ? v : fail(what + " must be a lowercase #rrggbb color");
const pick = <T extends string>(v: unknown, choices: readonly T[], what: string): T =>
  typeof v === "string" && (choices as readonly string[]).includes(v) ? v as T : fail(what + " must be one of " + choices.join(", "));
function colors<K extends string>(v: unknown, names: readonly K[], what: string): Record<K, string> {
  const o = obj(v, what); exact(o, names, what);
  return Object.fromEntries(names.map((n) => [n, hex(o[n], what + "." + n)])) as Record<K, string>;
}

/** The floors every theme meets: primary text 7:1, other text 4.5:1, control boundary and focus 3:1. */
export function paletteContrastFailures(p: ThemePalette): string[] {
  const out: string[] = [];
  const need = (label: string, a: string, b: string, floor: number): void => {
    const ratio = contrastRatio(a, b);
    if (ratio < floor) out.push(`${label} ${ratio.toFixed(2)}:1 needs ${floor}:1`);
  };
  for (const s of SURFACE_NAMES.filter((n) => n !== "ink")) {
    const bg = p.surface[s];
    need(`text on ${s}`, p.text.text, bg, 7);
    for (const t of ["soft", "dim", "faint"] as const) need(`text.${t} on ${s}`, p.text[t], bg, 4.5);
    for (const r of ROLE_NAMES) need(`roles.${r}.text on ${s}`, p.roles[r].text, bg, 4.5);
    need(`line.control on ${s}`, p.line.control, bg, 3);
    need(`line.focus on ${s}`, p.line.focus, bg, 3);
  }
  need("text on ink", p.text.text, p.surface.ink, 4.5);
  need("text.dim on ink", p.text.dim, p.surface.ink, 4.5);
  for (const r of ROLE_NAMES) {
    need(`onTint on roles.${r}.fill`, p.text.onTint, p.roles[r].fill, 4.5);
    need(`onDeep on roles.${r}.deep`, p.text.onDeep, p.roles[r].deep, 4.5);
    need(`roles.${r}.text on line.track`, p.roles[r].text, p.line.track, 3);
  }
  return out;
}

export function parsePalette(v: unknown): ThemePalette {
  const o = obj(v, "palette"); exact(o, ["surface", "line", "text", "roles"], "palette");
  const roles = obj(o.roles, "palette.roles"); exact(roles, ROLE_NAMES, "palette.roles");
  const palette: ThemePalette = {
    surface: colors(o.surface, SURFACE_NAMES, "palette.surface"), line: colors(o.line, LINE_NAMES, "palette.line"), text: colors(o.text, TEXT_NAMES, "palette.text"),
    roles: Object.fromEntries(ROLE_NAMES.map((r) => [r, colors(roles[r], ROLE_PARTS, "palette.roles." + r)])) as ThemePalette["roles"],
  };
  const failures = paletteContrastFailures(palette);
  return failures.length ? fail("palette contrast: " + failures.slice(0, 4).join("; ") + (failures.length > 4 ? `; ${failures.length - 4} more` : "")) : palette;
}

/** Parse one appearance descriptor; `assetIds` are the package's declared SVG assets that marks may name. */
export function parseAppearance(v: unknown, assetIds: ReadonlySet<string>): ThemeAppearance {
  const a = obj(v, "appearance"); exact(a, ["surfaces", "palette", "type", "shape", "accent", "marks"], "appearance");
  const picks = obj(a.surfaces, "surfaces"), surfaces: Record<string, string> = {};
  for (const [id, variant] of Object.entries(picks)) {
    if (!isSurfaceId(id)) fail("unknown surface " + id.slice(0, 40));
    if (!isSurfaceVariant(id as SurfaceId, variant)) fail(`surface ${id} must be one of ${SURFACES[id as SurfaceId].join(", ")}`);
    surfaces[id] = variant as string;
  }
  const t = obj(a.type, "type"); exact(t, ["display", "ui", "body", "mono", "scale"], "type");
  const s = obj(a.shape, "shape"); exact(s, ["frame", "frameWidth", "density", "motion", "chrome"], "shape");
  const ac = obj(a.accent, "accent"); exact(ac, ["follows"], "accent");
  const m = obj(a.marks, "marks"); if (Object.keys(m).some((k) => k !== "dock" && k !== "bookFrame")) fail("marks allow only dock and bookFrame");
  const marks: ThemeAppearance["marks"] = {};
  for (const k of ["dock", "bookFrame"] as const) if (m[k] !== undefined) {
    if (typeof m[k] !== "string" || !assetIds.has(m[k] as string)) fail(`marks.${k} must name a declared asset`);
    marks[k] = m[k] as string;
  }
  const scale = t.scale, width = s.frameWidth;
  if (scale !== 0 && scale !== 1 && scale !== 2) fail("type.scale must be 0, 1 or 2");
  if (width !== 1 && width !== 2 && width !== 3) fail("shape.frameWidth must be 1, 2 or 3");
  return {
    surfaces: surfaces as SurfaceVariants, palette: parsePalette(a.palette),
    type: { display: pick(t.display, DISPLAY_FONTS, "type.display"), ui: pick(t.ui, UI_FONTS, "type.ui"), body: pick(t.body, BODY_FONTS, "type.body"), mono: pick(t.mono, MONO_FONTS, "type.mono"), scale: scale as 0 | 1 | 2 },
    shape: { frame: pick(s.frame, FRAME_STYLES, "shape.frame"), frameWidth: width as 1 | 2 | 3, density: pick(s.density, DENSITIES, "shape.density"), motion: pick(s.motion, MOTIONS, "shape.motion"), chrome: pick(s.chrome, CHROMES, "shape.chrome") },
    accent: { follows: pick(ac.follows, ["user", "locked"], "accent.follows") }, marks,
  };
}
