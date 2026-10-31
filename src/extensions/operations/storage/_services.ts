/** Per-principal extension data port. Implementations must bind writes to the live runtime fence. */
import type { JsonValue } from "../../contracts/value";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";

export interface ExtensionStorageServices {
  read(packageId: string, key: string): Promise<{ value: JsonValue; revision: number } | null>;
  list(packageId: string, limit: number): Promise<readonly string[]>;
  write(packageId: string, key: string, value: JsonValue, expectedRevision: number, commit: ExtensionCommitContext): Promise<{ status: "saved"; revision: number } | { status: "stale" }>;
  delete(packageId: string, key: string, expectedRevision: number, commit: ExtensionCommitContext): Promise<{ status: "deleted" } | { status: "stale" }>;
}
