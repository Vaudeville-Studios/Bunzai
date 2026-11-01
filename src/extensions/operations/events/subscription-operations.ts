/** Host-confirmed event subscription changes, scoped to a manifest-declared event. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { SCENE_EXTENSION_EVENT_IDS, type ExtensionEventSubscription } from "../../contracts/events";
import { KIND_IDS } from "../../../generated/kinds";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const sceneInput = z.strictObject({ scope: z.literal("scene"), event: z.enum(SCENE_EXTENSION_EVENT_IDS), sceneId: z.string().min(1).max(120) });
const contentInput = z.strictObject({ scope: z.literal("content"), event: z.literal("content.changed"), resource: z.strictObject({ kind: z.enum(KIND_IDS), id: z.string().min(1).max(120) }) });
const input = z.union([sceneInput, contentInput]);
const output = z.strictObject({ status: z.enum(["subscribed", "already", "unsubscribed", "absent"]) });
const policy = { resources: ["event", "scene", ...KIND_IDS], fields: ["payload"], methods: [], destinationMode: "none" as const, destinations: [], budget: "write" as const, confirmation: "effect" as const };
const make = (id: "events.subscribe" | "events.unsubscribe", title: string, description: string): ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output,
  effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS, policy,
  receiptStatus: (value) => value.status === "subscribed" || value.status === "unsubscribed" ? "committed" : "completed",
  estimateBudget: () => ({ bytes: 8_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: (args) => {
    const subscription = input.parse(args);
    return { resources: [{ kind: "event", id: subscription.event }, subscription.event === "content.changed" ? subscription.resource : { kind: "scene", id: subscription.sceneId }], fields: ["payload"], methods: [], destinations: [] };
  },
  project: (value) => decodeJsonValue(value),
});
const subscribe: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata: make("events.subscribe", "Subscribe to a scene event", "Ask the host to deliver a bounded lifecycle event to this extension."),
  review: async (args) => decodeJsonValue({ action: "subscribe", ...input.parse(args) }),
  execute: async (args, context, services) => {
    if (!services.events) throw new Error("event subscriptions are unavailable on this host");
    const subscription = input.parse(args) as ExtensionEventSubscription;
    return { status: await services.events.subscribe(context.principal.packageId, subscription, context.commit) ? "subscribed" : "already" };
  },
};
const unsubscribe: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata: make("events.unsubscribe", "Unsubscribe from a scene event", "Stop future delivery of one event to this extension."),
  review: async (args) => decodeJsonValue({ action: "unsubscribe", ...input.parse(args) }),
  execute: async (args, context, services) => {
    if (!services.events) throw new Error("event subscriptions are unavailable on this host");
    const subscription = input.parse(args) as ExtensionEventSubscription;
    return { status: await services.events.unsubscribe(context.principal.packageId, subscription, context.commit) ? "unsubscribed" : "absent" };
  },
};
export const eventSubscriptionOperations = [subscribe, unsubscribe] as const;
export const createOperations = (services: ExtensionOperationServices) => eventSubscriptionOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default eventSubscriptionOperations;
