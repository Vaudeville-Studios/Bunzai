/** Create a new scene from only the explicitly approved, versioned cast sources. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionSceneServices } from "./_services";

const sourceId = z.string().min(1).max(120);
const input = z.strictObject({ characterId: sourceId, characterVersion: z.number().int().positive(), personaId: sourceId.optional(), personaVersion: z.number().int().positive().optional(), title: z.string().trim().min(1).max(120).optional() }).superRefine((value, context) => {
  if ((value.personaId === undefined) !== (value.personaVersion === undefined)) context.addIssue({ code: "custom", message: "persona id and version must be provided together" });
});
const output = z.strictObject({ id: sourceId, title: z.string().min(1).max(120), characterId: sourceId, personaId: sourceId.nullable(), activeTakeId: sourceId, createdAt: z.number().int().nonnegative() });
const metadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> = {
  id: "scenes.create", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Create scene",
  description: "Create a blank scene from explicitly approved character and optional persona versions. Core title defaults apply; UI loadout defaults and follow-on jobs are not run.",
  input, output, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
  hostNotes: { browser: "Creates a blank scene in the host ChatStore.", desktop: "Creates and links an rp-core scene using the approved frozen cast; UI loadout defaults and follow-on jobs are not run.", terminal: "Creates and links an rp-core scene using the approved frozen cast; UI loadout defaults and follow-on jobs are not run." },
  policy: { resources: ["character", "persona"], fields: ["scene.create"], methods: [], destinationMode: "none", destinations: [], budget: "write", confirmation: "effect" },
  estimateBudget: () => ({ bytes: 4_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: (raw) => { const args = input.parse(raw); return { resources: [{ kind: "character", id: args.characterId }, ...(args.personaId ? [{ kind: "persona", id: args.personaId }] : [])], fields: ["scene.create"], methods: [], destinations: [] }; },
  project: (value) => decodeJsonValue(output.parse(value)),
};
const definition: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionSceneServices> = {
  metadata,
  review: async (args, context, services) => {
    if (!context.access.fields.includes("scene.create") || !context.access.resources.some((resource) => resource.kind === "character" && resource.id === args.characterId)
      || (args.personaId && !context.access.resources.some((resource) => resource.kind === "persona" && resource.id === args.personaId))) throw new Error("scene sources are outside the approved grant");
    return decodeJsonValue(await services.previewCreateScene(args, context.access.resources));
  },
  execute: async (args, context, services) => {
    if (!context.access.fields.includes("scene.create") || !context.access.resources.some((resource) => resource.kind === "character" && resource.id === args.characterId)
      || (args.personaId && !context.access.resources.some((resource) => resource.kind === "persona" && resource.id === args.personaId))) throw new Error("scene sources are outside the approved grant");
    return output.parse(await services.createScene(args, context.access.resources, context.commit));
  },
};

export const sceneCreateOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => sceneCreateOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionSceneServices>, services.scenes!));
export default sceneCreateOperations;
