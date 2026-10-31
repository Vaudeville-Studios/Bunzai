/** Correlates one successful extension navigation with the loaded host page event. */
import type { PendingExtensionHostAction } from "../contracts/host-actions";

type SceneOpenedTicket = Extract<PendingExtensionHostAction, { action: "ui.scene.open" | "composer.draft.set" }>;

export function createSceneNavigationNotifications(input: {
  now(): number;
  requireFence(): Promise<unknown>;
  dispatch(payload: unknown, originPackageId?: string): Promise<void>;
}) {
  const pending = new Map<string, { sceneId: string; packageId: string; expiresAt: number }>();
  return {
    record(ticket: SceneOpenedTicket): void {
      for (const [id, value] of pending) if (value.expiresAt <= input.now()) pending.delete(id);
      pending.set(ticket.id, { sceneId: ticket.sceneId, packageId: ticket.packageId, expiresAt: input.now() + 120_000 });
      while (pending.size > 8) pending.delete(pending.keys().next().value!);
    },
    async notify(sceneId: string, ticketId: string | null): Promise<boolean> {
      await input.requireFence();
      let originPackageId: string | undefined;
      if (ticketId !== null) {
        const navigation = pending.get(ticketId);
        if (!navigation || navigation.expiresAt <= input.now() || navigation.sceneId !== sceneId) return false;
        pending.delete(ticketId);
        originPackageId = navigation.packageId;
      }
      await input.dispatch({ type: "scene.opened", sceneId }, originPackageId);
      return true;
    },
    close(): void { pending.clear(); },
  };
}
