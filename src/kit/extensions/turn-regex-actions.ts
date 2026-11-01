/** Adapt scene regex gates directly to Terminal's bounded Worker, without a UI-action queue. */
import { pendingSceneTurnRegexActionSchema, type ExtensionHostActionAnswer } from "../../extensions/contracts/host-actions";
import type { NewExtensionHostAction } from "../../extensions/runtime/host-action-port";
import { runTerminalSceneRegex } from "./regex-preview";

export function terminalTurnRegexRequest(now: () => number, id: () => string) {
  return {
    async request(action: NewExtensionHostAction, signal: AbortSignal): Promise<ExtensionHostActionAnswer | undefined> {
      if (action.action !== "scene-turn.regex") throw new Error("UNSUPPORTED_HOST: Terminal turn worker only accepts scene regex gates.");
      const ticket = pendingSceneTurnRegexActionSchema.parse({ ...action, id: id(), expiresAt: now() + 30_000 });
      return runTerminalSceneRegex({ sceneId: ticket.sceneId, turnId: ticket.turnId, rules: ticket.rules, items: ticket.items, macros: ticket.macros, phase: ticket.phase }, signal);
    },
  };
}
