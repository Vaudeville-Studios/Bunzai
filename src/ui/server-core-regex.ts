/**
 * A Core scene's prompt regex (studio/scene-turn-regex.ts promptRegex, for rp-core): the rules are imported
 * data that run only in the page's sandbox worker, so rp-core's request hook sends the page the conversation
 * messages and the rules as a "regex" event and waits for its answer before anything is sent. It fails closed,
 * as the old turn does. Only rp-core's own history messages are offered: preset blocks, notes and lore are not
 * conversation, and a message rp-core folded a system note into is left as it is rather than let a rule touch
 * the note.
 */
import type { HostHooks, PromptMsg } from "rp-core";
import { restoreEscapedBraces } from "../core/macros/normalize";
import { promptDepths, sceneRules, type SceneSet } from "../core/regex/scene-pass";
import type { RegexSetBody } from "../entities/regex/schema";
import type { TurnEvent } from "../studio/scene-turn-events";
import { awaitRegex, type RegexItem } from "../studio/scene-turn-regex";
import type { TurnRuntime } from "../studio/scene-turn-runtime";

const isHistory = (message: PromptMsg): boolean => message.src.split("+").every((src) => src === "history" || src.startsWith("history:"));
const textOf = (message: PromptMsg): string => message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");

export function corePromptRegex(input: {
  chatId: string; setIds: readonly string[] | undefined; readRegex: ((id: string) => Promise<RegexSetBody | null>) | undefined;
  runtime: TurnRuntime; names: { user: string; char: string }; emit(event: TurnEvent): void;
}): HostHooks["transformRequest"] | undefined {
  if (!input.setIds?.length || !input.readRegex) return undefined;
  return async (request, context) => {
    const sets: SceneSet[] = [];
    for (const id of input.setIds!) {
      const body = await input.readRegex!(id).catch(() => null);
      if (body) sets.push({ id, rules: body.rules, enabled: body.enabled !== false });
    }
    const rules = sceneRules(sets, "prompt");
    const depths = promptDepths(request.messages.map((message) => ({ role: message.role, chat: isHistory(message) })));
    const items: RegexItem[] = [];
    depths.forEach((depth, index) => {
      const message = request.messages[index]!, text = textOf(message);
      if (depth !== null && text !== "") items.push({ index, role: message.role as "user" | "assistant", depth, text });
    });
    if (rules.length === 0 || items.length === 0) return { edits: [] };
    input.emit({ type: "regex", turnId: context.turnId, rules, items, macros: input.names });
    const answer = await awaitRegex(input.runtime, context.turnId, input.chatId, context.signal);
    if (answer.kind === "cancel") throw new Error("The page left before this scene's regex ran, so nothing was sent.");
    if (answer.kind === "failed") throw new Error(`This scene's regex could not run, so nothing was sent. ${answer.error}`);
    // A replacement's own macros are the names here (rp-core expands no macros in history text); captured braces come back.
    const macroRules = rules.some((rule) => rule.replace.includes("{{"));
    const names = (text: string) => text.replace(/\{\{\s*user\s*\}\}/gi, input.names.user).replace(/\{\{\s*char\s*\}\}/gi, input.names.char);
    const edits: { index: number; text: string }[] = [];
    for (const [key, text] of Object.entries(answer.texts)) {
      const item = items.find((candidate) => String(candidate.index) === key);
      if (!item || typeof text !== "string") throw new Error("This scene's regex answered for a message it was not asked about, so nothing was sent.");
      if (text !== item.text) edits.push({ index: item.index, text: macroRules ? restoreEscapedBraces(names(text)) : text });
    }
    return { edits };
  };
}
