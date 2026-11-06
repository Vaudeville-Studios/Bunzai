/** A Promptbook phase composes existing library pieces and the scene assembler; all writes belong to the reply checkpoint. */
import type { BookPhase } from "../entities/promptbook/schema";
import type { Delta } from "../core/scene-state/types";
import type { AgentBody } from "../entities/agent/schema";
import type { ScriptSheetBody } from "../entities/scriptsheet/schema";
import type { DiceBody } from "../entities/dice/schema";
import type { TrackerBody } from "../entities/tracker/schema";
import { rollDicePiece } from "../core/dice-piece";
import { mulberry32 } from "../core/lore/rng";
import { fold } from "../core/scene-state/fold";
import { slotOf } from "../generated/slots";
import { varsOf } from "../core/scene-state/vars-bridge";
import { varsDeltas } from "../core/scene-state/vars-bridge";
import { globalDeltas } from "../core/scene-state/globals";
import { phaseVerdict, replyPhase } from "../core/promptbook";
import { sheetPrompts } from "../core/preset/script-sheet";
import type { LoreScan } from "../core/lore/engine";
import { readPiece } from "./library-tools";
import { linkedSkills } from "./library-skills";
import { linkedTrackers } from "./library-trackers";
import { prepareRequest, assembleRequest, shapeRequest, overflowMessage } from "./scene-turn-build";
import { toolTurn, sendReply, sentTools, withToolCalls } from "./scene-turn-tools";
import { promptRegex } from "./scene-turn-regex";
import { StudioValidationError } from "./errors";
import type { Chat, JsonObject } from "../stage/contracts/chat-store";
import type { LoadedTurn, TurnKind } from "./scene-turn-load";
import type { TurnDeps, Connected, TurnEvent } from "./scene-turn";
import type { TurnWrites } from "./scene-turn-writes";
import { awaitReview, applyEdits } from "./scene-turn-review";
import { countPrompt } from "../core/tokens";
import { skillDelta } from "../core/skill";
import { readBookRun, type PhaseRun } from "../core/promptbook-run";
import { slotNonce, slotPlaceholder } from "../core/assembly/feature-slots";
import { sendProblem } from "../core/writing";
import { splitReasoning } from "../core/reasoning-tags";
import { resolvePromptAttachments } from "./scene-turn-attachments";
import { hasUnpricedPromptMedia } from "../core/media/prompt-attachment";

export type { PhaseRun } from "../core/promptbook-run";
export class BookCancelledError extends Error {}
export function bookScan(loaded: LoadedTurn, now: number): LoreScan {
  const identity = loaded.character.identity;
  return { messages: [...loaded.history, loaded.current], messageCount: loaded.history.length + 1, character: { name: identity.name, tags: [], description: identity.description ?? "", personality: "", scenario: "" }, persona: loaded.persona?.name ?? "", generationType: "normal", variables: {}, now };
}
export async function composeBookPhase(deps: Pick<TurnDeps, "readLibrary" | "randomSeed">, chat: Chat, loaded: LoadedTurn, phase: BookPhase, runs: readonly PhaseRun[], writes: TurnWrites, continuing = false, preview = false): Promise<{ chat: Chat; loaded: LoadedTurn; connection: Chat["connection"]; regex: string[] }> {
  const read = deps.readLibrary ?? (async () => null);
  const required = async <T>(kind: string, id: string): Promise<T> => {
    const body = await readPiece(read, kind, id);
    if (!body) throw new StudioValidationError(`${phase.name}: the linked ${kind} "${id}" is missing or unreadable. Repair this card before playing.`);
    return body as T;
  };
  const agent = phase.agentId ? await required<AgentBody>("agent", phase.agentId) : undefined;
  const state = fold(loaded.bookState ?? {}, writes.pending(), slotOf);
  const cards = phase.cards.filter((c) => c.enabled && (!c.condition || phaseVerdict({ ...phase, enabled: true, condition: c.condition }, bookScan(loaded, loaded.current.at ?? 0), mulberry32(deps.randomSeed())).on));
  const ids = (kind: string) => cards.filter((c) => c.kind === kind).map((c) => c.pieceId);
  const prompts = [...phase.preset.prompts];
  const literalPrompts: Record<string, string> = Object.create(null);
  const nonce = slotNonce();
  const skillSlots = new Map<string, string[]>();
  const insert = (id: string, name: string, content: string) => {
    const base = sheetPrompts(content)[0]!;
    const block = { ...base, id, name, content, enabled: true, marker: false, role: "system" as const, placement: "relative", injectionDepth: 0, injectionOrder: 0 };
    const at = prompts.findIndex((p) => p.id === id);
    if (at >= 0) throw new StudioValidationError(`${phase.name}: a card and a prompt block share the id ${id}. Give them different ids.`);
    prompts.splice(Math.max(0, prompts.findIndex((p) => p.id === "chatHistory")), 0, block);
  };
  if (agent) insert("book-agent", agent.name, agent.instructions);
  const rand = mulberry32(deps.randomSeed());
  let previousPrompt: string | null = null;
  for (const card of cards) {
    let context: { name: string; text: string } | undefined;
    if (card.kind === "scriptsheet") { const sheet = await required<ScriptSheetBody>(card.kind, card.pieceId); const problem = sendProblem(card.kind, sheet); if (problem) throw new StudioValidationError(`${phase.name}: ${problem}`); context = { name: sheet.name, text: sheet.content }; }
    if (card.kind === "skill") { const slot = `skill:${card.id}`; skillSlots.set(card.pieceId, [...(skillSlots.get(card.pieceId) ?? []), slot]); context = { name: "Skill", text: slotPlaceholder(slot, nonce) }; }
    if (context) {
      const previous = card.joinPrevious && previousPrompt ? prompts.find((p) => p.id === previousPrompt) : undefined;
      if (previous) previous.content += `\n\n${context.text}`;
      else { insert(card.id, context.name, context.text); previousPrompt = card.id; }
    } else previousPrompt = null;
    if (card.kind === "dice") { const dice = await required<DiceBody>(card.kind, card.pieceId); literalPrompts[card.id] = preview ? "Dice roll available when you send." : rollDicePiece(dice, rand).text; insert(card.id, dice.name, "Dice result"); }
    if (card.kind === "regex") await required(card.kind, card.pieceId);
    if (card.kind === "tool") await required(card.kind, card.pieceId);
  }
  for (const from of phase.reads) { const run = runs.find((r) => r.id === from); if (run?.status === "ran") { const id = `book-output-${from}`; literalPrompts[id] = `Notes from ${run.name}:\n${run.text}`; insert(id, `Notes from ${run.name}`, "Phase hand-off"); } }
  const skillIds = [...new Set([...(loaded.skills ?? []).map((s) => s.id), ...ids("skill"), ...(agent?.skills ?? [])])];
  const trackerIds = [...new Set([...(loaded.linkedTrackers ?? []).map((t) => t.id), ...ids("tracker")])];
  for (const id of skillIds) await required("skill", id);
  for (const id of trackerIds) await required("tracker", id);
  const skills = (await linkedSkills(read, skillIds, state)).map((s) => ({ ...s, ...(skillSlots.has(s.id) ? { slots: skillSlots.get(s.id)! } : {}) }));
  const trackers = await linkedTrackers((id) => readPiece(read, "tracker", id) as Promise<TrackerBody | null>, trackerIds, state);
  const toolIds = [...new Set([...ids("tool"), ...(agent?.tools ?? [])])];
  for (const id of toolIds) await required("tool", id);
  const phaseChat: Chat = { ...chat, prompting: { ...chat.prompting, tools: toolIds } };
  const preset = { ...phase.preset, name: phase.name, prompts, samplers: { ...phase.preset.samplers, ...(agent?.temperature !== undefined ? { temperature: agent.temperature } : {}), ...chat.preset?.samplers, ...(phase.maxTokens ? { maxTokens: phase.maxTokens } : {}) } };
  return { chat: phaseChat, loaded: { ...loaded, preset, slotNonce: nonce, literalPrompts, pendingGlobals: writes.pending().filter((d) => d.slot === "global"), localVariables: continuing ? loaded.localVariables : varsOf(state), skills, linkedTrackers: trackers, history: agent?.contextMessages === undefined ? loaded.history : agent.contextMessages === 0 ? [] : loaded.history.slice(-agent.contextMessages) }, connection: phase.connection ?? agent?.connection ?? chat.connection, regex: [...new Set([...(chat.regex?.sets ?? []), ...ids("regex")])] };
}

export async function runBookPhases(a: { deps: TurnDeps; chat: Chat; loaded: LoadedTurn; connected: Connected; role: "private" | "after"; runs: PhaseRun[]; writes: TurnWrites; turnId: string; content?: string; inspect?: boolean; /** Where a phase's writes are kept; absent: the turn's checkpoint. */ save?: (deltas: Delta[]) => Promise<unknown>; signal: AbortSignal; emit(e: TurnEvent): void }): Promise<void> {
  const { deps, loaded, chat, runs, writes, signal } = a;
  for (const phase of loaded.promptbook?.phases.filter((p) => p.role === a.role) ?? []) {
    signal.throwIfAborted();
    const verdict = phaseVerdict(phase, bookScan(loaded, deps.now()), mulberry32(deps.randomSeed()));
    if (!verdict.on) { runs.push({ id: phase.id, name: phase.name, role: phase.role, status: "skipped", why: verdict.why, text: "", request: [] }); continue; }
    a.emit({ type: "phase", name: phase.name, role: phase.role });
    const prepared = await composeBookPhase(deps, chat, loaded, phase, runs, writes);
    const connection = prepared.connection;
    if (!connection) throw new StudioValidationError(`${phase.name} has no model.`);
    const connected = await deps.connect(connection, signal);
    if (!connected) throw new StudioValidationError(`${phase.name}'s model connection is unavailable.`);
    const tools = await toolTurn(deps.narratorTools, "reply", prepared.chat, prepared.loaded, deps.randomSeed(), writes, await deps.toolBudgetMs?.());
    const started = deps.now();
    const prep = await prepareRequest(deps, prepared.chat, prepared.loaded, connected, connection.model, started);
    const built = await assembleRequest(deps, { chat: prepared.chat, loaded: prepared.loaded, prep, started, kind: "reply", original: "", guidance: "", reserved: sentTools(tools, connected).map((t) => JSON.stringify(t)) });
    if (built.result.budget.overflow) throw new StudioValidationError(`${phase.name}: ${overflowMessage(built.result)}`);
    tools.macros.context = built.result.expansion.context;
    const shaped = shapeRequest({ chat: prepared.chat, loaded: prepared.loaded, kind: "reply", original: "", built, connected }, connection.model, {});
    const regex = await promptRegex({ runtime: deps.runtime, setIds: prepared.regex, readRegex: deps.readRegex, trace: built.result.trace, messages: shaped, expansion: built.result.expansion, turnId: a.turnId, chatId: chat.id, signal, emit: a.emit });
    if (regex.stop) throw new StudioValidationError(`${phase.name}: the regex pass was cancelled.`);
    const finalShape = shapeRequest({ chat: prepared.chat, loaded: prepared.loaded, kind: "reply", original: "", built, connected }, connection.model, regex.edits);
    const resolved = await resolvePromptAttachments(finalShape, deps.readAsset);
    let messages = resolved.messages;
    if (a.inspect) {
      a.emit({ type: "review", turnId: a.turnId, messages: messages.map((m) => ({ role: m.role, content: m.content })), files: resolved.files, ...(hasUnpricedPromptMedia(resolved.files) ? { mediaEstimateIncomplete: true } : {}), tokens: countPrompt(messages.map((m) => m.content)).total, tools: sentTools(tools, connected) });
      const decision = await awaitReview(deps.runtime, a.turnId, chat.id, signal);
      if (decision.kind === "cancel") throw new BookCancelledError();
      messages = applyEdits(messages, decision.edits);
    }
    const deltas = [...writes.pending(), ...varsDeltas(built.result.local, started), ...globalDeltas(built.result.globalWrites, started, () => crypto.randomUUID()), ...(built.result.skills ?? []).filter((s) => s.close).map((s) => skillDelta(s.id, false, started))];
    const keep = a.save ?? ((all: Delta[]) => deps.chats.saveCheckpoint(a.turnId, { content: a.content ?? "", deltas: all }));
    await keep(deltas);
    writes.open(deltas, keep);
    const completion = await sendReply(connected, { model: connection.model, messages, options: prep.options }, { signal, onEvent: () => undefined }, tools, deps.now);
    signal.throwIfAborted();
    const request = withToolCalls(tools, {}, { texts: messages.map((m) => m.content), ...(resolved.files.length ? { files: resolved.files } : {}) }).request;
    const promptTokens = tools.rounds > 0 ? tools.tokens.prompt : completion.usage?.promptTotal;
    const outputTokens = tools.rounds > 0 ? tools.tokens.output : completion.usage?.output;
    runs.push({ id: phase.id, name: phase.name, role: phase.role, status: "ran", why: verdict.why, text: splitReasoning(completion.content, prep.reasoningFormat).reply, request: request.texts, ...(request.files ? { files: request.files } : {}), model: completion.model ?? connection.model, ms: deps.now() - started, ...(promptTokens !== undefined ? { promptTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) });
  }
}
export const bookTrace = (runs: readonly PhaseRun[], status: "running" | "complete" | "stopped" = "complete"): JsonObject => JSON.parse(JSON.stringify({ status, phases: runs })) as JsonObject;
export async function continuedBookRuns(deps: TurnDeps, loaded: LoadedTurn): Promise<PhaseRun[]> {
  if (!loaded.target) return [];
  const trace = await deps.chats.swipeTrace(loaded.target.id, loaded.target.swipes[loaded.target.current]!.id);
  const book = readBookRun(trace?.["book"]);
  if (!book) {
    if (loaded.promptbook?.phases.some((p) => p.reads.length > 0)) throw new StudioValidationError("This reply has no saved Promptbook notes. Make a new version before continuing it.");
    return [];
  }
  return book.phases.filter((r) => r.role === "private" && loaded.promptbook?.phases.some((p) => p.id === r.id && p.role === "private"));
}
/** Prepares the reply after its private phases, preserving the existing scene runner as the owner of streaming and commit. */
export async function prepareBookReply(a: { deps: TurnDeps; chat: Chat; loaded: LoadedTurn; connected: Connected; model: string; runs: PhaseRun[]; writes: TurnWrites; turnId: string; kind: TurnKind; inspect?: boolean; signal: AbortSignal; emit(e: TurnEvent): void }): Promise<{ chat: Chat; loaded: LoadedTurn; connected: Connected; model: string }> {
  if (!a.loaded.promptbook) return a;
  const { deps, writes, runs } = a;
  writes.open([], (deltas) => deps.chats.saveCheckpoint(a.turnId, { content: "", deltas }));
  if (a.kind === "continue") runs.push(...await continuedBookRuns(deps, a.loaded));
  else await runBookPhases({ ...a, role: "private" });
  const phase = replyPhase(a.loaded.promptbook);
  const prepared = await composeBookPhase(deps, a.chat, a.loaded, phase, runs, writes, a.kind === "continue");
  const chat: Chat = { ...prepared.chat, regex: { ...prepared.chat.regex, sets: prepared.regex } };
  let connected = a.connected;
  let model = a.model;
  if (prepared.connection && (prepared.connection.id !== a.chat.connection?.id || prepared.connection.model !== model)) {
    const next = await deps.connect(prepared.connection, a.signal);
    if (!next) throw new StudioValidationError(`${phase.name}'s model connection is unavailable.`);
    connected = next; model = prepared.connection.model; chat.connection = prepared.connection;
  }
  a.emit({ type: "phase", name: phase.name, role: "reply" });
  return { loaded: prepared.loaded, chat, connected, model };
}
