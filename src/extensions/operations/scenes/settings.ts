/** Reviewed, revision-bound scene settings reads and writes through the canonical ChatStore door. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { bindExtensionDefinitions, CORE_SCENE_SETTING_HOST_NOTES, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue, MAX_VALUE_BYTES } from "../../contracts/value";
import { SCENE_SETTING_GROUPS, sceneSettingChangeSchema, sceneSettingSelectorSchema, type SceneSettingChange, type SceneSettingSelector } from "../../../stage/contracts/scene-settings";
import { TRACKER_MODULES } from "../../../stage/contracts/chat-tracker-types";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionSceneServices } from "./_services";

const sceneId = z.string().min(1).max(120);
const revision = z.string().regex(SHA256_HEX_PATTERN);
const input = z.strictObject({ sceneId, selector: sceneSettingSelectorSchema, change: sceneSettingChangeSchema });
const applyInput = input.extend({ expectedRevision: revision });
const value = z.json();
const previewOutput = z.strictObject({ before: value, after: value, revision }).nullable();
const applyOutput = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), revision }), z.strictObject({ status: z.literal("stale") }),
]).nullable();
const selectorFields = [
  ...SCENE_SETTING_GROUPS.filter((group) => group !== "tracker").map((group) => `scene.settings.${group}`),
  ...TRACKER_MODULES.map((module) => `scene.settings.tracker.${module}`),
];
const fieldFor = (selector: SceneSettingSelector): string => `scene.settings.${selector.group}${selector.group === "tracker" ? `.${selector.module}` : ""}`;
const access = (sceneId: string, selector: SceneSettingSelector) => ({ resources: [{ kind: "scene", id: sceneId }], fields: [fieldFor(selector)], methods: [], destinations: [] });
function assertAccess(context: { access: { resources: readonly ResourceRef[]; fields: readonly string[] } }, id: string, selector: SceneSettingSelector): void {
  if (!context.access.resources.some((resource) => resource.kind === "scene" && resource.id === id) || !context.access.fields.includes(fieldFor(selector))) throw new Error("PERMISSION_DENIED: scene setting is outside approved access");
}
function checkedPreview(value: unknown): z.infer<typeof previewOutput> { return previewOutput.parse(decodeJsonValue(value)); }

const common = {
  version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  effect: "read" as const, sensitivity: "private" as const, hosts: EXTENSION_HOSTS, hostNotes: CORE_SCENE_SETTING_HOST_NOTES,
  policy: { resources: ["scene"], fields: selectorFields, methods: [], destinationMode: "none" as const, destinations: [], budget: "read-small" as const, confirmation: "none" as const },
  estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
};
const previewMetadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof previewOutput>> = {
  ...common, id: "scenes.settings.preview", title: "Preview scene setting", description: "Show the complete safe before and after projection for one selected scene setting, with its compare revision.",
  input, output: previewOutput,
  resolveAccess: (raw) => { const args = input.parse(raw); return access(args.sceneId, args.selector); },
  project: (result) => decodeJsonValue(previewOutput.parse(result)),
};
const preview: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof previewOutput>, ExtensionSceneServices> = {
  metadata: previewMetadata,
  execute: async ({ sceneId, selector, change }, context, services) => {
    assertAccess(context, sceneId, selector);
    const result = await services.previewSceneSetting(sceneId, selector as SceneSettingSelector, change as SceneSettingChange, context.access.resources);
    if (!result) return null;
    return checkedPreview(result);
  },
};
const applyMetadata: ExtensionOperationMetadata<z.infer<typeof applyInput>, z.infer<typeof applyOutput>> = {
  ...common, id: "scenes.settings.apply", title: "Apply scene setting", description: "Apply one selected scene setting only if its host-reviewed expected revision is still current.",
  effect: "write", policy: { ...common.policy, budget: "write", confirmation: "effect" }, input: applyInput, output: applyOutput,
  receiptStatus: (result) => result?.status === "saved" ? "committed" : "conflicted",
  resolveAccess: (raw) => { const args = applyInput.parse(raw); return access(args.sceneId, args.selector); },
  project: (result) => decodeJsonValue(applyOutput.parse(result)),
};
const apply: ExtensionOperationDefinition<z.infer<typeof applyInput>, z.infer<typeof applyOutput>, ExtensionSceneServices> = {
  metadata: applyMetadata,
  review: async ({ sceneId, selector, change, expectedRevision }, context, services) => {
    assertAccess(context, sceneId, selector as SceneSettingSelector);
    const current = await services.previewSceneSetting(sceneId, selector as SceneSettingSelector, change as SceneSettingChange, context.access.resources);
    if (!current || current.revision !== expectedRevision) throw new Error("CONFLICT: scene settings changed since preview; preview again before applying");
    return decodeJsonValue({ sceneId, selector, before: current.before, after: current.after, expectedRevision });
  },
  execute: async ({ sceneId, selector, change, expectedRevision }, context, services) => {
    assertAccess(context, sceneId, selector as SceneSettingSelector);
    return applyOutput.parse(await services.applySceneSetting(sceneId, selector as SceneSettingSelector, change as SceneSettingChange, expectedRevision, context.access.resources, context.commit));
  },
};

export const sceneSettingOperations = [preview, apply] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(sceneSettingOperations, services.scenes!);
export default sceneSettingOperations;
