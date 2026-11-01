/**
 * Studio settings - the pure shape + parser (functional core; the fs store lives in settings.ts).
 * Settings are an OPEN record: the shell owns the known keys below, and drop-in setup steps may
 * write their own keys without touching this file (same open-by-design rule as format ids).
 * Parsing is fail-closed per key: a bad value drops to absent, never poisons the rest.
 */
import { isRecord } from "../core/guards";
import { isThemePackageId } from "../extensions/theme-id";
import defaultThemeManifest from "../extensions/themes/greenroom/manifest.json";

/** Known keys, exported so steps/shell/settings share one spelling (no magic strings). */
export const SETTING_KEYS = {
  theme: "theme",
  firstDeck: "firstDeck",
  /** the deck kinds picked at setup ("what do you want to make?"); firstDeck = the first pick */
  makes: "makes",
  publishTargets: "publishTargets",
  houseAccent: "houseAccent",
  /** which app opens on boot; the user picks in Settings */
  homeApp: "homeApp",
  /** what happens after sending pieces to the Workbench: "ask" | "always" | "never" (follow) */
  workbenchFollow: "workbench.follow",
  /** per-piece last-opened epoch-ms map ("kind:id" -> ms); feeds the Workbench recents rail */
  workbenchRecents: "workbench.recents",
  /** remote access on/off (reach this studio from another device via the Tailscale sidecar) */
  remoteAccessEnabled: "remoteAccessEnabled",
  /** a new scene's starting setup per character (studio/scene-character-defaults.ts owns the shape): `{ [characterId]: { presetId, samplers, backdrop, director } }` */
  sceneCharacterDefaults: "scenes.characterDefaults",
  /** accessibility (ui/shell/accessibility.ts owns the readers): interface text size in px, reduce motion, high contrast */
  uiTextSize: "ui.textSize",
  uiReduceMotion: "ui.reduceMotion",
  uiHighContrast: "ui.highContrast",
  /** the title screen and scene chooser rays: "moving" (default), "still" or "off" (see STAGE_LIGHTS) */
  uiStageLights: "ui.stageLights",
  /** the time (ms) all of one reply's tool calls may take together (a positive number; Settings > Studio > Time budgets in the Messenger shows it in seconds); absent means the default (core/assembly/tool-rounds.ts) */
  toolBudgetMs: "scenes.toolBudgetMs",
  /** the time (ms) all the macros of one prompt build may take together (a positive number; Settings > Studio > Time budgets in the Messenger shows it in seconds); absent means the default (core/assembly/tool-rounds.ts) */
  promptBudgetMs: "scenes.promptBudgetMs",
} as const;

/** The stage-lights choices, in the order Settings shows them; the first is the default when nothing is saved. */
export const STAGE_LIGHTS = ["moving", "still", "off"] as const;
export type StageLights = (typeof STAGE_LIGHTS)[number];
export const isStageLights = (value: unknown): value is StageLights => (STAGE_LIGHTS as readonly unknown[]).includes(value);
/** The stored choice; nothing saved, or anything unknown, reads as the default (moving). */
export const stageLightsOf = (value: unknown): StageLights => (isStageLights(value) ? value : STAGE_LIGHTS[0]);

/** The theme a studio paints when no theme is saved (a first run). A saved choice always wins; this never rewrites one. */
export const DEFAULT_STUDIO_THEME = "greenroom";
/** Its display name: the manifest's, so a rename is one edit there. */
export const DEFAULT_THEME_NAME: string = defaultThemeManifest.name;
/** The bundled ids, in the order the shell toggle cycles them; imported packages are selected in Settings. */
export const STUDIO_THEMES = [DEFAULT_STUDIO_THEME, "theater", "paper", "stage"] as const;
export type BuiltinStudioTheme = (typeof STUDIO_THEMES)[number];
export type StudioTheme = BuiltinStudioTheme | `bunzai.theme.${string}`;
export const isStudioTheme = (value: unknown): value is StudioTheme =>
  (STUDIO_THEMES as readonly unknown[]).includes(value) || isThemePackageId(value);
/** Resolves a saved appearance choice to its canonical package identity, including host-owned built-ins. */
export const studioThemePackageId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  if ((STUDIO_THEMES as readonly string[]).includes(value)) return `bunzai.host.theme.${value}`;
  return isThemePackageId(value) ? value : null;
};
export const nextStudioTheme = (theme: StudioTheme): StudioTheme =>
  STUDIO_THEMES[(STUDIO_THEMES.indexOf(theme as BuiltinStudioTheme) + 1) % STUDIO_THEMES.length]!;

export interface StudioSettings {
  /** false until the first-run wizard's OPEN VAUDE */
  setupComplete: boolean;
  /** Built-in IDs stay stable; imported themes use their validated bunzai.theme.<slug> package ID. */
  theme?: StudioTheme;
  /** canonical kind the library opens on ("character", "lorebook", ...) */
  firstDeck?: string;
  /** friendly platform names picked at setup; empty = "not sure yet" (every format stays ready) */
  publishTargets?: string[];
  /** house accent hex for chrome/empty states; NEVER recolors the brand rose mark */
  houseAccent?: string;
  /** remote access enabled (starts the Tailscale sidecar at boot); default false, fail-closed */
  remoteAccessEnabled?: boolean;
  /** drop-in setup steps write their own keys here */
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: StudioSettings = { setupComplete: false };

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

/** Tolerant, fail-closed reader: anything malformed reads as absent, never throws. */
export function parseSettings(raw: unknown): StudioSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const rec = raw;
  const out: StudioSettings = { ...rec, setupComplete: rec.setupComplete === true };
  if (isStudioTheme(rec.theme)) out.theme = rec.theme;
  else delete out.theme;
  if (typeof rec.firstDeck === "string" && rec.firstDeck) out.firstDeck = rec.firstDeck;
  else delete out.firstDeck;
  if (Array.isArray(rec.publishTargets)) {
    out.publishTargets = rec.publishTargets.filter((t): t is string => typeof t === "string" && t !== "");
  } else {
    delete out.publishTargets;
  }
  if (isHex(rec.houseAccent)) out.houseAccent = rec.houseAccent;
  else delete out.houseAccent;
  if (rec.remoteAccessEnabled === true) out.remoteAccessEnabled = true;
  else delete out.remoteAccessEnabled;
  if (!isStageLights(rec[SETTING_KEYS.uiStageLights])) delete out[SETTING_KEYS.uiStageLights];
  return out;
}

/** A saved time budget is usable only as a positive finite number of milliseconds; anything else reads as unset (the default applies). The one rule the turn's readers and the budget boxes share. */
export const budgetMsOf = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

/** Milliseconds in a second: the time budgets are stored in milliseconds and shown in seconds. */
export const MS_PER_SECOND = 1_000;
