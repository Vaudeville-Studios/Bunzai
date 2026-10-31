/** Strict selectors and changes for scene-wide settings exposed through extension review. */
import { z } from "zod";
import { TRACKER_MODULES } from "./chat-tracker-types";
import type { ChatBackdrop, ChatCompendiumPatch, ChatConnection, ChatLore, ChatOpening, ChatPreset, ChatPromptingPatch, ChatProps } from "./chat-settings-types";
import type { ChatFinalCutPatch } from "./chat-final-cut-types";
import type { ChatRegexPatch } from "./chat-regex-types";
import type { SummarySettingsPatch } from "./chat-summary-types";
import type { ChatTrackerPatch } from "./chat-tracker-types";
import type { DirectorSettingsPatch } from "./director-types";

export const SCENE_SETTING_GROUPS = ["connection", "preset", "lore", "props", "opening", "prompting", "backdrop", "compendium", "regex", "finalCut", "tracker", "summary", "director", "variant"] as const;
export type SceneSettingGroup = (typeof SCENE_SETTING_GROUPS)[number];
const groupSchema = z.enum(SCENE_SETTING_GROUPS);
const moduleSchema = z.enum(TRACKER_MODULES);

export type SceneSettingSelector = { group: Exclude<SceneSettingGroup, "tracker"> } | { group: "tracker"; module: (typeof TRACKER_MODULES)[number] };
export const sceneSettingSelectorSchema = z.union([
  z.object({ group: z.literal("connection") }).strict(), z.object({ group: z.literal("preset") }).strict(),
  z.object({ group: z.literal("lore") }).strict(), z.object({ group: z.literal("props") }).strict(),
  z.object({ group: z.literal("opening") }).strict(), z.object({ group: z.literal("prompting") }).strict(),
  z.object({ group: z.literal("backdrop") }).strict(), z.object({ group: z.literal("compendium") }).strict(),
  z.object({ group: z.literal("regex") }).strict(), z.object({ group: z.literal("finalCut") }).strict(),
  z.object({ group: z.literal("tracker"), module: moduleSchema }).strict(), z.object({ group: z.literal("summary") }).strict(),
  z.object({ group: z.literal("director") }).strict(), z.object({ group: z.literal("variant") }).strict(),
]);

type ReplaceChange<G extends Exclude<SceneSettingGroup, "prompting" | "compendium" | "regex" | "finalCut" | "tracker" | "summary" | "director">, V> = { group: G; value: V };
type PatchChange<G extends "prompting" | "compendium" | "regex" | "finalCut" | "summary" | "director", P> = { group: G; patch: P };
export type SceneSettingChange =
  | ReplaceChange<"connection", ChatConnection | null>
  | ReplaceChange<"preset", ChatPreset | null>
  | ReplaceChange<"lore", ChatLore | null>
  | ReplaceChange<"props", ChatProps | null>
  | ReplaceChange<"opening", ChatOpening | null>
  | ReplaceChange<"backdrop", ChatBackdrop | null>
  | ReplaceChange<"variant", string | null>
  | PatchChange<"prompting", ChatPromptingPatch>
  | PatchChange<"compendium", ChatCompendiumPatch>
  | PatchChange<"regex", ChatRegexPatch>
  | PatchChange<"finalCut", ChatFinalCutPatch>
  | PatchChange<"summary", SummarySettingsPatch>
  | PatchChange<"director", DirectorSettingsPatch>
  | { group: "tracker"; module: (typeof TRACKER_MODULES)[number]; patch: ChatTrackerPatch };

const payload = z.json();
const replace = (group: Exclude<SceneSettingGroup, "prompting" | "compendium" | "regex" | "finalCut" | "tracker" | "summary" | "director">) => z.object({ group: z.literal(group), value: payload }).strict();
const patch = (group: "prompting" | "compendium" | "regex" | "finalCut" | "summary" | "director") => z.object({ group: z.literal(group), patch: payload }).strict();
export const sceneSettingChangeSchema = z.union([
  replace("connection"), replace("preset"), replace("lore"), replace("props"), replace("opening"), replace("backdrop"), replace("variant"),
  patch("prompting"), patch("compendium"), patch("regex"), patch("finalCut"), patch("summary"), patch("director"),
  z.object({ group: z.literal("tracker"), module: moduleSchema, patch: payload }).strict(),
]);

export type { ChatBackdrop, ChatCompendiumPatch, ChatConnection, ChatLore, ChatOpening, ChatPreset, ChatPromptingPatch, ChatProps, ChatFinalCutPatch, ChatRegexPatch, SummarySettingsPatch, ChatTrackerPatch, DirectorSettingsPatch };
export type SceneSettingValue = import("./chat-store").JsonValue;
export { groupSchema as sceneSettingGroupSchema };
