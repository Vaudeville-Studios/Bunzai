/** Strict, bounded package envelope; theme data is rechecked by the existing theme inspector. */
import { z } from "zod";
import { EXTENSION_HTTP_METHODS, isHostConnection, isPublicHttpsOrigin } from "./destination";
import { jsonValueSchemaBounded } from "./value";
import { EXTENSION_EVENT_IDS } from "./events";
import { operationIdSchema } from "./operation-id";
import { contributionIdSchema } from "./contribution-id";

const operationRequirementSchema = z.object({ operation: operationIdSchema, resources: z.array(z.string().min(1).max(160)).max(64), fields: z.array(z.string().min(1).max(120)).max(128), methods: z.array(z.enum(EXTENSION_HTTP_METHODS)).max(EXTENSION_HTTP_METHODS.length), destinations: z.array(z.string().refine((value) => isPublicHttpsOrigin(value) || isHostConnection(value))).max(64), purpose: z.string().min(1).max(500), required: z.boolean() }).strict();
const contributionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), id: contributionIdSchema, label: z.string().min(1).max(80), operation: operationIdSchema }).strict(),
  z.object({ type: z.literal("panel"), id: contributionIdSchema, title: z.string().min(1).max(80), events: z.array(z.enum(EXTENSION_EVENT_IDS)).max(16) }).strict(),
  z.object({ type: z.literal("prompt"), id: contributionIdSchema, label: z.string().min(1).max(80), stage: z.literal("system.append"), priority: z.number().int().min(-100).max(100).optional(), required: z.boolean().optional() }).strict(),
]);
const themeImageSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,48}$/), path: z.string().regex(/^assets\/[a-z0-9][a-z0-9._-]*\.(?:svg|png|webp)$/), mediaType: z.enum(["image/svg+xml", "image/png", "image/webp"]) }).strict();
const themeFontSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,48}$/), path: z.string().regex(/^fonts\/[a-z0-9][a-z0-9._-]*\.woff2$/), mediaType: z.literal("font/woff2") }).strict();
const themeSchema = z.object({
  requests: z.array(z.enum(["appearance.palette", "appearance.type", "appearance.shape", "appearance.surfaces", "appearance.accent", "appearance.assets", "appearance.styles", "appearance.fonts", "ui.slots"])).max(9),
  appearance: jsonValueSchemaBounded, assets: z.array(themeImageSchema).max(24), styles: z.literal("styles.css").optional(), fonts: z.array(themeFontSchema).max(4).optional(), slots: jsonValueSchemaBounded.optional(),
}).strict();
const settingPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]), title: z.string().max(120).optional(), description: z.string().max(500).optional(),
  enum: z.array(jsonValueSchemaBounded).max(64).optional(), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), minLength: z.number().int().nonnegative().max(4096).optional(), maxLength: z.number().int().nonnegative().max(4096).optional(),
}).strict();
export const settingsDefinitionSchema = z.object({
  type: z.enum(["object", "string", "number", "integer", "boolean"]), title: z.string().max(120).optional(), description: z.string().max(500).optional(),
  properties: z.record(z.string().min(1).max(80), settingPropertySchema).refine((properties) => Object.keys(properties).length <= 64, "at most 64 settings are allowed").optional(), required: z.array(z.string().min(1).max(80)).max(64).optional(),
  enum: z.array(jsonValueSchemaBounded).max(64).optional(), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), minLength: z.number().int().nonnegative().max(4096).optional(), maxLength: z.number().int().nonnegative().max(4096).optional(), additionalProperties: z.literal(false).optional(),
}).strict();
export type SettingsDefinition = z.infer<typeof settingsDefinitionSchema>;
export type SettingsProperty = NonNullable<SettingsDefinition["properties"]>[string];

export const extensionManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(120), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(48),
  name: z.string().min(1).max(80), description: z.string().max(1000), author: z.string().max(120),
  api: z.object({ major: z.number().int().positive(), minMinor: z.number().int().nonnegative(), maxMinor: z.number().int().nonnegative() }).strict(),
  entry: z.literal("main.js").optional(), requirements: z.array(operationRequirementSchema).max(256), contributions: z.array(contributionSchema).max(64),
  theme: themeSchema.optional(), settingsSchema: settingsDefinitionSchema.optional(), settings: jsonValueSchemaBounded.optional(),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.api.minMinor > manifest.api.maxMinor) ctx.addIssue({ code: "custom", path: ["api"], message: "invalid API range" });
  if (manifest.requirements.some((r, i) => manifest.requirements.findIndex((x) => x.operation === r.operation) !== i)) ctx.addIssue({ code: "custom", path: ["requirements"], message: "duplicate operation requirement" });
  if (manifest.contributions.some((c, i) => manifest.contributions.findIndex((x) => x.id === c.id) !== i)) ctx.addIssue({ code: "custom", path: ["contributions"], message: "duplicate contribution id" });
  if (manifest.entry === undefined && manifest.requirements.length) ctx.addIssue({ code: "custom", path: ["entry"], message: "executable requirements need an entry" });
});

const packagePath = /^(?:main\.js|styles\.css|assets\/[A-Za-z0-9][A-Za-z0-9._-]*|fonts\/[A-Za-z0-9][A-Za-z0-9._-]*\.woff2)$/;
export const extensionPackageSchema = z.object({
  manifest: extensionManifestSchema,
  /** Text files use UTF-8; theme binary files use canonical base64 as defined by theme-contract. */
  files: z.record(z.string().min(1).max(180).regex(packagePath), z.string().max(2_000_000)), licenseText: z.string().max(64_000).optional(),
}).strict().superRefine((pkg, ctx) => {
  const entries = Object.entries(pkg.files);
  if (entries.length > 130) ctx.addIssue({ code: "custom", path: ["files"], message: "too many package files" });
  let totalBytes = 0;
  for (const [path, text] of entries) {
    if (path !== path.toLowerCase()) ctx.addIssue({ code: "custom", path: ["files", path], message: "package paths must be lowercase" });
    totalBytes += new TextEncoder().encode(text).byteLength;
  }
  if (totalBytes > 8_000_000) ctx.addIssue({ code: "custom", path: ["files"], message: "package exceeds its byte limit" });
  const theme = pkg.manifest.theme;
  const themed = theme ? [...theme.assets.map((a) => a.path), ...(theme.styles ? [theme.styles] : []), ...(theme.fonts ?? []).map((f) => f.path)] : [];
  const expected = [...(pkg.manifest.entry ? [pkg.manifest.entry] : []), ...themed].sort();
  const actual = Object.keys(pkg.files).sort();
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) ctx.addIssue({ code: "custom", path: ["files"], message: "package files do not match the manifest" });
  if (theme && new Set(themed).size !== themed.length) ctx.addIssue({ code: "custom", path: ["manifest", "theme"], message: "duplicate theme asset path" });
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export type ExtensionPackageInput = z.infer<typeof extensionPackageSchema>;
