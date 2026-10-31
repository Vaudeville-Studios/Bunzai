/** Appearance rows that need more than the plain pref table (rows.ts): the three message colours, the scene accent, the studio colour and theme. */
import { useReducer, type JSX } from "react";
import { SETTING_KEYS, DEFAULT_STUDIO_THEME } from "../../../../../../studio/settings-shape";
import type { InstalledExtensionSummary } from "../../../../../../extensions/runtime/service";
import { HOUSE_PALETTE } from "../../../../../components/swatch-row";
import { ACCENT_CUSTOM_KEY, ACCENT_SOURCE_KEY, ACCENT_SOURCES, accentSourceAvailable, accentSourceOf, sceneAccentHex, type AccentSource } from "../../../scene-accent-core";
import { sceneColors } from "../../../scene-accents";
import { LOOK_KEYS, readLook } from "../../../stage-look-core";
import { DrillRow, SelectRow } from "../../frames/settings-rows";
import { useSettingsNav } from "../../frames/settings-window";
import type { WingArgs } from "../../wing-props";
import type { RowEnv } from "../rows";
import { SwatchSettingRow } from "./swatch-row";
import { isList, useLoaded } from "./use-loaded";

const COLORS = [
  { key: "colorChar", label: "Character text colour", description: "Narration by the character. Auto follows the theme." },
  { key: "colorUser", label: "Your text colour", description: "Narration by you." },
  { key: "colorDialogue", label: "Dialogue colour", description: "Quoted speech. Reset it to use the accent and per-speaker colours." },
] as const;
const ACCENT_NAMES: Record<AccentSource, string> = { character: "Character", persona: "Persona", profile: "Profile", custom: "Custom" };

/** Message colours, scene accent, studio colour. Preferences are not reactive, so a write counts a repaint of this list and the page. */
export function ColourRows({ a, env, part }: { a: WingArgs; env: RowEnv; part: "text" | "accent" }): JSX.Element {
  const [, again] = useReducer((n: number) => n + 1, 0);
  const { prefs } = env.ctx;
  const put = (key: string, value: unknown): void => { prefs.set(key, value); env.repaint(); again(); };
  const look = readLook(prefs);
  const colors = sceneColors(a.scene);
  const source = accentSourceOf(prefs.get(ACCENT_SOURCE_KEY));
  const sources = ACCENT_SOURCES.filter((s) => accentSourceAvailable(s, colors) || s === source);
  const house = prefs.get(SETTING_KEYS.houseAccent);
  return (
    <div data-part="scene.messenger.settings.rows">
      {part === "text" && COLORS.map((c) => <SwatchSettingRow key={c.key} label={c.label} description={c.description} value={look[c.key] ?? undefined} onChange={(hex) => put(LOOK_KEYS[c.key], hex)} onReset={() => put(LOOK_KEYS[c.key], null)} />)}
      {part === "accent" && <>
      <SelectRow label="Scene accent" description="The colour that tints replies, the composer and the scene's panels." value={source} options={sources.map((s) => ({ value: s, label: ACCENT_NAMES[s] }))} onChange={(v) => put(ACCENT_SOURCE_KEY, v)} />
      {source === "custom" && <SwatchSettingRow label="Custom accent" value={sceneAccentHex("custom", colors, prefs.get(ACCENT_CUSTOM_KEY)) ?? colors.character} onChange={(hex) => put(ACCENT_CUSTOM_KEY, hex)} />}
      <SwatchSettingRow label="Your colour" description="The workspace accent. Entity colours stay independent." palette={HOUSE_PALETTE} value={typeof house === "string" ? house : undefined} onChange={(hex) => put(SETTING_KEYS.houseAccent, hex)} />
      </>}
    </div>
  );
}

/** The requested studio theme (the same preference the Settings app writes) and a drill to the package manager. */
export function ThemeRows({ env }: { env: RowEnv }): JSX.Element {
  const nav = useSettingsNav();
  const [, again] = useReducer((n: number) => n + 1, 0);
  const catalog = useLoaded(() => env.ctx.api.extensions.list(), isList<InstalledExtensionSummary>).value?.filter((item) => item.theme !== null);
  const requested = env.ctx.prefs.get(SETTING_KEYS.theme);
  const selected = typeof requested === "string" ? requested : DEFAULT_STUDIO_THEME;
  const known = catalog?.some((t) => t.id === selected) ?? false;
  return (
    <div data-part="scene.messenger.settings.rows">
      {catalog && (
        <SelectRow label="Theme" description="Applies once the host confirms the theme's permissions." value={known ? selected : ""}
          options={[...(known ? [] : [{ value: "", label: "Unavailable selection" }]), ...catalog.map((t) => ({ value: t.id, label: `${t.name}${t.enabled ? " (installed)" : " (disabled)"}` }))]}
          onChange={(v) => { if (v) { env.ctx.prefs.set(SETTING_KEYS.theme, v); again(); } }} />
      )}
      <DrillRow label="Theme picker" description="Choose an installed appearance. Manage package access in the Extensions tab of Settings." onOpen={() => nav.open("user.themes")} />
    </div>
  );
}
