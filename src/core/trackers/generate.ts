/**
 * Generate and Refresh for one tracker item (RoleCall `app/api/chat/generate-tracker-item/route.ts`: `buildItemPrompt` 162-690, the system line at 1110): the
 * request the scene's model gets, and how its answer is read. Prompt wording follows RoleCall's
 * upstream implementation; `studio/scene-tracker-item.ts` sends it and allows at most one repair.
 * This module does not write the scene: its answer is a proposal for the person to accept or discard.
 * An unreadable answer is an error, and a world theme is included only when the person chose one.
 */
import { extractObject } from "../model-json";
import { isRecord } from "../guards";
import type { Shape } from "./shape";

export type Subs = Readonly<Record<string, boolean>>;

/** What a module says about one kind of item it can generate (RoleCall's `moduleSchemas[...]`). */
export interface GenSpec<T = unknown> {
  /** The noun the prompt uses ("Inventory item"). */
  description(subs: Subs): string;
  /** The JSON shape the prompt shows the model, RoleCall's text. */
  schema(subs: Subs): string;
  /** What the model's fields become: coerced, never trusted. */
  item: Shape<T>;
  /** The generate line for a module whose target reads differently (Memories names an NPC). */
  target?(name: string, description: string): string;
  /** Reply budget; RoleCall gives Map, Cast and Renown 3500 and the rest 2000. */
  maxTokens?: number;
}

export interface Line { role: "user" | "assistant" | "system"; content: string }

export interface ItemAsk {
  action: "generate" | "refresh";
  itemName?: string;
  userGuide?: string;
  existing?: unknown;
  characterName: string;
  personaName: string;
  /** Only when the person chose a theme; absent, the prompt asks the model to follow the story. */
  theme?: string;
  /** The recent messages, oldest first (RoleCall's "small" window: the last 10). */
  transcript: readonly Line[];
  subs: Subs;
}

export const HISTORY_WINDOW = 10;
/** The messages a whole-module Refresh reads (RoleCall's TRACKER_REFRESH_HISTORY_WINDOW), with the opening message kept; the caller slices once. */
export const MODULE_REFRESH_WINDOW = 20;
export const ITEM_TEMPERATURE = 0.3;
export const ITEM_MAX_TOKENS = 2000;
export const ITEM_SYSTEM = "You are a precise JSON generator for roleplay game trackers. Generate exactly one item matching the requested schema. Always respond with valid JSON only.";

export interface Messages { system: string; user: string }
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** RoleCall's context block: "Name: text" per message, blank-line rules between. It keeps every line it is given; the caller chose the window. */
export function conversationOf(transcript: readonly Line[], characterName: string, personaName: string): string {
  return transcript
    .filter((m) => m.content && m.content.trim())
    .map((m) => `${m.role === "assistant" ? characterName : m.role === "user" ? personaName : "System"}: ${m.content}`)
    .join("\n\n---\n\n");
}

export function itemMessages(spec: GenSpec, ask: ItemAsk): Messages {
  const noun = spec.description(ask.subs);
  const setting = ask.theme ? `a ${ask.theme} roleplay game` : "a roleplay game";
  const fit = ask.theme ? `Make the entry appropriate for the ${ask.theme} setting` : "Make the entry fit the setting the conversation has established";
  const conversation = conversationOf(ask.transcript, ask.characterName, ask.personaName);
  const context = conversation ? `CONVERSATION CONTEXT:\n${conversation}\n\n---\n\n` : "";
  const schema = spec.schema(ask.subs);
  if (ask.action === "generate") {
    const guide = ask.userGuide ? `\n\nUser guidance: "${ask.userGuide}"` : "";
    const target = spec.target ? spec.target(ask.itemName ?? "", noun) : `Generate a new ${noun} with the name: "${ask.itemName ?? ""}"`;
    return { system: ITEM_SYSTEM, user: `You are generating a ${noun} for ${setting}.

CHARACTER: ${ask.characterName}
PLAYER: ${ask.personaName}

${context}

${target}${guide}

The item must match this exact JSON schema:
${schema}

IMPORTANT:
- Generate ONLY valid JSON matching the schema above
- Use the conversation context to inform the generation
- ${fit}
- Do NOT include markdown code blocks
- Respond with ONLY the JSON object, nothing else` };
  }
  const guide = ask.userGuide ? `\n\nUser guidance for the update: "${ask.userGuide}"` : "";
  return { system: ITEM_SYSTEM, user: `You are regenerating/updating a ${noun} for ${setting}.

CHARACTER: ${ask.characterName}
PLAYER: ${ask.personaName}

${context}

Current ${noun}:
${JSON.stringify(ask.existing, null, 2)}${guide}

Regenerate this ${noun} based on the conversation context and any user guidance.

The updated item must match this exact JSON schema:
${schema}

IMPORTANT:
- Generate ONLY valid JSON matching the schema above
- Keep the same identity/name but update details based on context
- ${fit}
- Do NOT include markdown code blocks
- Respond with ONLY the JSON object, nothing else` };
}

/** The answer read once: a JSON object that becomes the module's item, or a reason. */
export function parseItem<T>(spec: GenSpec<T>): (text: string) => Read<T> {
  return (text) => {
    const answer = extractObject(text);
    if (!isRecord(answer)) return { ok: false, error: "the answer is not a JSON object" };
    const item = spec.item.coerce(answer);
    return item === null ? { ok: false, error: "the answer is missing a field the item needs" } : { ok: true, value: item };
  };
}

/** The one repair request: the same task, the answer that could not be used, and why. */
export const repairItem = (first: Messages, answer: string, error: string): Messages =>
  ({ system: first.system, user: `${first.user}\n\nYour previous answer could not be used (${error}):\n\n${answer.slice(0, 2000)}\n\nAnswer again with only the JSON object.` });
