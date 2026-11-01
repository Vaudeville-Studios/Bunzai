/** Pure scene-setting projection and merge shared by extension preview and native ChatStore writes. */
import { canonicalJsonString, hashHex } from "../../core/sha256";
import { isPlainObject } from "../../core/guards";
import type { Chat, JsonObject, JsonValue } from "../contracts/chat-store";
import { sceneSettingChangeSchema, type SceneSettingChange, type SceneSettingSelector, type SceneSettingValue } from "../contracts/scene-settings";
import { checkBackdrop } from "./backdrop-rules";
import { checkConnection, checkLore, checkProps, isJson } from "./chat-rules";
import { checkCompendium, mergeCompendium } from "./compendium-rules";
import { checkDirectorSettings, mergeDirectorSettings } from "./director-rules";
import { checkFinalCut, mergeFinalCut } from "./final-cut-rules";
import { checkOpening } from "./opening-rules";
import { checkPreset } from "./preset-rules";
import { checkPrompting, mergePrompting } from "./prompting-rules";
import { checkRegex, mergeRegex } from "./regex-rules";
import { checkSummarySettings, mergeSummarySettings } from "./summary-rules";
import { checkTracker, mergeTrackers } from "./tracker-rules";
import { checkVariantId } from "./cast-rules";

const PRIVATE_SAMPLERS = ["customHeaders", "customBody", "customExclude"] as const;
function projectJson(value: unknown): JsonValue {
  if (!isJson(value)) throw new TypeError("scene setting projection is not JSON");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(projectJson);
  if (!isPlainObject(value)) throw new TypeError("scene setting projection is not a plain object");
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) result[key] = projectJson(item);
  return result;
}

/** Returns only the selected group. Preset request fragments are redacted from host review. */
export function projectSceneSetting(chat: Chat, selector: SceneSettingSelector): SceneSettingValue {
  if (selector.group === "tracker") return (chat.trackers?.[selector.module] ?? null) as JsonValue;
  if (selector.group === "variant") return chat.variantId ?? null;
  if (selector.group === "preset") {
    const value = chat.preset;
    if (!value) return null;
    const { customHeaders: _headers, customBody: _body, customExclude: _exclude, ...samplers } = value.samplers;
    const redacted = PRIVATE_SAMPLERS.filter((key) => value.samplers[key] !== undefined).map((key) => `samplers.${key}`);
    const safeSamplers: JsonObject = {};
    for (const [key, item] of Object.entries(samplers)) if (item !== undefined) safeSamplers[key] = projectJson(item);
    const projection: JsonObject = { value: { kind: value.kind, id: value.id, toggles: value.toggles, samplers: safeSamplers } };
    if (redacted.length) projection.redacted = redacted;
    return projection;
  }
  if (selector.group === "summary") return (chat.summary?.settings ?? null) as JsonValue;
  if (selector.group === "director") {
    if (!chat.director) return null;
    const { archive: _archive, ...settings } = chat.director;
    return settings as JsonValue;
  }
  if (selector.group === "connection") return (chat.connection ?? null) as JsonValue;
  if (selector.group === "lore") return (chat.lore ?? null) as JsonValue;
  if (selector.group === "props") return (chat.props ?? null) as JsonValue;
  if (selector.group === "opening") return (chat.opening ?? null) as JsonValue;
  if (selector.group === "prompting") return (chat.prompting ?? null) as JsonValue;
  if (selector.group === "backdrop") return (chat.backdrop ?? null) as JsonValue;
  if (selector.group === "compendium") return (chat.compendium ?? null) as JsonValue;
  if (selector.group === "regex") return (chat.regex ?? null) as JsonValue;
  return (chat.finalCut ?? null) as JsonValue;
}

/** Full selected settings value for in-store revision checks; never use it for guest or host display. */
export function sceneSettingCompareValue(chat: Chat, selector: SceneSettingSelector): JsonValue {
  if (selector.group === "tracker") return (chat.trackers?.[selector.module] ?? null) as JsonValue;
  if (selector.group === "summary") return (chat.summary?.settings ?? null) as JsonValue;
  if (selector.group === "director") {
    if (!chat.director) return null;
    const { archive: _archive, ...settings } = chat.director;
    return settings as JsonValue;
  }
  if (selector.group === "variant") return chat.variantId ?? null;
  if (selector.group === "connection") return (chat.connection ?? null) as JsonValue;
  if (selector.group === "preset") return (chat.preset ?? null) as JsonValue;
  if (selector.group === "lore") return (chat.lore ?? null) as JsonValue;
  if (selector.group === "props") return (chat.props ?? null) as JsonValue;
  if (selector.group === "opening") return (chat.opening ?? null) as JsonValue;
  if (selector.group === "prompting") return (chat.prompting ?? null) as JsonValue;
  if (selector.group === "backdrop") return (chat.backdrop ?? null) as JsonValue;
  if (selector.group === "compendium") return (chat.compendium ?? null) as JsonValue;
  if (selector.group === "regex") return (chat.regex ?? null) as JsonValue;
  return (chat.finalCut ?? null) as JsonValue;
}

/** Stable compare token for native transaction CAS; callers must pass the full selected stored group. */
export function sceneSettingRevision(value: JsonValue): string {
  return hashHex(canonicalJsonString(value));
}

/** Applies one checked change using the same validators/mergers as the ordinary ChatStore setters. */
export function applySceneSettingChange(chat: Chat, selector: SceneSettingSelector, rawChange: unknown): Chat {
  const change = sceneSettingChangeSchema.parse(rawChange) as SceneSettingChange;
  if (change.group !== selector.group || (change.group === "tracker" && (selector.group !== "tracker" || change.module !== selector.module))) throw new TypeError("scene setting selector and change disagree");
  const next = { ...chat };
  if (change.group === "connection") next.connection = checkConnection(change.value) ?? undefined;
  else if (change.group === "preset") {
    const supplied = change.value;
    if (isPlainObject(supplied) && isPlainObject(supplied.samplers) && PRIVATE_SAMPLERS.some((key) => Object.hasOwn(supplied.samplers, key))) throw new TypeError("preset private request fields cannot be changed through extensions");
    const checked = checkPreset(change.value);
    if (checked && chat.preset) for (const key of PRIVATE_SAMPLERS) {
      const existing = chat.preset.samplers[key];
      if (existing !== undefined) Object.assign(checked.samplers, { [key]: existing });
    }
    next.preset = checked ?? undefined;
  } else if (change.group === "lore") next.lore = checkLore(change.value) ?? undefined;
  else if (change.group === "props") next.props = checkProps(change.value) ?? undefined;
  else if (change.group === "opening") next.opening = checkOpening(change.value) ?? undefined;
  else if (change.group === "backdrop") next.backdrop = checkBackdrop(change.value) ?? undefined;
  else if (change.group === "variant") next.variantId = checkVariantId(change.value) ?? undefined;
  else if (change.group === "prompting") next.prompting = mergePrompting(chat.prompting, checkPrompting(change.patch)) ?? undefined;
  else if (change.group === "compendium") next.compendium = mergeCompendium(chat.compendium, checkCompendium(change.patch)) ?? undefined;
  else if (change.group === "regex") next.regex = mergeRegex(chat.regex, checkRegex(change.patch)) ?? undefined;
  else if (change.group === "finalCut") next.finalCut = mergeFinalCut(chat.finalCut, checkFinalCut(change.patch)) ?? undefined;
  else if (change.group === "tracker") next.trackers = mergeTrackers(chat.trackers, change.module, checkTracker(change.module, change.patch)) ?? undefined;
  else if (change.group === "summary") {
    const settings = mergeSummarySettings(chat.summary?.settings, checkSummarySettings(change.patch));
    next.summary = settings || chat.summary?.error ? { ...(settings ? { settings } : {}), ...(chat.summary?.error ? { error: chat.summary.error } : {}) } : undefined;
  } else if (change.group === "director") {
    const settings = mergeDirectorSettings(chat.director, checkDirectorSettings(change.patch));
    next.director = settings || chat.director?.archive ? { ...(settings ?? {}), ...(chat.director?.archive ? { archive: chat.director.archive } : {}) } : undefined;
  }
  return next;
}
