/** Prompt inspection, bounded contribution and candidate-only transformation for an active host turn. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const metadata = <I, O>(value: Omit<ExtensionOperationMetadata<I, O>, "execute">): ExtensionOperationMetadata<I, O> => value;
const sceneId = z.string().min(1).max(120);
const access = (id: string, fields: string[]) => ({ resources: [{ kind: "scene", id }], fields, methods: [], destinations: [] });
const inspectInput = z.strictObject({ sceneId });
const inspectOutput = z.strictObject({ messages: z.array(z.strictObject({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().max(64_000) })).max(64) });
const inspect: ExtensionOperationDefinition<z.infer<typeof inspectInput>, z.infer<typeof inspectOutput>, undefined> = {
  metadata: metadata({ id: "prompts.inspect", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Inspect the active prompt", description: "Read the bounded prompt for the current scene turn only when explicitly granted.", input: inspectInput, output: inspectOutput,
    effect: "read", sensitivity: "secret", hosts: EXTENSION_HOSTS, activationOrigins: ["prompt"],
    policy: { resources: ["scene"], fields: ["messages"], methods: [], destinationMode: "none", destinations: [], budget: "read-large", confirmation: "none" },
    estimateBudget: () => ({ bytes: 250_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId: id }) => access(id, ["messages"]), project: (value) => decodeJsonValue(value) }),
  execute: async ({ sceneId: id }, context) => {
    const invocation = context.promptInvocation;
    if (!invocation || invocation.sceneId !== id) throw new Error("prompt is unavailable outside its active scene turn");
    return inspectOutput.parse({ messages: invocation.messages });
  },
};

const candidateInput = z.strictObject({ sceneId, stage: z.literal("system.append"), text: z.string().min(1).max(4_000) });
const candidateOutput = z.strictObject({ accepted: z.boolean() });
const contribute: ExtensionOperationDefinition<z.infer<typeof candidateInput>, z.infer<typeof candidateOutput>, undefined> = {
  metadata: metadata({ id: "prompts.contribute", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Contribute to a named prompt stage", description: "Add one bounded candidate to this package hook's system stage for the active turn.", input: candidateInput, output: candidateOutput,
    effect: "control", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: ["prompt"],
    policy: { resources: ["scene"], fields: ["system.append"], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
    estimateBudget: ({ text }) => ({ bytes: new TextEncoder().encode(text).byteLength + 1_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId: id }) => access(id, ["system.append"]), project: (value) => decodeJsonValue(value) }),
  execute: async ({ sceneId: id, stage, text }, context) => {
    const invocation = context.promptInvocation;
    if (!invocation || invocation.sceneId !== id || invocation.stage !== stage) throw new Error("prompt stage is unavailable outside its active scene turn");
    return { accepted: invocation.contribute(text) };
  },
};
const transform: ExtensionOperationDefinition<z.infer<typeof candidateInput>, z.infer<typeof candidateOutput>, undefined> = {
  metadata: metadata({ id: "prompts.transform", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Transform this hook's prompt candidate", description: "Replace only a candidate already contributed by this same package hook.", input: candidateInput, output: candidateOutput,
    effect: "control", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: ["prompt"],
    policy: { resources: ["scene"], fields: ["system.append"], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
    estimateBudget: ({ text }) => ({ bytes: new TextEncoder().encode(text).byteLength + 1_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId: id }) => access(id, ["system.append"]), project: (value) => decodeJsonValue(value) }),
  execute: async ({ sceneId: id, stage, text }, context) => {
    const invocation = context.promptInvocation;
    if (!invocation || invocation.sceneId !== id || invocation.stage !== stage) throw new Error("prompt stage is unavailable outside its active scene turn");
    return { accepted: invocation.transform(text) };
  },
};

export const promptOperations = [inspect, contribute, transform] as const;
export const createOperations = (services: ExtensionOperationServices) => promptOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, undefined>, undefined));
export default promptOperations;
