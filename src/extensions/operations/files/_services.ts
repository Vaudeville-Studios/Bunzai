/** Narrow host file action port. Native handles remain in the trusted UI page. */
import type { FileHandleInfo, PendingExtensionFileAction } from "../../contracts/file-actions";
import type { OperationPrincipal } from "../../contracts/operation";

export interface ExtensionFileServices {
  pick(input: { packageName: string; principal: OperationPrincipal; mode: "read" | "create" | "overwrite"; suggestedName?: string; signal: AbortSignal }): Promise<FileHandleInfo | null>;
  read(input: { packageName: string; principal: OperationPrincipal; handleId: string; maxBytes: number; signal: AbortSignal }): Promise<Uint8Array | null>;
  previewWrite(input: { packageName: string; principal: OperationPrincipal; handleId: string; bytes: Uint8Array; signal: AbortSignal }): Promise<{ previewId: string; proposedBytes: number; proposedDigest: string } | null>;
  reviewWrite(previewId: string, principal: OperationPrincipal): { fileName: string; mode: "create" | "overwrite"; current: { size: number; lastModified: number; digest: string }; proposedBytes: number; proposedDigest: string };
  stageWrite(input: { packageName: string; principal: OperationPrincipal; previewId: string; signal: AbortSignal }): Extract<PendingExtensionFileAction, { action: "write" }>;
  write(input: { packageName: string; principal: OperationPrincipal; previewId: string; signal: AbortSignal }): Promise<"written" | "cancelled" | "ambiguous">;
}
