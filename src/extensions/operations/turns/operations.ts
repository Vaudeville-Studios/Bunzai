/** Turn control delegates to the host's one canonical RoleplayCore and fenced ChatStore. */
import { z } from "zod";
import { bindExtensionDefinitions, CORE_LINKED_SCENE_HOST_NOTES, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import { extensionTurnKindSchema, extensionTurnOutcomeSchema, extensionTurnStatusSchema } from "../../contracts/turns";
import { MAX_EXTENSION_TURN_ACCOUNTING_UNITS, MAX_EXTENSION_TURN_OUTPUT_TOKENS, MAX_EXTENSION_TURN_PROMPT_BYTES, MAX_EXTENSION_TURN_REQUESTS } from "../../contracts/limits";
import { EXTENSION_BACKGROUND_FIELDS } from "../../contracts/background-fields";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionTurnServices } from "./_services";

const sceneId = z.string().min(1).max(120);
const connectionId = z.string().min(1).max(120);
const followOnSchema = z.strictObject({ summary: z.boolean(), compendium: z.boolean(), lorebookIds: z.array(sceneId).max(16) });
const runInput = z.strictObject({ sceneId, connectionId, expectedVersion: z.number().int().nonnegative(), followOn: followOnSchema.optional() });
const cancelInput = z.strictObject({ sceneId, turnId: z.string().min(1).max(120) });
const statusInput = z.strictObject({ sceneId });
const reviewedConnection = z.strictObject({ action: z.string(), sceneId, connection: z.strictObject({ id: connectionId, model: z.string().min(1).max(500), configFingerprint: z.string().regex(SHA256_HEX_PATTERN) }), expectedVersion: z.number().int().nonnegative(), followOn: followOnSchema, limits: z.unknown(), effects: z.strictObject({ sharedGlobalWrites: z.literal("disabled") }), cost: z.unknown() });
const emptyAccess = { methods: [] as const, destinations: [] as const };
const normalizedFollowOn = (value: z.infer<typeof followOnSchema> | undefined) => value ?? { summary: false, compendium: false, lorebookIds: [] };
const runAccess = (sceneId: string, connectionId: string, followOn: z.infer<typeof followOnSchema>) => ({
  resources: [{ kind: "scene", id: sceneId }, { kind: "host-connection", id: connectionId }, ...followOn.lorebookIds.map((id) => ({ kind: "lorebook", id }))],
  fields: ["turn.run", "model.prompt", ...(followOn.summary ? [EXTENSION_BACKGROUND_FIELDS.summaryAutomatic, EXTENSION_BACKGROUND_FIELDS.summaryError] : []), ...(followOn.compendium ? [EXTENSION_BACKGROUND_FIELDS.compendiumReceipts, EXTENSION_BACKGROUND_FIELDS.compendiumEntries] : [])],
  methods: [], destinations: [`connection:${connectionId}`],
});
const metadata = <I, O>(value: Omit<ExtensionOperationMetadata<I, O>, "execute">): ExtensionOperationMetadata<I, O> => value;

function runDefinition(id: "turns.start" | "turns.continue" | "turns.regenerate", kind: z.infer<typeof extensionTurnKindSchema>, title: string): ExtensionOperationDefinition<z.infer<typeof runInput>, z.infer<typeof extensionTurnOutcomeSchema>, ExtensionTurnServices> {
  return {
    metadata: metadata({ id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title,
      description: "Run the existing scene turn engine through the scene's saved connection. Extension-triggered turns do not inherit narrator tools or write shared global variables. One host review covers up to 3 provider requests under a shared 40,000-byte prompt and 2,048-output-token-per-request ceiling; provider cost is unknown and no dollar cap is enforced.",
      input: runInput, output: extensionTurnOutcomeSchema, effect: "external", sensitivity: "secret", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS, hostNotes: CORE_LINKED_SCENE_HOST_NOTES,
      policy: { resources: ["scene", "host-connection", "lorebook"], fields: ["turn.run", "model.prompt", ...Object.values(EXTENSION_BACKGROUND_FIELDS)], ...emptyAccess, destinationMode: "host-selected-connection", budget: "external", confirmation: "sensitive-send" },
      estimateBudget: () => ({ bytes: MAX_EXTENSION_TURN_PROMPT_BYTES, tokens: MAX_EXTENSION_TURN_ACCOUNTING_UNITS }), measureTokens: () => MAX_EXTENSION_TURN_ACCOUNTING_UNITS,
      resolveAccess: ({ sceneId, connectionId, followOn }) => runAccess(sceneId, connectionId, normalizedFollowOn(followOn)),
      project: (value) => decodeJsonValue(value),
      receiptStatus: ({ status }) => status === "completed" ? "committed" : status === "conflict" ? "conflicted" : "ambiguous",
    }),
    review: async ({ sceneId, connectionId, expectedVersion, followOn: requestedFollowOn }, context, services) => {
      const followOn = normalizedFollowOn(requestedFollowOn);
      if (!context.access.resources.some((item) => item.kind === "scene" && item.id === sceneId)
        || !context.access.resources.some((item) => item.kind === "host-connection" && item.id === connectionId)
        || !context.access.destinations.includes(`connection:${connectionId}`)) throw new Error("PERMISSION_DENIED: turn target is outside approved access");
      const target = await services.review(sceneId, kind, expectedVersion, context.access.resources, followOn);
      if (!target || target.connectionId !== connectionId || target.branchVersion !== expectedVersion) throw new Error("CONFLICT: scene connection or take changed; review the turn again");
      return decodeJsonValue({ action: title, sceneId, connection: { id: target.connectionId, model: target.model, configFingerprint: target.configFingerprint }, expectedVersion,
        limits: { maxRequests: MAX_EXTENSION_TURN_REQUESTS, maxPromptBytes: MAX_EXTENSION_TURN_PROMPT_BYTES, maxOutputTokensPerRequest: MAX_EXTENSION_TURN_OUTPUT_TOKENS },
        followOn: { summary: followOn.summary, compendium: followOn.compendium, lorebookIds: [...followOn.lorebookIds] },
        effects: { sharedGlobalWrites: "disabled" },
        cost: { ceilingUsd: null, notice: "Provider pricing is unavailable, so no dollar cap is enforced. This approval covers up to the displayed request limit." } });
    },
    execute: async ({ sceneId, connectionId, expectedVersion, followOn: requestedFollowOn }, context, services) => {
      const approved = reviewedConnection.parse(context.hostReview);
      const followOn = normalizedFollowOn(requestedFollowOn);
      if (approved.sceneId !== sceneId || approved.connection.id !== connectionId || approved.expectedVersion !== expectedVersion || approved.effects.sharedGlobalWrites !== "disabled"
        || JSON.stringify(approved.followOn) !== JSON.stringify(followOn)) throw new Error("CONFLICT: turn review no longer matches this request");
      const result = await services.run(context.principal, sceneId, connectionId, approved.connection.model, approved.connection.configFingerprint, kind, expectedVersion, context.access.resources, context.commit, context.signal, context.assertCurrent);
      return extensionTurnOutcomeSchema.parse(result);
    },
  };
}

const start = runDefinition("turns.start", "reply", "Start scene reply");
const continueTurn = runDefinition("turns.continue", "continue", "Continue scene reply");
const regenerate = runDefinition("turns.regenerate", "swipe", "Regenerate scene reply");
const cancel: ExtensionOperationDefinition<z.infer<typeof cancelInput>, { cancelled: boolean }, ExtensionTurnServices> = {
  metadata: metadata({ id: "turns.cancel", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Cancel own scene turn", description: "Cancel only an in-flight turn started by this extension in the approved scene.",
    input: cancelInput, output: z.strictObject({ cancelled: z.boolean() }), effect: "control", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS, hostNotes: CORE_LINKED_SCENE_HOST_NOTES,
    policy: { resources: ["scene"], fields: ["turn.cancel"], ...emptyAccess, destinationMode: "none", budget: "metadata", confirmation: "none" },
    estimateBudget: () => ({ bytes: 1_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId }) => ({ resources: [{ kind: "scene", id: sceneId }], fields: ["turn.cancel"], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
    receiptStatus: ({ cancelled }) => cancelled ? "committed" : "conflicted" }),
  execute: async ({ sceneId, turnId }, context, services) => ({ cancelled: await services.cancel(context.principal.packageId, sceneId, turnId, context.access.resources) }),
};
const status: ExtensionOperationDefinition<z.infer<typeof statusInput>, z.infer<typeof extensionTurnStatusSchema>, ExtensionTurnServices> = {
  metadata: metadata({ id: "turns.status", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read own scene turn status", description: "Read whether this extension has a currently running turn in one approved scene; no transcript text is returned.",
    input: statusInput, output: extensionTurnStatusSchema, effect: "read", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS, hostNotes: CORE_LINKED_SCENE_HOST_NOTES,
    policy: { resources: ["scene"], fields: ["turn.status"], ...emptyAccess, destinationMode: "none", budget: "metadata", confirmation: "none" },
    estimateBudget: () => ({ bytes: 1_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId }) => ({ resources: [{ kind: "scene", id: sceneId }], fields: ["turn.status"], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value) }),
  execute: async ({ sceneId }, context, services) => extensionTurnStatusSchema.parse(await services.status(context.principal.packageId, sceneId, context.access.resources)),
};

export const turnOperations = [start, continueTurn, regenerate, cancel, status] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(turnOperations, services.turns!);
export default turnOperations;
