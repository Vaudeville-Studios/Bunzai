/** One stable guest-visible error vocabulary across the wire, broker and generated SDK. */
import { z } from "zod";

export const EXTENSION_ERROR_CODES = [
  "INVALID_REQUEST", "UNKNOWN_OPERATION", "UNSUPPORTED_HOST", "PERMISSION_DENIED", "STALE_PRINCIPAL",
  "LIMIT_EXCEEDED", "CANCELLED", "OPERATION_FAILED", "PACKAGE_CHANGED", "CONFLICT", "DECLINED",
  "RUNTIME_UNAVAILABLE", "RECOVERY_REQUIRED", "INTERNAL_ERROR",
] as const;
export const extensionErrorCodeSchema = z.enum(EXTENSION_ERROR_CODES);
export const extensionErrorSchema = z.strictObject({ code: extensionErrorCodeSchema, message: z.string().min(1).max(500) });
export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];
export type ExtensionError = z.infer<typeof extensionErrorSchema>;

/** Translate internal exception names once at the guest protocol boundary. */
export function extensionErrorCode(code: string): ExtensionErrorCode {
  switch (code) {
    case "invalid-request": return "INVALID_REQUEST";
    case "unknown-operation": return "UNKNOWN_OPERATION";
    case "unsupported-host": return "UNSUPPORTED_HOST";
    case "denied": return "PERMISSION_DENIED";
    case "stale-principal": return "STALE_PRINCIPAL";
    case "cancelled": return "CANCELLED";
    default: return extensionErrorCodeSchema.safeParse(code).success ? code as ExtensionErrorCode : "OPERATION_FAILED";
  }
}
