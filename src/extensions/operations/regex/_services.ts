/** Purpose: define the narrow host port for running the established isolated regex worker. */
import type { ExtensionRegexPreviewInput } from "../../contracts/host-actions";

export interface ExtensionRegexPreviewServices {
  run(input: ExtensionRegexPreviewInput, signal: AbortSignal): Promise<{ ok: boolean; text: string; error: string | null }>;
}
