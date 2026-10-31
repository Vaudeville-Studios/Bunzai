/** Bounded, pure diagnostics over guest-supplied canonical data and sample text. */
import { z } from "zod";
import { roughTokenCount } from "../../../core/tokens/estimate";
import { getAllMacros, isVolatileMacro } from "../../../core/macros/registry";
import { safeParseCanonicalEntity } from "../../../entities/runtime-schema";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionDefinitions, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature } from "../../contracts/operation";
import { decodeJsonValue, jsonValueSchemaBounded } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const DIAGNOSTIC_HOSTS = ["desktop", "browser", "terminal"] as const satisfies readonly HostFeature[];
const metadataPolicy = { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none" as const, budget: "read-large" as const, confirmation: "none" as const };
const emptyAccess = () => ({ resources: [], fields: [], methods: [], destinations: [] });

const validateInput = z.strictObject({ entity: jsonValueSchemaBounded });
const validateOutput = z.strictObject({ valid: z.boolean(), kind: z.enum(STUDIO_ENTITY_KINDS).nullable(), id: z.string().max(120).nullable(), issues: z.array(z.string().max(300)).max(100) });
type ValidateInput = z.infer<typeof validateInput>;
type ValidateOutput = z.infer<typeof validateOutput>;
const validateMetadata: ExtensionOperationMetadata<ValidateInput, ValidateOutput> = {
  id: "content.validate", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Validate canonical content", description: "Check one JSON value against the strict canonical entity schema without storing or executing it.",
  input: validateInput, output: validateOutput, effect: "read", sensitivity: "private", hosts: DIAGNOSTIC_HOSTS,
  policy: metadataPolicy, estimateBudget: () => ({ bytes: 32_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: emptyAccess, project: (value) => decodeJsonValue(validateOutput.parse(value)),
};
const validateDefinition: ExtensionOperationDefinition<ValidateInput, ValidateOutput, ExtensionOperationServices> = {
  metadata: validateMetadata,
  execute: async ({ entity }) => {
    const parsed = safeParseCanonicalEntity(entity);
    return validateOutput.parse(parsed.ok
      ? { valid: true, kind: parsed.entity.kind, id: parsed.entity.id, issues: [] }
      : { valid: false, kind: null, id: null, issues: parsed.issues.slice(0, 100) });
  },
};

const tokenInput = z.strictObject({ text: z.string().max(64_000) });
const tokenOutput = z.strictObject({ characters: z.number().int().nonnegative().max(64_000), tokens: z.number().int().nonnegative().max(16_000), method: z.literal("rough-four-characters") });
type TokenInput = z.infer<typeof tokenInput>;
type TokenOutput = z.infer<typeof tokenOutput>;
const tokenMetadata: ExtensionOperationMetadata<TokenInput, TokenOutput> = {
  id: "content.tokens.estimate", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Estimate text tokens", description: "Return Bunzai's rough authoring estimate, not provider billing usage.",
  input: tokenInput, output: tokenOutput, effect: "read", sensitivity: "private", hosts: DIAGNOSTIC_HOSTS,
  policy: metadataPolicy, estimateBudget: () => ({ bytes: 1_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: emptyAccess, project: (value) => decodeJsonValue(tokenOutput.parse(value)),
};
const tokenDefinition: ExtensionOperationDefinition<TokenInput, TokenOutput, ExtensionOperationServices> = {
  metadata: tokenMetadata,
  execute: async ({ text }) => tokenOutput.parse({ characters: text.length, tokens: roughTokenCount(text), method: "rough-four-characters" }),
};

const macroRow = z.strictObject({ name: z.string().max(100), aliases: z.array(z.string().max(100)).max(20), description: z.string().max(500), category: z.string().max(40), args: z.array(z.strictObject({ name: z.string().max(100), description: z.string().max(300), required: z.boolean(), defaultValue: z.string().max(300).optional() })).max(12), volatile: z.boolean(), hasSideEffects: z.boolean() });
const macroInput = z.strictObject({ offset: z.number().int().min(0).max(2_000).default(0), limit: z.number().int().min(1).max(100).default(50) });
const macroOutput = z.strictObject({ macros: z.array(macroRow).max(100), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() });
type MacroInput = z.infer<typeof macroInput>;
type MacroOutput = z.infer<typeof macroOutput>;
const macroMetadata: ExtensionOperationMetadata<MacroInput, MacroOutput> = {
  id: "macros.describe", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Describe built-in macros", description: "Page names and safe documentation for the closed built-in macro catalog.",
  input: macroInput, output: macroOutput, effect: "read", sensitivity: "public", hosts: DIAGNOSTIC_HOSTS,
  policy: { ...metadataPolicy, budget: "metadata" }, estimateBudget: () => ({ bytes: 90_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: emptyAccess, project: (value) => decodeJsonValue(macroOutput.parse(value)),
};
const macroDefinition: ExtensionOperationDefinition<MacroInput, MacroOutput, ExtensionOperationServices> = {
  metadata: macroMetadata,
  execute: async ({ offset, limit }) => {
    const all = [...getAllMacros()].sort((a, b) => a.name.localeCompare(b.name));
    const macros = all.slice(offset, offset + limit).map(({ name, aliases = [], description, category, args = [], hasSideEffects = false }) => ({
      name, aliases, description, category, args, volatile: isVolatileMacro(name), hasSideEffects,
    }));
    const nextOffset = offset + macros.length < all.length ? offset + macros.length : null;
    return macroOutput.parse({ macros, total: all.length, nextOffset });
  },
};

export const diagnosticOperations = [validateDefinition, tokenDefinition, macroDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(diagnosticOperations, services);
export default diagnosticOperations;
