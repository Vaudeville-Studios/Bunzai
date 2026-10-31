/** Strict tickets for user-gesture host actions. They carry no permission decisions or native handles. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../core/sha256";
import { extensionRunPrincipalSchema } from "./file-actions";
import { interactiveDescriptorSchema } from "./interactive";
import { MAX_EXTENSION_CLIPBOARD_BYTES, MAX_EXTENSION_COMPOSER_DRAFT_BYTES } from "./limits";
import { KIND_IDS } from "../../generated/kinds";
import { regexRuleSchema } from "../../entities/regex/runtime-schema";
import { MAX_EXTENSION_REGEX_PREVIEW_BYTES, MAX_EXTENSION_REGEX_PREVIEW_RULES, MAX_EXTENSION_TURN_PROMPT_BYTES } from "./limits";

const base = {
  id: z.string().min(1).max(120), packageId: z.string().min(1).max(120),
  principal: extensionRunPrincipalSchema, expiresAt: z.number().int().nonnegative(),
};
const shortText = z.string().min(1).max(2_000);
const safeLink = z.string().min(1).max(2_048).refine((value) => {
  try { const url = new URL(value); return ["https:", "mailto:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
});
const regexRuleBoundedSchema = regexRuleSchema.superRefine((rule, ctx) => {
  if (rule.find.length > 4_096 || rule.replace.length > 4_096 || rule.flags.length > 64 || rule.phases.length > 16 || rule.trimStrings?.some((item) => item.length > 500)) {
    ctx.addIssue({ code: "custom", message: "regex preview rule exceeds its field limits" });
  }
});
const regexPreviewShape = { text: z.string().max(MAX_EXTENSION_REGEX_PREVIEW_BYTES), phase: z.string().min(1).max(32), rules: z.array(regexRuleBoundedSchema).max(MAX_EXTENSION_REGEX_PREVIEW_RULES) };
const refineRegexPreview = (value: { text: string; phase: string; rules: unknown[] }, ctx: z.RefinementCtx): void => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) ctx.addIssue({ code: "custom", message: "regex preview request exceeds its byte limit" });
};
export const extensionRegexPreviewInputSchema = z.strictObject(regexPreviewShape).superRefine(refineRegexPreview);
export type ExtensionRegexPreviewInput = z.infer<typeof extensionRegexPreviewInputSchema>;

const sceneRegexInput = {
  sceneId: z.string().min(1).max(120), turnId: z.string().min(1).max(120),
  rules: z.array(regexRuleBoundedSchema).max(128),
  items: z.array(z.strictObject({ index: z.number().int().nonnegative().max(9_999), role: z.enum(["user", "assistant"]), depth: z.number().int().nonnegative().max(10_000), text: z.string().max(MAX_EXTENSION_TURN_PROMPT_BYTES) })).max(1_000),
  macros: z.strictObject({ user: z.string().max(256), char: z.string().max(256) }),
  phase: z.enum(["prompt", "display"]).optional(),
};
const sceneRegexBytes = <T extends { rules: unknown[]; items: unknown[] }>(value: T, ctx: z.RefinementCtx): void => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) ctx.addIssue({ code: "custom", message: "scene regex request exceeds its byte limit" });
};
export const sceneTurnRegexInputSchema = z.strictObject(sceneRegexInput).superRefine(sceneRegexBytes);
export const pendingSceneTurnRegexActionSchema = z.object({ ...base, action: z.literal("scene-turn.regex"), operation: z.enum(["turns.start", "turns.continue", "turns.regenerate"]), ...sceneRegexInput }).strict().superRefine((value, ctx) => sceneRegexBytes(value, ctx));
const sceneRegexAnswer = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("done"), texts: z.record(z.string().regex(/^[0-9]{1,4}$/), z.string().max(MAX_EXTENSION_TURN_PROMPT_BYTES)) }),
  z.strictObject({ kind: z.literal("failed"), error: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal("cancel") }),
]).superRefine((answer, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(answer)).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) ctx.addIssue({ code: "custom", message: "scene regex answer exceeds its byte limit" });
});
export const sceneTurnRegexAnswerSchema = z.strictObject({ status: z.literal("scene-regex-result"), answer: sceneRegexAnswer });
export type SceneTurnRegexAnswer = z.infer<typeof sceneRegexAnswer>;
export type SceneTurnRegexHostAnswer = z.infer<typeof sceneTurnRegexAnswerSchema>;

export const pendingExtensionHostActionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("clipboard.read"), operation: z.literal("clipboard.read") }).strict(),
  z.object({ ...base, action: z.literal("clipboard.write"), operation: z.literal("clipboard.write"), text: z.string().max(MAX_EXTENSION_CLIPBOARD_BYTES) }).strict(),
  z.object({ ...base, action: z.literal("links.open"), operation: z.literal("links.open"), url: safeLink }).strict(),
  z.object({ ...base, action: z.literal("ui.dialog.request"), operation: z.literal("ui.dialog.request"), message: shortText }).strict(),
  z.object({ ...base, action: z.literal("ui.scene.open"), operation: z.literal("ui.scene.open"), sceneId: z.string().min(1).max(160) }).strict(),
  z.object({ ...base, action: z.literal("ui.editor.open"), operation: z.literal("ui.editor.open"), kind: z.enum(KIND_IDS), entityId: z.string().min(1).max(160) }).strict(),
  z.object({ ...base, action: z.literal("composer.draft.set"), operation: z.literal("composer.draft.set"), sceneId: z.string().min(1).max(120), text: z.string().max(MAX_EXTENSION_COMPOSER_DRAFT_BYTES) }).strict().superRefine((ticket, ctx) => {
    if (new TextEncoder().encode(ticket.text).byteLength > MAX_EXTENSION_COMPOSER_DRAFT_BYTES) ctx.addIssue({ code: "custom", message: "composer draft exceeds its byte limit" });
  }),
  z.object({ ...base, action: z.literal("regex.preview"), operation: z.literal("regex.preview"), ...regexPreviewShape }).strict().superRefine((value, ctx) => refineRegexPreview(value, ctx)),
  pendingSceneTurnRegexActionSchema,
  z.object({ ...base, action: z.literal("playback.status"), operation: z.literal("playback.status") }).strict(),
  z.object({ ...base, action: z.literal("playback.play"), operation: z.literal("playback.play"), packId: z.string().min(1).max(120), assetId: z.string().regex(SHA256_HEX_PATTERN) }).strict(),
  z.object({ ...base, action: z.literal("playback.pause"), operation: z.literal("playback.pause") }).strict(),
  z.object({ ...base, action: z.literal("playback.stop"), operation: z.literal("playback.stop") }).strict(),
]).superRefine((action, ctx) => { if (action.packageId !== action.principal.packageId) ctx.addIssue({ code: "custom", path: ["principal"], message: "host action principal mismatch" }); });

export const extensionHostActionAnswerSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("read"), text: z.string().max(MAX_EXTENSION_CLIPBOARD_BYTES) }).strict(),
  z.object({ status: z.literal("playback-state"), playing: z.boolean(), track: z.strictObject({ assetId: z.string().regex(SHA256_HEX_PATTERN), title: z.string().max(200), packId: z.string().max(120) }).nullable() }).strict(),
  z.object({ status: z.literal("completed") }).strict(),
  z.object({ status: z.literal("regex-result"), ok: z.boolean(), text: z.string().max(MAX_EXTENSION_REGEX_PREVIEW_BYTES), error: z.string().max(500).nullable() }).strict().superRefine((answer, ctx) => {
    if (new TextEncoder().encode(answer.text).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) ctx.addIssue({ code: "custom", message: "regex preview result exceeds byte limit" });
  }),
  sceneTurnRegexAnswerSchema,
  z.object({ status: z.literal("accepted") }).strict(),
  z.object({ status: z.literal("declined") }).strict(),
  z.strictObject({ status: z.literal("composer-draft-result"), result: z.enum(["applied", "declined", "stale"]) }),
  z.object({ status: z.literal("ambiguous") }).strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
]);

export const extensionUiPanelSchema = z.strictObject({
  packageId: z.string().min(1).max(120), principal: extensionRunPrincipalSchema, digest: z.string().regex(SHA256_HEX_PATTERN),
  contributionId: z.string().min(1).max(80), descriptor: interactiveDescriptorSchema,
}).superRefine((panel, ctx) => { if (panel.packageId !== panel.principal.packageId || panel.digest !== panel.principal.packageDigest) ctx.addIssue({ code: "custom", message: "extension panel principal mismatch" }); });
export const extensionUiStatusSchema = z.strictObject({ packageId: z.string().min(1).max(120), principal: extensionRunPrincipalSchema, text: z.string().max(500).nullable() })
  .superRefine((status, ctx) => { if (status.packageId !== status.principal.packageId) ctx.addIssue({ code: "custom", message: "extension status principal mismatch" }); });
export const extensionUiNoticeSchema = z.strictObject({ id: z.string().min(1).max(120), packageId: z.string().min(1).max(120), principal: extensionRunPrincipalSchema, text: shortText, createdAt: z.number().int().nonnegative() })
  .superRefine((notice, ctx) => { if (notice.packageId !== notice.principal.packageId) ctx.addIssue({ code: "custom", message: "extension notice principal mismatch" }); });
export const extensionHostActionSnapshotSchema = z.strictObject({ actions: z.array(pendingExtensionHostActionSchema).max(8), panels: z.array(extensionUiPanelSchema).max(64), statuses: z.array(extensionUiStatusSchema).max(128), notices: z.array(extensionUiNoticeSchema).max(20) });

export type PendingExtensionHostAction = z.infer<typeof pendingExtensionHostActionSchema>;
export type ExtensionHostActionAnswer = z.infer<typeof extensionHostActionAnswerSchema>;
export type ExtensionRunPrincipal = z.infer<typeof extensionRunPrincipalSchema>;
export type ExtensionUiPanel = z.infer<typeof extensionUiPanelSchema>;
export type ExtensionUiStatus = z.infer<typeof extensionUiStatusSchema>;
export type ExtensionUiNotice = z.infer<typeof extensionUiNoticeSchema>;
export type ExtensionHostActionSnapshot = z.infer<typeof extensionHostActionSnapshotSchema>;
