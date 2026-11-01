/** Keeps legacy ChatStore extension adapters out of rp-core-owned scenes. */
import { ExtensionServiceError } from "./service-errors";

export type ExtensionCoreSceneLookup = (sceneId: string) => Promise<boolean>;

export type ExtensionCoreSceneOwnership = ExtensionCoreSceneLookup | null | undefined;

export async function assertExtensionSceneNotCore(lookup: ExtensionCoreSceneOwnership, sceneId: string): Promise<void> {
  if (lookup === null) return;
  if (lookup === undefined) throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable.");
  let linked: boolean;
  try { linked = await lookup(sceneId); }
  catch (error) {
    if (error instanceof ExtensionServiceError) throw error;
    throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable.");
  }
  if (linked) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Extensions cannot mutate or run turns in rp-core scenes on this host.");
}

export function assertExtensionSceneCreateSupported(lookup: ExtensionCoreSceneOwnership, coreCreateAvailable = false): void {
  if (lookup === undefined) throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable.");
  if (lookup && !coreCreateAvailable) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Core scene creation is unavailable on this host.");
}
