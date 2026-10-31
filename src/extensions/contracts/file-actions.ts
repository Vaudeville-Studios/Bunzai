/** Strict value-only tickets for trusted UI file actions; native handles and paths are never represented. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../core/sha256";
import { MAX_EXTENSION_FILE_TRANSFER_BYTES, MAX_SELECTED_FILE_BYTES } from "./limits";

export const extensionRunPrincipalSchema = z.object({ storeId: z.string().min(1).max(160), packageId: z.string().min(1).max(120), packageDigest: z.string().regex(SHA256_HEX_PATTERN), grantRevision: z.number().int().nonnegative(), runEpoch: z.number().int().positive() }).strict();
export const fileSnapshotSchema = z.object({ size: z.number().int().nonnegative().max(MAX_SELECTED_FILE_BYTES), lastModified: z.number().int().nonnegative(), digest: z.string().regex(SHA256_HEX_PATTERN) }).strict();
const base = { id: z.string().min(1).max(120), packageId: z.string().min(1).max(120), packageName: z.string().min(1).max(120), principal: extensionRunPrincipalSchema, expiresAt: z.number().int().nonnegative() };
const safeFileName = (name: string): boolean => !/[\\/\0]/u.test(name) && name !== "." && name !== "..";
const fileName = z.string().min(1).max(255).refine(safeFileName);
export const fileHandleInfoSchema = z.object({ id: z.string().min(1).max(120), name: fileName, size: z.number().int().nonnegative().max(MAX_SELECTED_FILE_BYTES), mediaType: z.string().max(120), mode: z.enum(["read", "create", "overwrite"]) }).strict();
export const pendingExtensionFileActionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, operation: z.literal("files.pick"), action: z.literal("pick"), mode: z.enum(["read", "create", "overwrite"]), suggestedName: fileName.optional() }).strict(),
  z.object({ ...base, operation: z.literal("files.read"), action: z.literal("read"), handleId: z.string().min(1).max(120), maxBytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES), fileName }).strict(),
  z.object({ ...base, operation: z.literal("files.write.preview"), action: z.literal("preview-write"), handleId: z.string().min(1).max(120), fileName, mode: z.enum(["create", "overwrite"]) }).strict(),
  z.object({ ...base, operation: z.literal("files.write.apply"), action: z.literal("write"), handleId: z.string().min(1).max(120), fileName, mode: z.enum(["create", "overwrite"]), current: fileSnapshotSchema, proposedDigest: z.string().regex(SHA256_HEX_PATTERN), proposedBytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES) }).strict(),
]);
export const fileActionAnswerSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("picked"), handle: fileHandleInfoSchema }).strict(),
  z.object({ status: z.literal("read"), bytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES), digest: z.string().regex(SHA256_HEX_PATTERN) }).strict(),
  z.object({ status: z.literal("previewed"), current: fileSnapshotSchema }).strict(),
  z.object({ status: z.literal("written"), bytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES), digest: z.string().regex(SHA256_HEX_PATTERN), consistency: z.literal("checked-before-write") }).strict(),
  z.object({ status: z.literal("ambiguous"), bytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES), digest: z.string().regex(SHA256_HEX_PATTERN), consistency: z.literal("commit-unknown") }).strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
]);
export const fileWriteEffectReviewSchema = z.object({ kind: z.literal("bunzai.file.write"), ticketId: z.string().min(1).max(120), fileName, mode: z.enum(["create", "overwrite"]), current: fileSnapshotSchema, proposedBytes: z.number().int().nonnegative().max(MAX_EXTENSION_FILE_TRANSFER_BYTES), proposedDigest: z.string().regex(SHA256_HEX_PATTERN) }).strict();
export type PendingExtensionFileAction = z.infer<typeof pendingExtensionFileActionSchema>;
export type FileActionAnswer = z.infer<typeof fileActionAnswerSchema>;
export type FileHandleInfo = z.infer<typeof fileHandleInfoSchema>;
