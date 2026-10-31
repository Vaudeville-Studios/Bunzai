/** Per-package persistent command visibility port. Handler definitions remain manifest-bound. */
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";

export interface ExtensionCommandServices {
  registered(packageId: string): Promise<readonly string[]>;
  replaceRegistered(packageId: string, commandIds: readonly string[], commit: ExtensionCommitContext): Promise<{ status: "saved"; registered: readonly string[]; revision: number } | { status: "stale"; registered: readonly string[]; revision: number }>;
}
