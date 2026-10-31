/** Renews the runtime lease immediately before a host begins an external effect. */
import type { ExtensionStore, ExtensionRuntimeFence } from "../../stage/contracts/extension-store";

export const EXTENSION_RUNTIME_FENCE_TTL_MS = 30_000;

export function createLiveFenceGuard(input: {
  store: ExtensionStore;
  current(): ExtensionRuntimeFence | null;
  replace(fence: ExtensionRuntimeFence): void;
  unavailable(): boolean;
  blocked(packageId: string): boolean;
  now(): number;
  onLost(): void;
  fail(): Error;
}): (packageId: string) => Promise<void> {
  return async (packageId) => {
    if (input.unavailable() || input.blocked(packageId)) throw input.fail();
    const fence = input.current();
    let renewed: ExtensionRuntimeFence | null = null;
    try { renewed = fence && await input.store.renewRuntimeFence(fence, input.now(), EXTENSION_RUNTIME_FENCE_TTL_MS); }
    catch { input.onLost(); throw input.fail(); }
    if (!renewed) { input.onLost(); throw input.fail(); }
    input.replace(renewed);
  };
}
