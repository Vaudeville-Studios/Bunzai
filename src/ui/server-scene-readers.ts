/**
 * What a scene's turn reads from the library beyond its own store: the regex sets the scene has on (ChatStore rule 42), as data for the
 * page's sandbox worker, and the person's saved choice answers for a preset (the pref `scenes.presetChoiceDefaults`, core/preset/choices.ts).
 * Both are reads; nothing here runs a rule.
 */
import type { RegexSetBody } from "../entities/regex/schema";
import { PRESET_CHOICE_DEFAULTS_KEY, defaultsFor } from "../core/preset/choices";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import { bodyReader } from "../studio/body-reader";
import type { ReadTracker } from "../studio/library-trackers";
import { readPiece } from "../studio/library-tools";
import type { TrackerBody } from "../entities/tracker/schema";
import { SETTING_KEYS, budgetMsOf } from "../studio/settings-shape";

export const choiceDefaultsOf = (settings: SettingsStoreLike | undefined): ((presetId: string) => Promise<Record<string, unknown> | undefined>) | undefined =>
  settings ? async (presetId) => defaultsFor((await settings.read() as unknown as Record<string, unknown>)[PRESET_CHOICE_DEFAULTS_KEY], presetId) : undefined;

export const regexReaderOf = (studio: Pick<StudioStoreLike, "read"> | undefined): ((id: string) => Promise<RegexSetBody | null>) | undefined =>
  studio ? bodyReader<RegexSetBody>(studio, "regex") : undefined;

/** The reply's tool time budget from the settings (SETTING_KEYS.toolBudgetMs): a positive finite number of ms, else nothing (the turn then uses its default). */
export const toolBudgetOf = (settings: SettingsStoreLike | undefined): (() => Promise<number | undefined>) | undefined =>
  settings ? async () => {
    return budgetMsOf(((await settings.read()) as unknown as Record<string, unknown>)[SETTING_KEYS.toolBudgetMs]);
  } : undefined;

/** The prompt build's macro time budget from the settings (SETTING_KEYS.promptBudgetMs), read the same way. */
export const promptBudgetOf = (settings: SettingsStoreLike | undefined): (() => Promise<number | undefined>) | undefined =>
  settings ? async () => {
    return budgetMsOf(((await settings.read()) as unknown as Record<string, unknown>)[SETTING_KEYS.promptBudgetMs]);
  } : undefined;

/** The library's tracker pieces a scene links, each read through the tracker kind's strict decoder (library-trackers.ts). */
export const trackerReaderOf = (studio: StudioStoreLike | undefined): ReadTracker | undefined =>
  studio ? async (id) => (await readPiece((kind, pieceId) => studio.read(kind, pieceId), "tracker", id)) as TrackerBody | null : undefined;

/** The optional turn dependencies, present only when their source is. */
export const sceneReaders = (studio: Pick<StudioStoreLike, "read"> | undefined, settings: SettingsStoreLike | undefined) => {
  const readRegex = regexReaderOf(studio);
  const choiceDefaults = choiceDefaultsOf(settings);
  const toolBudgetMs = toolBudgetOf(settings);
  const promptBudgetMs = promptBudgetOf(settings);
  return { ...(readRegex ? { readRegex } : {}), ...(choiceDefaults ? { choiceDefaults } : {}), ...(toolBudgetMs ? { toolBudgetMs } : {}), ...(promptBudgetMs ? { promptBudgetMs } : {}) };
};
