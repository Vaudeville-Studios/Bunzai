/** Per-package operational log port; implementations bind writes to the live commit fence. */
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
export { MAX_EXTENSION_LOG_MESSAGE_BYTES, MAX_EXTENSION_LOG_PAGE_SIZE } from "../../contracts/limits";
export type ExtensionLogLevel = "debug" | "info" | "warn" | "error";
export interface ExtensionLogRecord {
  id: string;
  createdAt: number;
  level: ExtensionLogLevel;
  message: string;
}
export interface ExtensionLogServices {
  append(packageId: string, input: { level: ExtensionLogLevel; message: string }, commit: ExtensionCommitContext): Promise<{ id: string; createdAt: number }>;
  readOwn(packageId: string, cursor: string | null, limit: number): Promise<{ records: readonly ExtensionLogRecord[]; nextCursor: string | null }>;
}
