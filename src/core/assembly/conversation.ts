/**
 * How RoleCall lays out a conversation (ported from `preset-loader.ts` at the pin): the synthesized
 * "No Preset (Defaults)" prompt set, `buildConversationWithPreset`, which weaves in-chat prompts
 * between history messages by depth, and the append walker that glues a block onto a message.
 * A real preset is laid out by preset.ts into the same shape.
 */
import type { PresetPlan } from "./preset";
import type { PresetAttachment } from "../../entities/preset/schema";
import type { AssembledRole, BlockSource } from "./types";

/** A message while it is being assembled: where it came from, and whether macros may write from it. */
export interface Block {
  role: AssembledRole;
  content: string;
  source: BlockSource;
  /** Authored prompt files follow the block through depth placement and appends. */
  attachments?: readonly PresetAttachment[];
  attachmentOwner?: { id: string; name: string };
  /** Stored history: its macros run read-only, so an old {{setvar}} never fires again. */
  historical?: boolean;
}

/** RoleCall's reply cap when no preset sets one (`sampler-defaults.ts` DEFAULT_MAX_RESPONSE_TOKENS). */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * The synthesized set RoleCall uses without a preset, in SillyTavern's default order. The examples
 * prompt asks for `{{mesExamples}}`: RoleCall's set asked for `{{mes_example}}`, which no macro
 * answers, so every no-preset chat lost the card's example dialogue (assembler-port.md finding 1,
 * fixed in both.
 */
export function defaultPrompts(): PresetPlan {
  const prompt = (name: string, content: string): Block => ({ role: "system", content, source: { kind: "prompt", name, id: name } });
  return {
    append: new Map(),
    top: [],
    bottom: [],
    info: [],
    slots: new Set(),
    slotNonce: "",
    relative: [
      prompt("charDescription", "{{description}}"),
      prompt("charPersonality", "{{personality}}"),
      prompt("scenario", "{{scenario}}"),
      prompt("personaDescription", "{{persona}}"),
      prompt("worldInfoBefore", "{{lore}}"),
      prompt("summary", "{{summary}}"),
      prompt("dialogueExamples", "{{mesExamples}}"),
    ],
    inChat: new Map([[0, [prompt("chatHistory", "{{message_history}}")]]]),
  };
}

const conversational = (b: Block): boolean => b.role === "user" || b.role === "assistant";

/**
 * RoleCall's layout: relative prompts, the greeting, then history with each in-chat prompt placed
 * before the message at its depth. Depth counts user and assistant messages only, the current one
 * included, so depth 0 lands just before the current message; a depth past the history lands
 * before the first conversational message.
 */
export function buildConversation(
  relative: readonly Block[],
  inChat: ReadonlyMap<number, readonly Block[]>,
  greeting: Block | null,
  history: readonly Block[],
  current: Block | null,
): Block[] {
  const out: Block[] = [...relative];
  if (greeting) out.push(greeting);
  if (inChat.size === 0) {
    out.push(...history);
  } else {
    const total = history.filter(conversational).length + (current ? 1 : 0);
    const overflow = [...inChat.keys()]
      .sort((a, b) => b - a)
      .filter((depth) => depth >= total)
      .flatMap((depth) => inChat.get(depth)!);
    let seen = 0;
    let overflowPlaced = false;
    for (const message of history) {
      if (conversational(message)) {
        if (!overflowPlaced && overflow.length > 0) {
          out.push(...overflow);
          overflowPlaced = true;
        }
        out.push(...(inChat.get(total - seen - 1) ?? []));
        seen++;
      }
      out.push(message);
    }
    if (!overflowPlaced) out.push(...overflow);
    if (current) out.push(...(inChat.get(0) ?? []));
  }
  if (current) out.push(current);
  return out;
}

/**
 * RoleCall's append placement (`appendAtDepth`, jobs/depth-guides.ts at the pin): glues `item`'s
 * text onto the end of the depth-th message from the end of the region whose role matches (system
 * counts as user, "the bottom of what I said"). With no such message it becomes its own message at
 * the end of the region rather than being dropped. Returns the new list and whether it grew.
 */
export function appendAtDepth(
  messages: readonly Block[],
  item: Block,
  depth: number,
  region: { start: number; end: number },
): { blocks: Block[]; inserted: boolean } {
  const out = [...messages];
  const role: AssembledRole = item.role === "assistant" ? "assistant" : "user";
  const at = Math.max(0, Math.min(out.length, Number.isFinite(depth) ? Math.floor(depth) : 0));
  const start = Math.max(0, region.start);
  const end = Math.min(out.length, region.end);
  let seen = 0;
  for (let i = end - 1; i >= start; i--) {
    if (out[i]!.role !== role) continue;
    if (seen === at) {
      out[i] = { ...out[i]!, content: `${out[i]!.content}\n${item.content}`, ...(item.attachments?.length ? { attachments: [...(out[i]!.attachments ?? []), ...item.attachments] } : {}) };
      return { blocks: out, inserted: false };
    }
    seen++;
  }
  out.splice(end, 0, { ...item, role });
  return { blocks: out, inserted: true };
}

/**
 * RoleCall's depth injection over the history region (`prompt-assembly.ts` section 10.5): each
 * block lands before the conversational message at its depth, counted from the end of the region;
 * a depth past the region lands before its first conversational message. Returns the new list and
 * where the region now ends.
 */
export function injectAtDepth(
  messages: readonly Block[],
  byDepth: ReadonlyMap<number, readonly Block[]>,
  region: { start: number; end: number },
): Block[] {
  if (byDepth.size === 0) return [...messages];
  const chatIndices: number[] = [];
  for (let i = region.start; i < region.end; i++) if (conversational(messages[i]!)) chatIndices.push(i);
  const total = chatIndices.length;
  const depthAt = new Map(chatIndices.map((index, i) => [index, total - i - 1]));
  const placed = new Set<number>();
  const early: Block[] = [];
  for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
    if (depth >= total) {
      early.push(...byDepth.get(depth)!);
      placed.add(depth);
    }
  }
  const firstChat = chatIndices[0] ?? region.start;
  const out: Block[] = [];
  let earlyPlaced = false;
  messages.forEach((message, i) => {
    if (i === firstChat && early.length > 0) {
      out.push(...early);
      earlyPlaced = true;
    }
    const depth = depthAt.get(i);
    if (depth !== undefined && byDepth.has(depth) && !placed.has(depth)) {
      out.push(...byDepth.get(depth)!);
      placed.add(depth);
    }
    out.push(message);
  });
  if (!earlyPlaced) out.push(...early);
  return out;
}
