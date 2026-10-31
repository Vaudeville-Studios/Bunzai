/** Keeps legacy ChatStore extension adapters out of rp-core-owned scenes. */
import { ExtensionServiceError } from "./service-errors";

export type ExtensionCoreSceneLookup = (sceneId: string) => Promise<boolean>;

export type ExtensionCoreSceneOwnership = ExtensionCoreSceneLookup | null | undefined;

export async function assertExtensionSceneNotCore(lookup: ExtensionCoreSceneOwnership, sceneId: string): Promise<void> {
  if (lookup === null) return;
  if (lookup === undefined) throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable.");
  let linked: boolean;
  try { linked = await lookup(sceneId); }
  catch { throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable."); }
  if (linked) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Extensions cannot mutate or run turns in rp-core scenes on this host.");
}

export function assertExtensionSceneCreateSupported(lookup: ExtensionCoreSceneOwnership): void {
  if (lookup === undefined) throw new ExtensionServiceError("UNSUPPORTED_HOST", "The host could not verify scene ownership; this operation is unavailable.");
  if (lookup) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Extension scene creation is unavailable on this host because new scenes use rp-core.");
}
