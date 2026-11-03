/**
 * The draft tools: one answer from the scene's own
 * model that lands nowhere. Expand as character writes the person's next message from the take so far;
 * Polish Input, Spellcheck, Correct and Rewrite edit text the caller hands over. Pure of storage: the scene is
 * read through a reader that cannot write, the library's state through `read` alone, so there is no
 * checkpoint, no commit and no variable written, and the caller decides what the text becomes.
 *
 * Expand as character goes through the same assemble, preset window and preset samplers as a reply; only the
 * reply length is capped to a draft's size. The editors send RoleCall's fixed two-message prompts
 * (core/draft-prompts.ts) at its fixed temperatures, since a creative sampler would make a proofread wander.
 */
import { assemble } from "../core/assembly/assemble";
import { appBudgeter } from "../core/assembly/budget-app";
import { cardView } from "../core/assembly/card";
import { lastAsUser, presetWindow, sceneOptions, turnWindow, withPrefill } from "../core/assembly/request";
import { DEFAULT_LORE_SHARE } from "../core/assembly/types";
import {
  cleanReplacement, correctPrompt, polishPrompt, rewritePrompt, spellcheckPrompt,
  type DraftPrompt, type Perspective, type RewriteAction,
} from "../core/draft-prompts";
import type { ToolId } from "../core/final-cut/pass";
import { bodyOf } from "../core/guards";
import { splitReasoning } from "../core/reasoning-tags";
import { resolveReasoning } from "../core/reasoning-capture";
import { readKey } from "../core/tokens";
import { playedBody } from "../entities/character/variant";
import type { CharacterBody } from "../entities/character/schema";
import type { PersonaBody } from "../entities/persona/schema";
import { ProviderError, type ProviderOptions, type ProviderMessage } from "../stage/contracts/provider";
import type { StateStore } from "../stage/contracts/state-store";
import { StudioConflictError, StudioNotFoundError } from "./errors";

import { listGuides, selectedGuides } from "./guides";
import { NoConnectionError, type Connected, type TurnDeps } from "./scene-turn";
import { loadCast, loadTurn, readGlobals, type TurnReader } from "./scene-turn-load";
import { measureFor, readMeter } from "./scene-turn-meter";
import { promptBudget, promptDeadline } from "./scene-turn-build";
import { resolvePromptAttachments } from "./scene-turn-attachments";
import type { PromptMessage } from "./scene-turn-attachments";

/** A draft's reply is at most this long (RoleCall's impersonate cap), whatever the preset allows a reply. */
export const DRAFT_MAX_TOKENS = 2000;

export interface DraftDeps extends Pick<TurnDeps, "connect" | "readPreset" | "readAsset" | "readLorebook" | "readLibrary" | "choiceDefaults" | "promptBudgetMs" | "clock" | "now" | "randomSeed"> {
  chats: TurnReader;
  state: Pick<StateStore, "read">;
}

export type DraftInput = { chatId: string } & (
  | { kind: "impersonate"; brief?: string; perspective?: Perspective }
  /** Polish Input: the person's own draft. */
  | { kind: "polish"; text: string }
  /** Spellcheck in the Correction Tools: a reply, in the character's voice. */
  | { kind: "spellcheck"; text: string }
  | { kind: "correct"; text: string; guideId: string }
  | { kind: "rewrite"; text: string; selected: string; action: RewriteAction; /** The Custom action's own instruction. */ instruction?: string }
);

interface Request {
  messages: PromptMessage[];
  options: ProviderOptions;
  /** How the model marks its reasoning, so it is cut from the answer. */
  reasoning?: Parameters<typeof splitReasoning>[1];
}

const overflow = () => new StudioConflictError("The card and the history alone are longer than this model's window.");

/** Expand as character: the reply's own assembly, ending on the impersonation message. */
async function impersonate(deps: DraftDeps, input: Extract<DraftInput, { kind: "impersonate" }>, connected: Connected, model: string): Promise<Request> {
  const loaded = await loadTurn(deps.chats, input.chatId, "draft", deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
  if (!loaded) throw new StudioNotFoundError("that scene does not exist");
  const chat = (await deps.chats.getChat(input.chatId))!;
  const started = deps.now();
  const base = turnWindow(connected.context);
  const full = presetWindow(base, loaded.preset);
  const reply = Math.min(full.reply, DRAFT_MAX_TOKENS);
  const meter = await readMeter(deps.state);
  const key = readKey(meter, connected.kind, model);
  const budgetMs = await promptBudget(deps);
  const globalVariables = await readGlobals(deps.chats);
  const guides = await selectedGuides(deps.state, chat.prompting?.guides);
  const result = assemble({
    ...loaded,
    globalVariables,
    now: started,
    randomSeed: deps.randomSeed(),
    deadline: promptDeadline(deps, budgetMs),
    window: { context: full.context, reply },
    budgeter: appBudgeter(measureFor(meter, key, started)),
    lore: loaded.lore ? { ...loaded.lore, budgetShare: DEFAULT_LORE_SHARE } : undefined,
    guides,
    ...(chat.prompting?.note ? { note: chat.prompting.note } : {}),
    generationType: "impersonate",
    reasoning: resolveReasoning(loaded.preset?.reasoning, chat.prompting),
    ...(chat.prompting?.keepThinking ? { keepThinking: true } : {}),
    impersonation: { brief: input.brief ?? "", perspective: input.perspective ?? "1st" },
  });
  if (result.budget.overflow) throw overflow();
  const out = withPrefill(result.messages, result.prefill, model);
  const messages = chat.prompting?.lastAsUser ? lastAsUser(out) : out;
  return { messages, options: { ...sceneOptions(loaded.preset, loaded.generation ?? {}, chat.prompting), max_tokens: reply }, reasoning: resolveReasoning(loaded.preset?.reasoning, chat.prompting) };
}

/** The names the editors address: the character's, and the persona's (the player's). */
export async function names(deps: Pick<DraftDeps, "chats" | "readLibrary">, chatId: string): Promise<{ character: string; player: string }> {
  const cast = await loadCast(deps.chats, chatId, deps.readLibrary);
  if (!cast) throw new StudioNotFoundError("that scene does not exist");
  const character = playedBody(bodyOf(cast.snapshot.character) as unknown as CharacterBody, cast.chat.variantId);
  const persona = cast.snapshot.persona ? (bodyOf(cast.snapshot.persona) as unknown as PersonaBody) : undefined;
  return { character: cardView(character).name, player: persona?.name || "User" };
}

/** An editor tool: a fixed system text and the text to work on, at the tool's own temperature. */
async function edit(deps: DraftDeps, input: Exclude<DraftInput, { kind: "impersonate" }>): Promise<Request> {
  const who = await names(deps, input.chatId);
  let prompt: DraftPrompt;
  switch (input.kind) {
    case "polish":
      prompt = polishPrompt(who.player, input.text);
      break;
    case "spellcheck":
      prompt = spellcheckPrompt(who.character, input.text);
      break;
    case "rewrite":
      prompt = rewritePrompt(who.character, input.action, input.text, input.selected, input.instruction);
      break;
    case "correct": {
      const guide = (await listGuides(deps.state)).find((g) => g.id === input.guideId && g.type === "correction");
      if (!guide) throw new StudioNotFoundError("that correction guide is gone");
      prompt = correctPrompt(who.character, guide.content, input.text);
      break;
    }
  }
  return {
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    options: { temperature: prompt.temperature, max_tokens: prompt.maxTokens },
  };
}

/** The per-tool setting a draft reads, when it has one: Correct, and the Rewrite actions by name. */
const toolOf = (input: DraftInput): ToolId | null => (input.kind === "correct" ? "correct" : input.kind === "rewrite" ? input.action : null);

/** One answer for the person to review. Errors are a turn's: a missing scene or connection, a provider failure, or a model that said nothing. */
export async function runDraft(deps: DraftDeps, input: DraftInput, signal?: AbortSignal): Promise<{ text: string }> {
  const chat = await deps.chats.getChat(input.chatId);
  if (!chat) throw new StudioNotFoundError("that scene does not exist");
  if (!chat.connection) throw new NoConnectionError();
  const connected = await deps.connect(chat.connection);
  if (!connected) throw new NoConnectionError("this scene's connection is gone from Kit; pick another in the AI wing");
  // Expand as character, Spellcheck and Polish use the scene's own model (plan F11). Correct and the Rewrite actions may be pointed at
  // another model and sampler in the Final Cut wing (ChatStore rule 44, RoleCall's per-tool settings); a tool left alone inherits the scene's.
  const tool = toolOf(input);
  const cfg = tool ? chat.finalCut?.tools?.[tool] : undefined;
  const own = cfg?.connection ? await deps.connect(cfg.connection) : null;
  if (cfg?.connection && !own) throw new StudioConflictError("that tool's connection is gone from Kit; pick another in the Final Cut wing");
  const using = own ?? connected;
  const model = cfg?.connection?.model ?? chat.connection.model;
  const request = input.kind === "impersonate" ? await impersonate(deps, input, connected, model) : await edit(deps, input);
  const options = { ...request.options, ...(cfg?.temperature !== undefined ? { temperature: cfg.temperature } : {}), ...(cfg?.maxTokens !== undefined ? { max_tokens: cfg.maxTokens } : {}) };
  const resolved = await resolvePromptAttachments(request.messages, deps.readAsset);
  const completion = await using.provider.send({ model, messages: resolved.messages, options }, signal ? { signal } : {});
  const reply = splitReasoning(completion.content, request.reasoning).reply;
  const text = input.kind === "rewrite" ? cleanReplacement(reply) : reply.trim();
  if (!text) throw new ProviderError("The model sent back nothing.", { category: "api_error", code: "backend_error", status: 502 });
  return { text };
}
