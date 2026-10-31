/** Brokered, bounded read-only macro preview accepted by ADR-015. */
import { z } from "zod";
import { createDefaultContext, processMacros } from "../../../core/macros/process";
import { MAX_VALUE_BYTES } from "../../contracts/value";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationContext, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";

const primitive = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);
const variableMap = z.record(z.string().min(1).max(80), primitive).refine((value) => Object.keys(value).length <= 32);
const message = z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().max(2_000), timestamp: z.number().int().nonnegative().optional() });
const environment = z.strictObject({
  characterName: z.string().max(120).optional(), characterDescription: z.string().max(4_000).optional(),
  characterPersonality: z.string().max(4_000).optional(), characterId: z.string().max(120).optional(),
  userName: z.string().max(120).optional(), userPersona: z.string().max(4_000).optional(),
  scenario: z.string().max(4_000).optional(), firstMessage: z.string().max(4_000).optional(),
  messages: z.array(message).max(8).optional(), localVariables: variableMap.optional(), globalVariables: variableMap.optional(),
  now: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  timezone: z.string().max(80).optional(), locale: z.string().max(40).optional(), randomSeed: z.number().int().min(0).max(0x7fffffff).optional(),
});
const input = z.strictObject({ sample: z.string().min(1).max(8_000), environment });
const diagnostics = z.strictObject({ errors: z.number().int().nonnegative(), sideEffects: z.number().int().nonnegative(), touchedVariables: z.number().int().nonnegative(), cacheable: z.boolean() });
const output = z.strictObject({ text: z.string().max(32_000), diagnostics });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const policy = { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none" as const, budget: "metadata" as const, confirmation: "effect" as const };
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "macros.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Preview supplied macro text", description: "Render bounded supplied sample text in a read-only context after host confirmation.",
  input, output, effect: "control", sensitivity: "private", hosts: EXTENSION_HOSTS, policy,
  estimateBudget: () => ({ bytes: 200_000, tokens: 0 }), measureTokens: () => 0,
  receiptStatus: () => "completed",
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
  project: (value) => output.parse(value),
};

function render(args: Input, context: ExtensionOperationContext): Output {
  if (context.activationOrigin !== "command") throw new Error("macro preview is available only from an explicitly invoked command");
  const env = args.environment;
  const variableEntries = (values: Record<string, string | number | boolean | null> = {}) =>
    new Map(Object.entries(values).map(([key, value]) => [key, { value, createdAt: 0, updatedAt: 0 }]));
  const messages = env.messages ?? [];
  const result = processMacros(args.sample, createDefaultContext({
    characterName: env.characterName ?? "Character", characterDescription: env.characterDescription,
    characterPersonality: env.characterPersonality, characterId: env.characterId,
    userName: env.userName ?? "User", userPersona: env.userPersona,
    scenario: env.scenario, firstMessage: env.firstMessage, messages, messageCount: messages.length,
    userMessageCount: messages.filter((item) => item.role === "user").length,
    assistantMessageCount: messages.filter((item) => item.role === "assistant").length,
    localVariables: variableEntries(env.localVariables), globalVariables: variableEntries(env.globalVariables),
    now: env.now, timezone: env.timezone, locale: env.locale, randomSeed: env.randomSeed ?? 1,
    readOnly: true, allowRegex: false,
  }));
  const projected = output.parse({ text: result.text, diagnostics: {
    errors: result.errors.length, sideEffects: result.sideEffects.length,
    touchedVariables: result.touchedVariables.length, cacheable: result.cacheable,
  } });
  if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > 180_000) throw new Error("macro preview output exceeds the wire budget");
  return projected;
}

export const macrosPreviewOperation: ExtensionOperationDefinition<Input, Output, undefined> = {
  metadata,
  review: async (args, context) => {
    if (context.activationOrigin !== "command") throw new Error("macro preview is available only from an explicitly invoked command");
    const review = { sample: args.sample, environment: args.environment };
    if (new TextEncoder().encode(JSON.stringify(review)).byteLength > MAX_VALUE_BYTES) throw new Error("macro preview review exceeds the wire budget");
    return review;
  },
  execute: async (args, context) => render(args, context),
};

export const createOperations = (_services: unknown) => [bindExtensionOperation(macrosPreviewOperation, undefined)];
export default [macrosPreviewOperation] as const;
