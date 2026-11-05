/**
 * A Core scene's Final Cut (studio/scene-turn-final-cut.ts finalCutStage, for rp-core): rp-core's reply hook
 * runs the scene's passes on the reply before it is committed, so the journal and the scene both hold the text
 * the passes left. What the run did (its trace, the original text that Undo puts back, and its summary) is kept
 * here and written with the version by the Core projection. A pass set to Block generation vetoes the reply: the
 * turn fails and nothing is saved, as on an old scene. A continue is never run (its text is only the addition).
 */
import type { HostHooks } from "rp-core";
import type { Bank } from "../core/final-cut/banks";
import type { Chat, ChatStore, Generation, JsonObject } from "../stage/contracts/chat-store";
import { finalCutStage } from "../studio/scene-turn-final-cut";
import type { TurnDeps, TurnEvent } from "../studio/scene-turn";

export function coreFinalCut(input: {
  chats: Pick<ChatStore, "readMessagesBefore">; chat: Chat;
  deps: Pick<TurnDeps, "connect" | "now" | "readPreset" | "readRegex" | "runtime">;
  banks?(): Promise<Record<string, Bank>>;
  emit(event: TurnEvent): void;
}): { transformReply?: HostHooks["transformReply"]; extras(): { trace?: JsonObject; finalCut?: Generation["finalCut"] } | undefined } {
  let ran: { trace: JsonObject; finalCut: NonNullable<Generation["finalCut"]> } | undefined;
  if (!input.chat.finalCut?.on) return { extras: () => undefined };
  return {
    extras: () => (ran ? { trace: ran.trace, finalCut: ran.finalCut } : undefined),
    async transformReply(text, context) {
      if (context.kind === "continue") return { text };
      const recent = (await input.chats.readMessagesBefore(input.chat.activeBranchId, { limit: 12, liveOnly: true })).messages
        .slice().sort((a, b) => a.seq - b.seq).map((m) => ({ role: m.role, content: m.swipes[m.current]?.content ?? "" }));
      const cut = await finalCutStage({ deps: input.deps, chat: input.chat, text, history: recent, format: undefined, signal: context.signal,
        emit: input.emit, turnId: context.turnId, ...(input.banks ? { userBanks: input.banks } : {}) });
      if (!cut) return { text };
      if ("stop" in cut) return { veto: cut.stop.type === "failed" ? cut.stop.message : "Final Cut stopped this reply." };
      // The version's trace holds the run under finalCut, as the old turn stores it (scene-turn.ts).
      ran = { trace: { finalCut: cut.trace }, finalCut: cut.summary };
      return { text: cut.text };
    },
  };
}
