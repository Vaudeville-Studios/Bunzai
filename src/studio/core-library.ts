/**
 * A Core scene's preset and lorebooks as rp-core reads them (EngineSeams.library). Bunzai keeps every piece
 * encrypted in its own store, so nothing is written to rp-core's library folder: the scene's pieces are read,
 * given the scene's own switches, and translated in memory through the SillyTavern formats both sides already
 * write and read (Bunzai's ST adapters out, rp-core's ST readers in). The scene's note and guides ride in the
 * same preset, where Bunzai's own engine places them (core/assembly/note.ts, guides.ts).
 */
import { createHash } from "node:crypto";
import { stPresetToPreset, worldInfoToLoreBook, type HostHooks, type LibrarySnapshot, type Preset, type PresetBlock } from "rp-core";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { bodyOf } from "../core/guards";
import { resolveSelections } from "../core/macros/choice-groups";
import { injectPersonaXml } from "../core/persona/inject";
import { filledPresetBlocks } from "../core/assembly/preset";
import { decorateMacroValue, prependUserGuides, resolveGuides, type AssemblyGuide, type MacroTarget, type ResolvedGuides } from "../core/assembly/guides";
import { noteDue } from "../core/assembly/note";
import { effectiveToggles, toChoiceGroups, withDefaults } from "../core/preset/choices";
import type { CharacterBody } from "../entities/character/schema";
import { playedBody } from "../entities/character/variant";
import type { PersonaBody } from "../entities/persona/schema";
import type { PresetBody, PresetPrompt } from "../entities/preset/schema";
import stPreset from "../formats/sillytavern/preset";
import stLorebook from "../formats/sillytavern/lorebook";
import type { Chat, ChatStore } from "../stage/contracts/chat-store";
import { resolveBooks, type ReadLorebook } from "./scene-lore";
import type { ReadPreset } from "./scene-turn-load";
import { PresetGoneError } from "./scene-turn-load";
import { WHOLE_BRANCH } from "./scene-branch";
import { resolvePromptAttachments } from "./scene-turn-attachments";
import type { CoreSceneParts } from "./core-turn-plan";

export interface CoreSceneLibrary {
  /** What the session's config names. */
  config: { preset: string; lorebooks: string[] };
  library: LibrarySnapshot;
  /** User-role guides, each put in front of the message being answered (CoreTurnOwner's request hook). */
  userGuides: string[];
  /** The message being answered, as the scene shows it: where the user guides go inside rp-core's shaped request. */
  answering?: string;
  /** The scene's Reasoning Effort on the narrator binding; absent is Auto. */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Send the last message as the user: the request's final message becomes a user turn (withLastAsUser). */
  lastAsUser?: boolean;
  /** What Bunzai's own systems add (core-turn-plan.ts); recall reads what lore placed from it. */
  parts?: CoreSceneParts;
  /** The scene's Max tool rounds, on rp-core's narrator. */
  toolRounds?: number;
}

/** Reasoning Effort values rp-core's binding holds. */
const CORE_REASONING = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

/** Prompting settings a Core scene carries (the guides, the note, Start Reply With and its role, Reasoning Effort, the last message's role, old thinking); the rest are refused by name, never ignored. */
const CORE_PROMPTING: Readonly<Record<string, string | null>> = {
  guides: null, note: null, prefill: null, prefillRole: null, reasoningEffort: null, lastAsUser: null, keepThinking: null,
};

/** Why a prompting change cannot apply to a Core scene, or null when it can. */
export function corePromptingRefusal(patch: unknown): string | null {
  if (!patch || typeof patch !== "object") return null;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null || value === false || (Array.isArray(value) && value.length === 0)) continue;
    const name = CORE_PROMPTING[key];
    if (name) return `${name} is not available on this scene yet`;
    if (key === "reasoningEffort" && typeof value === "string" && !CORE_REASONING.has(value)) return "that reasoning effort is not one this scene knows";
  }
  return null;
}

/**
 * The request hook that puts the scene's user-role guides in front of the message being answered (guides.ts
 * prependUserGuides), over whatever another hook already did to it. Fail-closed in rp-core, as the old turn is.
 * rp-core hands the hook its shaped request, where system notes may already be folded into that user
 * message, so the guides go right before the person's own words, as they do on an old scene.
 */
export function withUserGuides(hooks: HostHooks | undefined, guides: readonly string[], answering?: string): HostHooks | undefined {
  if (!guides.length) return hooks;
  return {
    ...hooks,
    // The guides go on first and the other hook (the scene's prompt regex) reads the guided message, the old turn's order.
    async transformRequest(request, context) {
      const index = request.messages.findLastIndex((message) => message.role === "user" && !message.blocks.some((block) => block.k === "media"));
      if (index < 0) return (await hooks?.transformRequest?.(request, context)) ?? { edits: [] };
      const text = request.messages[index]!.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
      const at = answering ? text.lastIndexOf(answering) : -1;
      const guided = at >= 0 ? text.slice(0, at) + prependUserGuides(text.slice(at), guides) : prependUserGuides(text, guides);
      const messages = request.messages.map((message, i) => (i === index ? { ...message, blocks: [{ k: "text" as const, text: guided }] } : message));
      const after = (await hooks?.transformRequest?.({ messages }, context))?.edits ?? [];
      return { edits: after.some((edit) => edit.index === index) ? after : [{ index, text: guided }, ...after] };
    },
  };
}

/** The request hook for Send the last message as the user (request.ts lastAsUser), over whatever the other hooks did. */
export function withLastAsUser(hooks: HostHooks | undefined, on: boolean | undefined): HostHooks | undefined {
  if (!on) return hooks;
  return {
    ...hooks,
    async transformRequest(request, context) {
      const edits = (await hooks?.transformRequest?.(request, context))?.edits ?? [];
      const index = request.messages.length - 1, last = request.messages[index];
      if (!last || last.role === "user") return { edits };
      const text = edits.find((edit) => edit.index === index)?.text ?? last.blocks.flatMap((block) => (block.k === "text" ? [block.text] : [])).join("");
      return { edits: [...edits.filter((edit) => edit.index !== index), { index, text, role: "user" as const }] };
    },
  };
}

export interface CoreSceneReaders {
  readPreset: ReadPreset;
  readLorebook: ReadLorebook;
  /** The scene's switched-on guides from the guide library (studio/guides.ts selectedGuides). */
  readGuides(ids: readonly string[] | undefined): Promise<AssemblyGuide[]>;
  choiceDefaults?(presetId: string): Promise<Record<string, unknown> | undefined>;
  /** What Bunzai's own systems add to this turn (core-turn-plan.ts). */
  parts?(sceneId: string): Promise<CoreSceneParts | null>;
  readAsset?: Parameters<typeof resolvePromptAttachments>[1];
  /** The rp-core messages behind a message of the scene, every version of it. */
  coreMessages?(sceneId: string, messageId: string): Promise<string[]>;
}

/** The preset id a scene with none picked is given: Bunzai's own no-preset layout (conversation.ts defaultPrompts). */
export const SCENE_DEFAULT_PRESET = "bunzai-default";

const slot = (id: string, content: string): PresetPrompt => ({ id, name: id, content, role: "system", enabled: true, systemPrompt: true, marker: false,
  placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false });
/** core/assembly/conversation.ts defaultPrompts as a preset body, so a scene with no preset is laid out as an old one is. */
const DEFAULT_BODY: PresetBody = {
  name: "Bunzai default",
  prompts: [slot("charDescription", "{{description}}"), slot("charPersonality", "{{personality}}"), slot("scenario", "{{scenario}}"),
    slot("personaDescription", "{{persona}}"), slot("worldInfoBefore", "{{lore}}"), slot("summary", "{{summary}}"),
    slot("dialogueExamples", "{{mesExamples}}"), slot("chatHistory", "{{message_history}}")],
};

/** Bunzai's own macros the fill step writes, in rp-core's words (rp-core reads SillyTavern's set). */
const CORE_MACROS: readonly (readonly [RegExp, string])[] = [
  [/\{\{\s*lore\s*\}\}/gi, "{{lore::before}}{{lore::after}}"],
  [/\{\{\s*(?:summary|chatsummary)\s*\}\}/gi, "{{recap}}"],
  [/\{\{\s*message_history\s*\}\}/gi, "{{history}}"],
];

/** The card macros a macro-aimed guide decorates (guides.ts decorateMacroValue), as rp-core spells them. */
const DECORATED: readonly (readonly [MacroTarget, RegExp, string])[] = [
  ["description", /\{\{\s*description\s*\}\}/gi, "{{description}}"],
  ["personality", /\{\{\s*personality\s*\}\}/gi, "{{personality}}"],
  ["scenario", /\{\{\s*scenario\s*\}\}/gi, "{{scenario}}"],
  ["summary", /\{\{\s*recap\s*\}\}/gi, "{{recap}}"],
];

/**
 * Bunzai counts an in-chat depth as RoleCall does (0 is just before the current message, conversation.ts);
 * rp-core as SillyTavern does (0 is after it), the same +1 its own RoleCall importer makes (fromRcDepth).
 */
const coreDepth = (rcDepth: number): number => rcDepth + 1;

/** Bunzai placements in rp-core's terms; a glued (append) block becomes its own message at that depth. */
function coreAt(placement: string, depth: number, order: number): PresetBlock["at"] {
  if (placement === "relative") return "relative";
  if (placement === "prepend_preset") return "top";
  if (placement === "append_preset") return "bottom";
  return { depth: coreDepth(depth), order };
}

/** rp-core's own importer gives these ST blocks the card's system prompt and post-history instructions. */
const CARD_OVERRIDES: Readonly<Record<string, PresetBlock["override"]>> = { main: "card_system", jailbreak: "card_post_history" };

/** A block's files as rp-core sends them: text as its words, an image or a PDF as a media part, each its own user message after the block. */
type CoreFiles = ReadonlyMap<string, readonly PresetBlock[]>;

interface SceneAdds { files?: CoreFiles; guides: ResolvedGuides; persona: PersonaBody | undefined; note?: string; noteAt?: PresetBlock["at"]; prefill?: string; prefillRole?: "user" | "system"; keepThinking?: boolean; parts?: CoreSceneParts; covered?: string[] }

/**
 * The scene's preset as rp-core reads it. The blocks are exactly what Bunzai's own engine lays out for
 * this scene: the scene's block switches over the preset's choice answers (assemble.ts), then Bunzai's
 * fill step (core/assembly/preset.ts filledPresetBlocks), so lore, the persona and the card slots land
 * where they do on an old scene; rp-core's ST reader would follow ST's rules there instead. The
 * preset-wide settings (samplers, context, prefill) go through the ST formats both sides already share.
 */
function corePreset(id: string, body: PresetBody, chat: Chat, defaults: Record<string, unknown> | undefined, adds: SceneAdds): Preset {
  // Bunzai seats the persona as its own XML (core/persona/inject.ts), with persona-aimed guides on it; rp-core's {{persona}} is the bare description.
  const personaText = decorateMacroValue(adds.persona ? injectPersonaXml(adds.persona) : "", adds.guides.macro, "persona");
  const groups = toChoiceGroups(body.choices);
  const toggles = chat.preset ? effectiveToggles(groups, resolveSelections(groups, withDefaults(defaults, chat.regex?.choices?.[chat.preset.id])), chat.preset.toggles) : {};
  const own = new Map(body.prompts.map((prompt) => [prompt.id, prompt]));
  const settings = { ...body, samplers: { ...body.samplers, ...chat.preset?.samplers } };
  const wire = wireOf(stPreset.fromCanonical({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id, body: settings }));
  const asRaw = (id: string, content: string, at: PresetBlock["at"]): PresetBlock => ({ id, name: id, role: "system", enabled: true, content, raw: true, at });
  const features = adds.parts?.features ?? {};
  const blocks = filledPresetBlocks(body, toggles).flatMap((block): PresetBlock[] => {
    // A feature marker is where its text goes; with none on, the marker adds nothing.
    if (block.slot) return (features[block.slot] ?? []).map((text, index) => asRaw(`${block.id}:${index}`, text, coreAt(block.placement, block.depth, block.order)));
    const override = own.get(block.id)?.forbidOverrides ? undefined : CARD_OVERRIDES[block.id];
    let content = CORE_MACROS.reduce((text, [macro, core]) => text.replace(macro, core), block.content).replace(/\{\{\s*persona\s*\}\}/gi, () => personaText);
    for (const [target, macro, spelled] of DECORATED) content = content.replace(macro, () => decorateMacroValue(spelled, adds.guides.macro, target));
    return [{
      id: block.id, name: block.name, role: block.role === "assistant" || block.role === "user" ? block.role : "system", enabled: true,
      content, at: coreAt(block.placement, block.depth, block.order), ...(override ? { override } : {}),
    }, ...(adds.files?.get(block.id) ?? []).map((file) => ({ ...file, at: coreAt(block.placement, block.depth, block.order) }))];
  });
  // After the leading system prompts (where the history starts), in Bunzai's order: the note, then the system guide.
  const history = blocks.findIndex((block) => block.at === "relative" && block.content.includes("{{history}}"));
  const lead: PresetBlock[] = [];
  if (adds.note && adds.noteAt === "relative") lead.push({ id: "sceneNote", name: "Scene note", role: "system", enabled: true, content: adds.note, at: "relative" });
  if (adds.guides.system) lead.push({ id: "sceneGuides", name: "Guides", role: "system", enabled: true, content: adds.guides.system, at: "relative" });
  // A feature with no marker in the preset rides after those, and the recaps last, in front of the history they stand in for (assemble.ts).
  const seated = new Set<string>(filledPresetBlocks(body, toggles).flatMap((block) => (block.slot ? [block.slot] : [])));
  for (const [slot, texts] of Object.entries(features)) if (!seated.has(slot)) (texts ?? []).forEach((text, index) => lead.push(asRaw(`scene:${slot}:${index}`, text, "relative")));
  (adds.parts?.recaps ?? []).forEach((text, index) => lead.push(asRaw(`sceneRecap${index}`, text, "relative")));
  blocks.splice(history >= 0 ? history : blocks.length, 0, ...lead);
  if (adds.note && adds.noteAt !== "relative") blocks.push({ id: "sceneNote", name: "Scene note", role: "system", enabled: true, content: adds.note, at: adds.noteAt! });
  adds.guides.depth.forEach((guide, index) => blocks.push({ id: `sceneGuide${index}`, name: "Guide", enabled: true, content: guide.content,
    role: guide.role === "user" || guide.role === "assistant" ? guide.role : "system", at: { depth: guide.depth, order: 100 } }));
  // A user hint or system note is an ordinary last turn, not a continuation (request.ts withPrefill). rp-core's depth 0 is after the current message.
  if (adds.prefill && adds.prefillRole) blocks.push({ id: "scenePrefill", name: "Start Reply With", role: adds.prefillRole, enabled: true, content: adds.prefill, at: { depth: 0, order: 100 } });
  // A chat-start guide runs once per scene for its macros and its text is dropped (assemble.ts); first, so the blocks after it read what it set.
  blocks.unshift(...adds.guides.chatStart.map((guide): PresetBlock => ({ id: `sceneStart${guide.id}`, name: "Chat-start guide", role: "system", enabled: true, content: guide.content, at: "top", once: `chatStart_${guide.id}` })));
  const preset = stPresetToPreset(wire, body.name).value;
  return { ...preset, blocks, ...(adds.prefill && !adds.prefillRole ? { prefill: adds.prefill } : {}), ...(adds.keepThinking ? { keepThinking: true } : {}),
    ...(adds.parts?.summary ? { hostRecap: adds.parts.summary } : {}), ...(adds.covered?.length ? { skipHistory: adds.covered } : {}) };
}

/** The ST JSON an adapter wrote; both adapters always write text. */
function wireOf(output: { text?: string }): unknown {
  if (output.text === undefined) throw new Error("the SillyTavern writer produced no text");
  return JSON.parse(output.text);
}

/** The enabled blocks' files, read and checked once for the whole request (scene-turn-attachments.ts holds the rules and limits). */
async function coreFiles(id: string, body: PresetBody, chat: Chat, defaults: Record<string, unknown> | undefined, readAsset: CoreSceneReaders["readAsset"]): Promise<CoreFiles> {
  const groups = toChoiceGroups(body.choices);
  const toggles = chat.preset ? effectiveToggles(groups, resolveSelections(groups, withDefaults(defaults, chat.regex?.choices?.[chat.preset.id])), chat.preset.toggles) : {};
  const blocks = filledPresetBlocks(body, toggles).filter((block) => block.attachments?.length);
  const resolved = await resolvePromptAttachments(blocks.map((block) => ({ role: "system" as const, content: "", attachments: block.attachments!, attachmentOwner: { id: block.id, name: block.name } })), readAsset);
  const out = new Map<string, PresetBlock[]>();
  resolved.messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const owner = blocks[resolved.sourceIndexes[index]!]!;
    const list = out.get(owner.id) ?? [];
    list.push({ id: `${owner.id}:file${list.length}`, name: "Attachment", role: "user", enabled: true, content: message.content, raw: true, at: "relative",
      media: (message.attachments ?? []).map((file) => (file.kind === "image"
        ? { kind: "image" as const, name: file.name, mime: file.mime, base64: file.dataUri.slice(file.dataUri.indexOf(",") + 1) }
        : { kind: "pdf" as const, name: file.name, mime: "application/pdf", base64: file.base64 })) });
    out.set(owner.id, list);
  });
  return out;
}

export async function coreSceneLibrary(
  chats: Pick<ChatStore, "getChat" | "castSnapshot" | "readMessages">, sceneId: string, readers: CoreSceneReaders,
): Promise<CoreSceneLibrary | null> {
  const chat = await chats.getChat(sceneId), snapshot = await chats.castSnapshot(sceneId);
  if (!chat || !snapshot) return null;
  const character = playedBody(bodyOf(snapshot.character) as unknown as CharacterBody, chat.variantId);
  const persona = snapshot.persona ? (bodyOf(snapshot.persona) as unknown as PersonaBody) : undefined;
  const guides = resolveGuides(await readers.readGuides(chat.prompting?.guides));
  // The note rides by the user messages before the one being answered, hidden ones left out (note.ts noteDue).
  const note = chat.prompting?.note;
  const userMessages = (await chats.readMessages(chat.activeBranchId, { limit: WHOLE_BRANCH })).messages.filter((m) => !m.cut && !m.hidden && m.role === "user");
  const users = userMessages.length;
  const last = userMessages.at(-1);
  const answering = last?.swipes[last.current]?.content;
  const due = noteDue(note, Math.max(0, users - 1)) ? note : undefined;
  // Start Reply With and assistant-role guides replace the preset's own prefill (assemble.ts chatPrefill).
  const prefill = [...(chat.prompting?.prefill?.trim() ? [chat.prompting.prefill] : []), ...guides.prefill.filter((p) => p.trim())].join("\n");
  // The last message as the user makes Start Reply With, the request's last message, that user message whatever its role (request.ts lastAsUser).
  const prefillRole = chat.prompting?.lastAsUser ? "user" as const : chat.prompting?.prefillRole === "user" || chat.prompting?.prefillRole === "system" ? chat.prompting.prefillRole : undefined;
  const parts = await readers.parts?.(sceneId);
  const covered = parts && readers.coreMessages ? (await Promise.all(parts.covered.map((id) => readers.coreMessages!(sceneId, id)))).flat() : [];
  const adds: SceneAdds = { guides, persona, ...(parts ? { parts } : {}), ...(covered.length ? { covered } : {}), ...(prefill ? { prefill } : {}), ...(prefillRole ? { prefillRole } : {}), ...(chat.prompting?.keepThinking ? { keepThinking: true } : {}),
    ...(due ? { note: `[Author's Note: ${due.text}]`, noteAt: due.position === "after_scenario" ? "relative" as const : { depth: coreDepth(due.depth), order: 100 } } : {}) };
  const presetId = chat.preset?.id ?? SCENE_DEFAULT_PRESET;
  let body = DEFAULT_BODY;
  if (chat.preset) {
    const read = await readers.readPreset(chat.preset.id, chat.preset.kind);
    if (!read) throw new PresetGoneError();
    body = read;
  }
  const defaults = chat.preset ? await readers.choiceDefaults?.(chat.preset.id) : undefined;
  const files = await coreFiles(presetId, body, chat, defaults, readers.readAsset);
  const presets: Record<string, unknown> = { [presetId]: corePreset(presetId, body, chat, defaults, { ...adds, ...(files.size ? { files } : {}) }) };
  const lorebooks: Record<string, unknown> = {};
  const books = (await resolveBooks(character, persona, chat.lore, readers.readLorebook)).filter((book) => book.enabled && book.book);
  for (const { id, book } of books) {
    const wire = wireOf(stLorebook.fromCanonical({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "lorebook", id, body: book!.body }));
    lorebooks[id] = worldInfoToLoreBook(wire, book!.name).value;
  }
  const revision = createHash("sha256").update(JSON.stringify([presets, lorebooks])).digest("base64url");
  return { config: { preset: presetId, lorebooks: books.map((book) => book.id) }, library: { revision, presets, lorebooks }, userGuides: guides.user, ...(answering ? { answering } : {}), ...(parts ? { parts } : {}), ...(chat.prompting?.toolRounds ? { toolRounds: chat.prompting.toolRounds } : {}), ...(chat.prompting?.lastAsUser ? { lastAsUser: true } : {}),
    ...(chat.prompting?.reasoningEffort && CORE_REASONING.has(chat.prompting.reasoningEffort) ? { reasoning: chat.prompting.reasoningEffort as NonNullable<CoreSceneLibrary["reasoning"]> } : {}) };
}
