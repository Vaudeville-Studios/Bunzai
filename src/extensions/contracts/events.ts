/** Closed, value-only event inventory exposed to extensions. */
import { z } from "zod";
import type { TurnEvent } from "../../studio/scene-turn";
import type { TurnInput } from "../../rp-core";
import { decodeJsonValue, type JsonValue } from "./value";
import { KIND_IDS } from "../../generated/kinds";
import type { ContentStoreChange } from "../../stage/contracts/content-store";

export const SCENE_EXTENSION_EVENT_IDS = ["scene.opened", "scene.turn.started", "scene.turn.completed", "scene.turn.failed", "scene.turn.stopped"] as const;
export const EXTENSION_EVENT_IDS = [...SCENE_EXTENSION_EVENT_IDS, "content.changed"] as const;
export type ExtensionEventId = typeof EXTENSION_EVENT_IDS[number];
export const extensionEventSubscriptionSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("scene"), event: z.enum(SCENE_EXTENSION_EVENT_IDS), sceneId: z.string().min(1).max(120) }),
  z.strictObject({ scope: z.literal("content"), event: z.literal("content.changed"), resource: z.strictObject({ kind: z.enum(KIND_IDS), id: z.string().min(1).max(120) }) }),
]);
export type ExtensionEventSubscription = z.infer<typeof extensionEventSubscriptionSchema>;
export const extensionContentChangedPayloadSchema = z.strictObject({ type: z.literal("content.changed"), kind: z.enum(KIND_IDS), id: z.string().min(1).max(120), revision: z.string().min(1).max(200), invalidations: z.array(z.string().min(1).max(160)).min(1).max(64) });
const turnKindSchema = z.enum(["reply", "swipe", "continue"]);
export const extensionEventPayloadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("scene.opened"), sceneId: z.string().min(1).max(120) }),
  z.strictObject({ type: z.literal("scene.turn.started"), sceneId: z.string().min(1).max(120), kind: turnKindSchema }),
  z.strictObject({ type: z.literal("scene.turn.completed"), sceneId: z.string().min(1).max(120), kind: turnKindSchema }),
  z.strictObject({ type: z.literal("scene.turn.failed"), sceneId: z.string().min(1).max(120), kind: turnKindSchema }),
  z.strictObject({ type: z.literal("scene.turn.stopped"), sceneId: z.string().min(1).max(120), kind: turnKindSchema }),
  extensionContentChangedPayloadSchema,
]);
export type ExtensionEventPayload = z.infer<typeof extensionEventPayloadSchema>;
export type ExtensionContentChangedPayload = z.infer<typeof extensionContentChangedPayloadSchema>;

export function projectContentChangedEvent(input: Omit<ExtensionContentChangedPayload, "type">): JsonValue {
  return decodeJsonValue(extensionContentChangedPayloadSchema.parse({ type: "content.changed", ...input }));
}

export function projectContentStoreChange(change: ContentStoreChange): JsonValue {
  return projectContentChangedEvent({ kind: change.kind, id: change.id, revision: change.revision, invalidations: [...change.invalidations] });
}

/** Public metadata is generated from this owner; payloads deliberately omit prompts, text and provider data. */
export const extensionEventDescriptors = EXTENSION_EVENT_IDS.map((id) => ({
  id,
  version: 1 as const,
  title: id.replaceAll(".", " "),
  description: id === "content.changed" ? "Reports a content revision with bounded invalidation roots, never changed values; body invalidates the whole authored body subtree and * invalidates the deleted resource." : "Reports a scene turn lifecycle change without including prompt or reply content.",
  payload: extensionEventPayloadSchema,
}));

export function projectSceneTurnEvent(sceneId: string, input: TurnInput, event: TurnEvent): JsonValue | null {
  let type: ExtensionEventId | null = null;
  if (event.type === "start") type = "scene.turn.started";
  else if (event.type === "done") type = "scene.turn.completed";
  else if (event.type === "failed") type = "scene.turn.failed";
  else if (event.type === "stopped") type = "scene.turn.stopped";
  if (!type) return null;
  return decodeJsonValue(extensionEventPayloadSchema.parse({ type, sceneId, kind: input.kind }));
}
