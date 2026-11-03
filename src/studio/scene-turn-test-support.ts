/** Shared in-memory scene and scripted-provider fixtures for turn contract tests. */
import { createTurnRuntime } from "./scene-turn-runtime";
import { ProviderError, type Provider, type ProviderCompletion, type ProviderEvent, type ProviderRequest } from "../stage/contracts/provider";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryStateStore } from "../stage/store/memory/state-store";
import { runTurn, type Connected, type TurnEvent } from "./scene-turn";

const vera = {
  kind: "character", id: "vera",
  body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} },
};

export function scripted(script: { pieces: string[]; end?: Partial<ProviderCompletion>; fail?: ProviderError; gate?: Promise<void> }) {
  const sent: ProviderRequest[] = [];
  const provider: Provider = {
    id: "fake",
    async send(request, io) {
      sent.push(request);
      let text = "";
      for (const piece of script.pieces) {
        io?.signal?.throwIfAborted();
        text += piece;
        io?.onEvent?.({ channel: "content", delta: piece } satisfies ProviderEvent);
        await Promise.resolve();
      }
      if (script.gate) await Promise.race([script.gate, new Promise((_, reject) => io?.signal?.addEventListener("abort", () => reject(io.signal!.reason)))]);
      io?.signal?.throwIfAborted();
      if (script.fail) throw script.fail;
      return { content: text, finish_reason: "stop", model: "vera-1-routed", usage: { shape: "openai", promptTotal: 120, output: 9 }, raw: {}, ...script.end } as ProviderCompletion;
    },
  };
  return { provider, sent };
}

export async function scene(provider: Provider | null, opts: { connection?: boolean; extensionCommit?: boolean; userMessage?: string } = {}) {
  let now = 1_000;
  const chats = opts.extensionCommit
    ? memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: () => undefined })
    : memoryChatStore(() => now);
  const state = memoryStateStore();
  const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: vera } });
  if (opts.connection !== false) await chats.setConnection(chat.id, { id: "conn", model: "vera-1" });
  const [greeting, hello] = (await chats.appendMessages(chat.activeBranchId, [
    { role: "assistant", content: "Evening." },
    { role: "user", content: opts.userMessage ?? "{{setvar::asked::yes}}Any storms?" },
  ]))!;
  const deps = { runtime: createTurnRuntime(), chats, state,
    connect: async (): Promise<Connected | null> => (provider ? { provider, kind: "openrouter", context: 32_000 } : null),
    readPreset: async () => null, readLorebook: async () => null, now: () => (now += 10), randomSeed: () => 7,
  };
  const version = async () => (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion!;
  const events: TurnEvent[] = [];
  const turn = async (kind: "reply" | "swipe" = "reply", expectedVersion?: number, extensionCommit?: ExtensionCommitContext) =>
    runTurn(deps, { chatId: chat.id, kind, expectedVersion: expectedVersion ?? (await version()) }, (event) => events.push(event), extensionCommit);
  const texts = async () => (await chats.readMessages(chat.activeBranchId, { limit: 50 })).messages.map((message) => message.swipes[message.current]!.content);
  return { chats, state, chat, greeting: greeting!, hello: hello!, deps, events, turn, texts, version };
}

export async function waitFor(events: TurnEvent[], type: TurnEvent["type"]): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (events.some((event) => event.type === type)) return;
    await Bun.sleep(5);
  }
  throw new Error(`no ${type} event; saw ${JSON.stringify(events)}`);
}

export const turnIdOf = (events: TurnEvent[]) => (events.find((event) => event.type === "start") as Extract<TurnEvent, { type: "start" }>).turnId;
export const lastOf = async (chats: ChatStore, branchId: string) => (await chats.readMessages(branchId, { limit: 50 })).messages.at(-1)!;
