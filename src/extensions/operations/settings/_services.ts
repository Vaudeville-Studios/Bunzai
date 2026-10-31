/** Package settings use a reserved ExtensionStore key and the package's immutable schema. */
import type { JsonValue } from "../../contracts/value";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";

export const EXTENSION_SETTINGS_DATA_KEY = "settings.internal";
export interface ExtensionSettingsServices {
  read(packageId: string, digest: string): Promise<{ schema: JsonValue; value: JsonValue | null; revision: number }>;
  write(packageId: string, digest: string, value: JsonValue, expectedRevision: number, commit: ExtensionCommitContext): Promise<{ status: "saved"; revision: number } | { status: "stale" }>;
}
