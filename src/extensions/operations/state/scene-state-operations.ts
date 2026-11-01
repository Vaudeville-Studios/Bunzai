/** Package-owned scene slot reads and revision-checked message delta writes. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue, operationJsonValueSchema } from "../../contracts/value";
import type { Delta } from "../../../core/scene-state/types";
import type { ExtensionOperationServices } from "../_services";

const branch = z.string().min(1).max(120);
const coreStateNote = "Core writes bind an exact mapped swipe. Pending state accepts only with this package's successful reply or regenerate commit.";
const readInput = z.strictObject({ sceneId: branch, takeId: branch });
const slotsOutput = z.strictObject({ slots: z.array(z.strictObject({ slot: z.string().min(1).max(180), value: operationJsonValueSchema })).max(64) });
const delta = z.strictObject({ slot: z.string().min(1).max(180), path: z.array(z.string().min(1).max(80)).min(1).max(16), value: operationJsonValueSchema.optional(), removed: z.literal(true).optional(), at: z.number().int().nonnegative() }).superRefine((item, context) => {
  if ((item.value === undefined) === (item.removed !== true)) context.addIssue({ code: "custom", message: "each state delta needs exactly one value or removal" });
});
const writeInput = z.strictObject({ sceneId: branch, takeId: branch, messageId: z.string().min(1).max(120).optional(), turnId: z.string().min(1).max(120).optional(), expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), deltas: z.array(delta).min(1).max(64) }).refine(({ messageId, turnId }) => Boolean(messageId) !== Boolean(turnId), "provide exactly one messageId or active turnId");
const previewOutput = z.strictObject({ status: z.literal("preview"), sceneId: branch, takeId: branch, messageId: z.string().nullable(), turnId: z.string().nullable(), expectedVersion: z.number().int().positive(), deltas: z.array(delta).max(64) });
const applyOutput = z.strictObject({ status: z.enum(["applied", "pending", "stale"]), sceneId: branch, takeId: branch, messageId: z.string().nullable(), turnId: z.string().nullable() });
const policy = (confirmation: "none" | "effect") => ({ resources: ["scene", "take"], fields: ["state"], methods: [], destinationMode: "none" as const, destinations: [], budget: confirmation === "none" ? "read-small" as const : "write" as const, confirmation });
const access = (sceneId: string, takeId: string): { resources: ResourceRef[]; fields: string[]; methods: []; destinations: [] } => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields: ["state"], methods: [], destinations: [] });
const meta = <I extends { sceneId: string; takeId: string }, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, confirmation: "none" | "effect", bytes: number, promptSafe = false): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output,
  effect: confirmation === "none" ? "read" : "write", sensitivity: "private", hosts: EXTENSION_HOSTS, ...(promptSafe ? { activationOrigins: PROMPT_SAFE_READ_ORIGINS } : {}), policy: policy(confirmation),
  estimateBudget: () => ({ bytes, tokens: 0 }),
  measureTokens: () => 0, resolveAccess: (args) => access(args.sceneId, args.takeId), project: (value) => decodeJsonValue(value),
});
const readDefinition: ExtensionOperationDefinition<z.infer<typeof readInput>, z.infer<typeof slotsOutput>, ExtensionOperationServices> = {
  metadata: meta("state.read", "Read own scene state", "Read only this package's slots from one granted take in its scene.", readInput, slotsOutput, "none", 128_000, true),
  execute: async ({ sceneId, takeId }, context, services) => {
    if (!context.access.resources.some((ref) => ref.kind === "scene" && ref.id === sceneId) || !context.access.resources.some((ref) => ref.kind === "take" && ref.id === takeId) || !context.access.fields.includes("state")) throw new Error("scene state is outside the approved grant");
    if (!services.sceneState) throw new Error("scene state is unavailable on this host");
    const slots = await services.sceneState.read(context.principal.packageId, sceneId, takeId, context.access.resources);
    return { slots: [...(slots ?? [])] };
  },
};
const previewDefinition: ExtensionOperationDefinition<z.infer<typeof writeInput>, z.infer<typeof previewOutput>, ExtensionOperationServices> = {
  metadata: meta("state.write.preview", "Preview scene state write", "Review exact package-owned deltas before applying them.", writeInput, previewOutput, "none", 128_000),
  execute: async ({ sceneId, takeId, messageId, turnId, expectedVersion, deltas }, context) => {
    if (!context.access.resources.some((ref) => ref.kind === "scene" && ref.id === sceneId) || !context.access.resources.some((ref) => ref.kind === "take" && ref.id === takeId) || !context.access.fields.includes("state")) throw new Error("scene state is outside the approved grant");
    return { status: "preview", sceneId, takeId, messageId: messageId ?? null, turnId: turnId ?? null, expectedVersion, deltas: deltas.map((item) => item as Delta) };
  },
};
const applyDefinition: ExtensionOperationDefinition<z.infer<typeof writeInput>, z.infer<typeof applyOutput>, ExtensionOperationServices> = {
  metadata: { ...meta("state.write.apply", "Apply scene state write", "Apply package-namespaced deltas at an expected branch revision. Pending writes are supported only for this package's active reply or regenerate turn; first-party, other-package, and continue turns are rejected. After-commit writes use an exact committed-message revision.", writeInput, applyOutput, "effect", 128_000),
    hostNotes: { desktop: coreStateNote, terminal: coreStateNote },
    receiptStatus: (value) => value.status === "applied" ? "committed" : value.status === "pending" ? "completed" : "conflicted" },
  review: async ({ sceneId, takeId, messageId, turnId, expectedVersion, deltas }, context) => decodeJsonValue({ sceneId, takeId, target: messageId ? { messageId } : { turnId }, expectedVersion, packageId: context.principal.packageId, slots: deltas.map(({ slot }) => slot), deltas }),
  execute: async ({ sceneId, takeId, messageId, turnId, expectedVersion, deltas }, context, services) => {
    if (!context.access.resources.some((ref) => ref.kind === "scene" && ref.id === sceneId) || !context.access.resources.some((ref) => ref.kind === "take" && ref.id === takeId) || !context.access.fields.includes("state")) throw new Error("scene state is outside the approved grant");
    if (!services.sceneState) throw new Error("scene state is unavailable on this host");
    const prefix = `ext:${context.principal.packageId}:`;
    if (deltas.some((item) => !item.slot.startsWith(prefix))) throw new Error("scene state writes must stay inside this package namespace");
    const saved = await services.sceneState.write(context.principal.packageId, sceneId, takeId, { ...(messageId ? { messageId } : {}), ...(turnId ? { turnId } : {}) }, expectedVersion, deltas.map((item) => item as Delta), context.access.resources, context.commit);
    return { status: saved, sceneId, takeId, messageId: messageId ?? null, turnId: turnId ?? null };
  },
};

const describeInput = z.strictObject({});
const describeOutput = z.strictObject({ packageId: z.string().min(1).max(120), namespacePrefix: z.string().min(5).max(140), scope: z.literal("own-package"), values: z.literal("JSON-only"), sharedSlots: z.literal(false) });
const describeMetadata: ExtensionOperationMetadata<z.infer<typeof describeInput>, z.infer<typeof describeOutput>> = {
  id: "state.slots.describe", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Describe extension scene slots", description: "Describe the package-owned value namespace; shared and core slots are not available.",
  input: describeInput, output: describeOutput, effect: "read", sensitivity: "public", hosts: EXTENSION_HOSTS,
  policy: { resources: [], fields: [], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
  estimateBudget: () => ({ bytes: 2_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(describeOutput.parse(value)),
};
const describeDefinition: ExtensionOperationDefinition<z.infer<typeof describeInput>, z.infer<typeof describeOutput>, ExtensionOperationServices> = {
  metadata: describeMetadata,
  execute: async (_args, context) => describeOutput.parse({ packageId: context.principal.packageId, namespacePrefix: `ext:${context.principal.packageId}:`, scope: "own-package", values: "JSON-only", sharedSlots: false }),
};

export const sceneStateOperations = [readDefinition, previewDefinition, applyDefinition, describeDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => sceneStateOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default sceneStateOperations;
