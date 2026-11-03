/** Applies approved extension prompt contributions to the actual request and its token trace. */
import { countText, countPrompt, estimateFor, type Meter } from "../core/tokens";
import type { AssembledRole, TraceBlock } from "../core/assembly/types";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { PromptMessage } from "./scene-turn-attachments";
import type { ProviderRole } from "../stage/contracts/provider";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";

export function appendExtensionPrompts(messages: readonly PromptMessage[], trace: readonly TraceBlock[], additions: readonly string[]) {
  const text = additions.filter((item) => item.length > 0).join("\n\n");
  if (!text) return { messages: [...messages], trace: [...trace] };
  const output = messages.map((message) => ({ ...message }));
  const systemIndex = output.findLastIndex((message) => message.role === "system");
  const promptBlock: TraceBlock = { source: { kind: "prompt", name: "Extension contributions" }, role: "system" satisfies AssembledRole, tokens: countText(text) };
  if (systemIndex >= 0) {
    output.splice(systemIndex + 1, 0, { role: "system", content: text });
    const blocks = [...trace];
    blocks.splice(systemIndex + 1, 0, promptBlock);
    return { messages: output, trace: blocks };
  }
  output.push({ role: "system", content: text });
  return { messages: output, trace: [...trace, promptBlock] };
}

export function measurePromptRequest(messages: readonly { role: ProviderRole; content: string }[], meter: Meter, key: string, started: number, window: { context: number; reply: number }) {
  const estimate = estimateFor(meter, key, countPrompt(messages.map((message) => message.content)), started);
  return { estimate, fits: window.context <= 0 || estimate.bound <= Math.max(0, window.context - window.reply) };
}

export async function rejectOversizedPrompt(chats: Pick<ChatStore, "dropTurn">, turnId: string, emit: (event: { type: "failed"; category: "invalid_request_error"; code: "context_length_exceeded"; message: string; draft: string }) => void, reviewed: boolean, extensionCommit?: ExtensionCommitContext): Promise<void> {
  await chats.dropTurn(turnId, extensionCommit);
  emit({ type: "failed", category: "invalid_request_error", code: "context_length_exceeded", message: `The ${reviewed ? "reviewed " : ""}prompt and its approved extension contributions exceed this model's context window.`, draft: "" });
}
