/**
 * The Next send forecast (rc-parity 08, slice 5; RoleCall's `PromptPreviewPanel` over `api/chat/preview-prompt`): the request the scene would send if the person sent this
 * message now. It is the reply turn's own build (scene-turn-build.ts: prepare, assemble, shape) run over the loaded scene with the draft as the message being answered, so
 * it cannot drift from a send the way RoleCall's second assembly path does. It writes nothing (no checkpoint, no variable, no meter lesson), asks no model, and says what it leaves
 * out: the Compendium's recall is a model call that only a real send makes, and a scene's prompt regex runs in the page's sandbox worker during a send.
 */
import { TOOL_BUDGET_MS_DEFAULT } from "../core/assembly/tool-rounds";
import { resolveCompendium } from "../core/compendium/defaults";
import { runFormulaReadOnly } from "../core/formula";
import { countPrompt, countText, estimateFor } from "../core/tokens";
import type { ProviderRole } from "../stage/contracts/provider";
import type { StateStore } from "../stage/contracts/state-store";
import type { ContentStore } from "../stage/contracts/content-store";
import type { ChatStore } from "../stage/contracts/chat-store";
import { assertStudioEntityKind } from "./path-policy";
import { safeParseCanonicalEntity, type ParsedCanonicalEntity } from "../entities/runtime-schema";
import { StudioConflictError, StudioNotFoundError } from "./errors";

import { NoConnectionError, type TurnDeps } from "./scene-turn";
import { assembleRequest, overflowMessage, prepareRequest, shapeRequest } from "./scene-turn-build";
import { sentTools, toolTurn } from "./scene-turn-tools";
import { turnWrites } from "./scene-turn-writes";
import { loadTurn, type LoadedTurn, type TurnReader } from "./scene-turn-load";
import { composeBookPhase } from "./book-phase";
import { replyPhase } from "../core/promptbook";
import { MAX_EXTENSION_PROMPT_SCENES, MAX_VALUE_BYTES } from "../extensions/contracts/limits";
import { presetReader } from "./scene-turn-load";
import { lorebookReader } from "./scene-lore";
import { resolvePromptAttachments } from "./scene-turn-attachments";
import { hasUnpricedPromptMedia, type PromptAttachmentInfo } from "../core/media/prompt-attachment";

export interface ForecastDeps extends Pick<TurnDeps, "connect" | "readPreset" | "readAsset" | "readLorebook" | "readLibrary" | "choiceDefaults" | "promptBudgetMs" | "clock" | "narratorTools" | "toolBudgetMs" | "now" | "randomSeed"> {
  chats: TurnReader;
  state: Pick<StateStore, "read">;
}

export type ExtensionPromptPreviewDeps = Pick<ForecastDeps, "readPreset" | "readLorebook" | "readLibrary" | "choiceDefaults" | "promptBudgetMs" | "clock" | "now" | "randomSeed"> & {
  chats: TurnReader;
  state: Pick<StateStore, "read">;
};

export interface Forecast {
  /** The request as the provider would get it, each message with the assembler's own count. */
  messages: { role: ProviderRole; content: string; tokens: number }[];
  files: PromptAttachmentInfo[];
  mediaEstimateIncomplete: boolean;
  /** The turn's own estimate for the whole request: the number the Prompt Inspector's pause shows as "about N tokens". */
  tokens: number;
  window: { context: number; reply: number; stated: boolean };
  model: string;
  /** What a send adds that a forecast does not run. */
  notes: string[];
}

export const EXTENSION_PROMPT_PREVIEW_MAX_BYTES = MAX_VALUE_BYTES;
export const EXTENSION_PROMPT_PREVIEW_LABEL = "Local prompt preview; no model called; unshaped and unbudgeted.";

export interface ExtensionPromptPreviewRequest {
  sceneId: string;
  messages: { role: ProviderRole; content: string }[];
}
export type ContentExtensionPromptPreview = ExtensionPromptPreviewRequest & { label: typeof EXTENSION_PROMPT_PREVIEW_LABEL };

export async function listExtensionPromptScenes(chats: Pick<ChatStore, "listChats">): Promise<{ id: string; title: string }[]> {
  const { chats: stored } = await chats.listChats();
  return [...stored].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_EXTENSION_PROMPT_SCENES).map(({ id, title }) => ({ id, title: title.slice(0, 256) }));
}

/** The scene read for a request build: the scene and its whole take as history, with nothing yet being answered. */
async function readScene(deps: Pick<ExtensionPromptPreviewDeps, "chats" | "readPreset" | "readLorebook" | "readLibrary" | "choiceDefaults" | "now">, chatId: string) {
  const chat = await deps.chats.getChat(chatId);
  if (!chat) throw new StudioNotFoundError("that scene does not exist");
  const read = await loadTurn(deps.chats, chat.id, "draft", deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
  if (!read) throw new StudioNotFoundError("that scene does not exist");
  return { chat, read, started: deps.now() };
}

/** Builds a Browser/Terminal preview adapter from their canonical stores without requiring a provider owner. */
export function createContentExtensionPromptPreviewer(chats: ChatStore, state: Pick<StateStore, "read">, content: Pick<ContentStore, "readLight">): (sceneId: string, draft: string) => Promise<ContentExtensionPromptPreview> {
  const read = async (kind: string, id: string): Promise<ParsedCanonicalEntity | null> => {
    const entity = (await content.readLight(assertStudioEntityKind(kind), id))?.entity;
    if (entity === undefined) return null;
    const parsed = safeParseCanonicalEntity(entity);
    return parsed.ok ? parsed.entity : null;
  };
  const reader = { read };
  const deps: ExtensionPromptPreviewDeps = {
    chats, state, readPreset: presetReader(reader), readLorebook: lorebookReader(reader), readLibrary: read,
    now: Date.now, randomSeed: () => Math.floor(Math.random() * 2 ** 31),
  };
  return async (sceneId: string, draft: string): Promise<ContentExtensionPromptPreview> => ({
    ...await assembleExtensionPromptPreview(deps, { chatId: sceneId, draft }), label: EXTENSION_PROMPT_PREVIEW_LABEL,
  });
}

/** Builds the same assembled scene request as a send, with a local draft and no model/window/budget. */
export async function assembleExtensionPromptPreview(deps: ExtensionPromptPreviewDeps, input: { chatId: string; draft: string }): Promise<ExtensionPromptPreviewRequest> {
  if (new TextEncoder().encode(input.draft).byteLength > EXTENSION_PROMPT_PREVIEW_MAX_BYTES) throw new StudioConflictError("The local prompt preview draft exceeds its byte limit.");
  const { chat, read, started } = await readScene(deps, input.chatId);
  const loaded: LoadedTurn = { ...read, current: { ...read.current, role: "user", content: input.draft } };
  const prep = await prepareRequest(deps, chat, loaded, undefined, "", started);
  const built = await assembleRequest(deps, { chat, loaded, prep, started, kind: "reply", original: "", guidance: "", unbudgeted: true });
  const messages = built.result.messages.map(({ role, content }) => ({ role, content }));
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > EXTENSION_PROMPT_PREVIEW_MAX_BYTES) throw new StudioConflictError("The assembled local prompt preview exceeds its byte limit.");
  return { sceneId: chat.id, messages };
}

/** The turn a send of the draft would build, up to its assembled request: what the forecast reads, so it cannot drift from a send. */
async function draftedTurn(deps: ForecastDeps, input: { chatId: string; draft: string }) {
  const initial = await readScene(deps, input.chatId);
  let { chat } = initial;
  const { read, started } = initial;
  if (!chat.connection) throw new NoConnectionError();
  let connected = await deps.connect(chat.connection);
  if (!connected) throw new NoConnectionError("this scene's connection is gone from Kit; pick another in the AI wing");
  let model = chat.connection.model;
  // The take so far is the history and the draft is the message being answered, as it will be once sent.
  let loaded: LoadedTurn = { ...read, current: { id: "forecast", role: "user", content: input.draft, at: deps.now() } };
  if (loaded.promptbook) {
    const prepared = await composeBookPhase(deps, chat, loaded, replyPhase(loaded.promptbook), [], turnWrites(deps.now), false, true);
    loaded = prepared.loaded;
    chat = { ...prepared.chat, regex: { ...prepared.chat.regex, sets: prepared.regex } };
    if (prepared.connection) { connected = await deps.connect(prepared.connection); model = prepared.connection.model; chat.connection = prepared.connection; }
    if (!connected) throw new NoConnectionError("The reply phase's model is unavailable.");
  }
  const prep = await prepareRequest(deps, chat, loaded, connected, model, started);
  // The tool definitions a send would carry are reserved by the budget the same way (the tools are made, never called).
  const tools = await toolTurn(deps.narratorTools, "reply", chat, loaded, deps.randomSeed(), turnWrites(deps.now), await deps.toolBudgetMs?.());
  const built = await assembleRequest(deps, { chat, loaded, prep, started, kind: "reply", original: "", guidance: "", reserved: sentTools(tools, connected).map((t) => JSON.stringify(t)) });
  if (built.result.budget.overflow) throw new StudioConflictError(overflowMessage(built.result));
  return { chat, loaded, prep, built, connected, model, started };
}

export async function forecastRequest(deps: ForecastDeps, input: { chatId: string; draft: string }): Promise<Forecast> {
  const { chat, loaded, prep, built, connected, model, started } = await draftedTurn(deps, input);
  const sent = await resolvePromptAttachments(shapeRequest({ chat, loaded, kind: "reply", original: "", built, connected }, model, {}), deps.readAsset);
  const trace = built.result.trace;
  const messages = sent.messages.map((m, i) => ({ role: m.role, content: m.content, tokens: i < trace.length && built.asked[i]?.content === m.content ? trace[i]!.tokens : countText(m.content) }));
  const compendium = resolveCompendium(chat.compendium);
  const notes = [
    ...(loaded.promptbook ? [`Promptbook: ${loaded.promptbook.phases.filter((p) => p.enabled).length} enabled phases. This forecast estimates the reply only; earlier phase outputs and dice rolls are generated when you send.`] : []),
    ...(compendium.on && compendium.recall.on ? ["The Compendium's recall is not run for a forecast; its entries are added when you send."] : []),
    ...((chat.regex?.sets?.length ?? 0) > 0 ? ["Prompt regex runs when you send; this forecast shows the request before it."] : []),
    ...(sent.files.some((file) => file.kind === "image" || file.kind === "pdf") ? ["The estimate counts attached text files but not image or PDF media tokens, so the provider may count more than shown."] : []),
  ];
  return {
    messages,
    files: sent.files,
    mediaEstimateIncomplete: hasUnpricedPromptMedia(sent.files),
    tokens: estimateFor(prep.meter, prep.key, countPrompt(sent.messages.map((m) => m.content)), started).mid,
    window: { context: prep.window.context, reply: prep.window.reply, stated: prep.window.stated },
    model,
    notes,
  };
}

/** A formula's run on a scene: its text, or why it stopped, and how long it took. */
export type FormulaTry = ({ ok: true; text: string } | { ok: false; error: string }) & { ms: number };

/**
 * Runs formula text on a copy of the scene's macro context as the scene stands (readScene, the same assembler a send runs), through the read-only formula path and inside the
 * tool time budget, so Try says what a tool call would. It writes nothing and asks no model; it needs no connection and no window to fit.
 */
export async function tryFormula(deps: ForecastDeps, input: { chatId: string; text: string }): Promise<FormulaTry> {
  // The formula asks no model, so the scene is built as it stands (its whole take is history, nothing is being answered) without a connection or a window to fit.
  const { chat, read, started } = await readScene(deps, input.chatId);
  const prep = await prepareRequest(deps, chat, read, undefined, "", started);
  const built = await assembleRequest(deps, { chat, loaded: read, prep, started, kind: "reply", original: "", guidance: "", unbudgeted: true });
  const clock = deps.clock ?? (() => performance.now());
  const began = clock();
  const budget = (await deps.toolBudgetMs?.()) ?? TOOL_BUDGET_MS_DEFAULT;
  const out = runFormulaReadOnly(input.text, built.result.expansion.context, deps.randomSeed() + 1, { at: began + budget, now: clock });
  const ms = Math.max(0, Math.round(clock() - began));
  return "error" in out ? { ok: false, error: out.error, ms } : { ok: true, text: out.text, ms };
}
