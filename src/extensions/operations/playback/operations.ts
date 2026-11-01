/** Controls the shared local-pack music player through explicit host actions. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { DESKTOP_EXTENSION_HOSTS, bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionRunPrincipal } from "../../contracts/host-actions";
import { decodeJsonValue, type JsonValue } from "../../contracts/value";

const empty = z.strictObject({});
const playInput = z.strictObject({ packId: z.string().min(1).max(120), assetId: z.string().regex(SHA256_HEX_PATTERN) });
const statusOutput = z.strictObject({ playing: z.boolean(), track: z.strictObject({ assetId: z.string().regex(SHA256_HEX_PATTERN), title: z.string().max(200), packId: z.string().max(120) }).nullable() });
const controlOutput = z.strictObject({ completed: z.boolean() });
type PlayInput = z.infer<typeof playInput>;
type StatusOutput = z.infer<typeof statusOutput>;
type ControlOutput = z.infer<typeof controlOutput>;
const principal = (value: { storeId: string; packageId: string; packageDigest: string; grantRevision: number; runEpoch: number }): ExtensionRunPrincipal => ({
  storeId: value.storeId, packageId: value.packageId, packageDigest: value.packageDigest, grantRevision: value.grantRevision, runEpoch: value.runEpoch,
});
const metadata = <I, O extends JsonValue>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, fields: readonly string[], resources: readonly string[], effect: "read" | "control", budget: "metadata" | "read-small", receiptStatus?: (value: O) => "completed" | "conflicted" | "committed"): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output, effect, sensitivity: "private", hosts: DESKTOP_EXTENSION_HOSTS,
  policy: { resources, fields, methods: [], destinationMode: "none", destinations: [], budget, confirmation: "none" },
  estimateBudget: () => ({ bytes: 4_096, tokens: 0 }), measureTokens: () => 0,
  ...(receiptStatus ? { receiptStatus } : {}),
  resolveAccess: (args) => ("packId" in (args as object) ? { resources: [{ kind: "pack", id: (args as PlayInput).packId }], fields: [...fields], methods: [], destinations: [] } : { resources: [], fields: [...fields], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
});

const status: ExtensionOperationDefinition<z.infer<typeof empty>, StatusOutput, ExtensionOperationServices> = {
  metadata: metadata("playback.status", "Read local playback status", "Read the shared local music player's current state.", empty, statusOutput, ["playback.status"], [], "read", "metadata"),
  execute: async (_args, context, services) => {
    if (context.host !== "desktop" || !services.hostActions) throw new Error("Playback is unavailable on this host.");
    const result = await services.hostActions.request({ action: "playback.status", operation: "playback.status", packageId: context.principal.packageId, principal: principal(context.principal) }, context.signal);
    return result?.status === "playback-state" ? { playing: result.playing, track: result.track } : { playing: false, track: null };
  },
};
const play: ExtensionOperationDefinition<PlayInput, ControlOutput, ExtensionOperationServices> = {
  metadata: metadata("playback.play", "Play a local audio asset", "Play one audio asset referenced by an exactly granted local pack.", playInput, controlOutput, ["media"], ["pack"], "control", "metadata", (value) => value.completed ? "committed" : "conflicted"),
  execute: async ({ packId, assetId }, context, services) => {
    const scoped = context.access.resources.some((ref) => ref.kind === "pack" && ref.id === packId);
    if (!context.access.fields.includes("media") || !scoped || !services.assets || !services.hostActions || context.host !== "desktop") throw new Error("This local audio asset is outside the approved playback scope.");
    const assets = await services.assets.list("pack", packId, context.access.resources);
    if (!assets.some((asset) => asset.sha === assetId && asset.mime?.startsWith("audio/"))) throw new Error("This audio asset is not referenced by the approved pack.");
    const result = await services.hostActions.request({ action: "playback.play", operation: "playback.play", packageId: context.principal.packageId, principal: principal(context.principal), packId, assetId }, context.signal);
    if (result?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether playback started.");
    return { completed: result?.status === "completed" };
  },
};
const makeControl = (id: "playback.pause" | "playback.stop", title: string): ExtensionOperationDefinition<z.infer<typeof empty>, ControlOutput, ExtensionOperationServices> => ({
  metadata: metadata(id, title, `Ask the host to ${title.toLowerCase()} the shared local music player.`, empty, controlOutput, ["playback.control"], [], "control", "metadata", (value) => value.completed ? "committed" : "conflicted"),
  execute: async (_args, context, services) => {
    if (context.host !== "desktop" || !services.hostActions) throw new Error("Playback is unavailable on this host.");
    const ticket = id === "playback.pause"
      ? { action: "playback.pause" as const, operation: "playback.pause" as const, packageId: context.principal.packageId, principal: principal(context.principal) }
      : { action: "playback.stop" as const, operation: "playback.stop" as const, packageId: context.principal.packageId, principal: principal(context.principal) };
    const result = await services.hostActions.request(ticket, context.signal);
    if (result?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether playback changed.");
    return { completed: result?.status === "completed" };
  },
});
const pause = makeControl("playback.pause", "Pause playback");
const stop = makeControl("playback.stop", "Stop playback");

export const playbackOperations = [status, play, pause, stop] as const;
export const createOperations = (services: ExtensionOperationServices) => playbackOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default playbackOperations;
