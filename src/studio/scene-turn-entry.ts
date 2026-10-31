/** Provides the public turn admission boundary and translates host cancellation into Stop. */
import { runOwnedTurn, type TurnRuntime } from "./scene-turn-runtime";

/** One public turn admission boundary translates only an aborted task into Stop. */
export function enterTurn(runtime: TurnRuntime, chatId: string, body: (controller: AbortController) => Promise<void>, stopped: () => void): Promise<void> {
  return runOwnedTurn(runtime, chatId, async (controller) => {
    try { await body(controller); }
    catch (error) { if (!controller.signal.aborted) throw error; stopped(); }
  });
}
