/**
 * The forecast route (rc-parity 08, the Context wing's Next send): `POST /api/chats/forecast` answers the request a send of `draft` would build (studio/scene-forecast.ts).
 * It never writes to the scene and asks no model. The body is read once into a known type; a request that does not fit it is a 400, a scene with no usable connection is the
 * same 409 a send gets, and nothing is ever an empty success. A POST because the draft is the person's own words and does not belong in a URL.
 * `POST /api/chats/formula-try` is the same build with a formula's text run read-only on a copy of its macro context (the formula editor's Try).
 */
import { str } from "../core/guards";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { StateStore } from "../stage/contracts/state-store";
import { StudioValidationError } from "../studio/errors";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import { assembleExtensionPromptPreview, EXTENSION_PROMPT_PREVIEW_LABEL, forecastRequest, tryFormula, type ForecastDeps } from "../studio/scene-forecast";
import { SANITY_TEXT } from "../entities/_shared/sanity";
import { narratorTools } from "../studio/library-tools";
import { lorebookReader, type ReadLorebook } from "../studio/scene-lore";
import { presetReader, type ReadPreset } from "../studio/scene-turn-load";
import { choiceDefaultsOf, promptBudgetOf, toolBudgetOf } from "./server-scene-readers";
import { connect } from "../kit/providers/scene-connect";
import { json } from "./server-security";
import type { LibraryHandle } from "./library-root";

type Body = Record<string, unknown>;

/** The formula Try route: the same build as the forecast, then the formula run read-only on a copy of the scene's macro context. */
const FORMULA_TRY = "/api/chats/formula-try";

/** A draft is at most this long; a larger body is refused rather than assembled. */
const DRAFT_MAX = 100_000;

/** A local, read-only prompt preview over the currently unlocked canonical scene and library. */
export function createExtensionPromptPreviewer(studio: StudioStoreLike, settings: SettingsStoreLike | undefined, library: LibraryHandle | undefined) {
  return async (sceneId: string, draft: string, signal: AbortSignal) => {
    if (signal.aborted) throw new StudioValidationError("Prompt preview was cancelled.");
    const opened = library?.opened();
    if (!opened || opened.state !== "unlocked" || !opened.stateStore) throw new StudioValidationError("An unlocked library is required for prompt preview.");
    const choiceDefaults = choiceDefaultsOf(settings);
    const deps: ForecastDeps = {
      chats: opened.chats, state: opened.stateStore, connect, readPreset: presetReader(studio), readLorebook: lorebookReader(studio),
      readLibrary: (kind, id) => studio.read(kind, id),
      ...(choiceDefaults ? { choiceDefaults } : {}),
      ...(promptBudgetOf(settings) ? { promptBudgetMs: promptBudgetOf(settings)! } : {}),
      ...(toolBudgetOf(settings) ? { toolBudgetMs: toolBudgetOf(settings)! } : {}),
      narratorTools: narratorTools((kind, id) => studio.read(kind, id)), now: Date.now, randomSeed: () => Math.floor(Math.random() * 2 ** 31),
    };
    const preview = await assembleExtensionPromptPreview(deps, { chatId: sceneId, draft });
    if (signal.aborted) throw new StudioValidationError("Prompt preview was cancelled.");
    return { ...preview, label: EXTENSION_PROMPT_PREVIEW_LABEL as typeof EXTENSION_PROMPT_PREVIEW_LABEL };
  };
}

export function createPromptScenesReader(library: LibraryHandle | undefined) {
  return async () => {
    const opened = library?.opened();
    if (!opened || opened.state !== "unlocked") throw new StudioValidationError("An unlocked library is required for scene selection.");
    return (await opened.chats.listChats()).chats.slice(0, 500).map(({ id, title }) => ({ id, title: title.slice(0, 256) }));
  };
}

/** The forecast route, or null when the path is not it. */
export async function handleForecastRoute(req: Request, p: string, chats: ChatStore, state: StateStore, readPreset: ReadPreset, readLorebook: ReadLorebook, b: Body | null, studio?: StudioStoreLike, settings?: SettingsStoreLike): Promise<Response | null> {
  if ((p !== "/api/chats/forecast" && p !== FORMULA_TRY) || req.method !== "POST" || !b) return null;
  const chatId = str(b["chatId"]);
  if (!chatId) throw new StudioValidationError("chatId is required");
  const deps: ForecastDeps = { chats, state, connect, readPreset, readLorebook, readLibrary: studio ? (kind, id) => studio.read(kind, id) : undefined, ...(choiceDefaultsOf(settings) ? { choiceDefaults: choiceDefaultsOf(settings)! } : {}), ...(promptBudgetOf(settings) ? { promptBudgetMs: promptBudgetOf(settings)! } : {}), ...(toolBudgetOf(settings) ? { toolBudgetMs: toolBudgetOf(settings)! } : {}), narratorTools: narratorTools(studio ? (kind, id) => studio.read(kind, id) : undefined), now: Date.now, randomSeed: () => Math.floor(Math.random() * 2 ** 31) };
  if (p === FORMULA_TRY) {
    const text = b["text"];
    if (typeof text !== "string" || text.length > SANITY_TEXT) throw new StudioValidationError("text must be the formula, as text");
    return json(await tryFormula(deps, { chatId, text }));
  }
  const draft = b["draft"];
  if (typeof draft !== "string" || draft.length > DRAFT_MAX) throw new StudioValidationError(`draft must be text of at most ${DRAFT_MAX} characters`);
  return json(await forecastRequest(deps, { chatId, draft }));
}
