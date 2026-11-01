/** Exact owned Core turn identity for package-scoped scene metadata. */
export interface CoreStateTurnBinding {
  sceneId: string; takeId: string; sessionId: string; turnId: string; turnOperationId: string;
  kind: "reply" | "swipe"; expectedVersion: number;
}
export interface CoreStateMessageTarget { sceneId: string; takeId: string; messageId: string; expectedVersion: number }
export interface CoreStateLifecycle {
  ownedTurn(packageId: string, sceneId: string, turnId: string): CoreStateTurnBinding | null;
}
