/**
 * A preset laid out for one turn: RoleCall's `loadPresetPrompts` (preset-loader.ts at the pin), over
 * the canonical preset instead of RoleCall's rows. It decides which blocks are on (the preset's
 * switch, then the scene's toggles), fills the slots RoleCall fills so an imported SillyTavern preset
 * still sends the card, the persona, the lore, the summary, and the history, and sorts each block
 * into its placement. Pure: the preset is read, never changed.
 *
 * RoleCall keys everything on a block's `identifier`; the canonical block's `id` is that identifier,
 * kept verbatim on import (src/entities/preset/schema.ts).
 */
import type { PresetBody, PresetPrompt, PromptPlacement } from "../../entities/preset/schema";
import type { PresetPromptInfo } from "../macros";
import { isFeatureMarkerSlot, type FeatureMarkerSlot } from "../preset/build";
import type { Block } from "./conversation";
import { slotNonce, slotPlaceholder } from "./feature-slots";
import type { AssembledRole } from "./types";

/** Where a preset's blocks go (RoleCall's ProcessedPrompts buckets). */
export interface PresetPlan {
  /** Before the history, in the preset's order. */
  relative: Block[];
  /** Own messages placed within the history, by depth, each depth sorted by injection order. */
  inChat: Map<number, Block[]>;
  /** Glued onto a history message at a depth, in the preset's order. */
  append: Map<number, Block[]>;
  /** Pinned to the very top and the very bottom of the request, sorted by injection order. */
  top: Block[];
  bottom: Block[];
  /**
   * Every block with its effective switch, on or off, for the macros that ask about them
   * ({{enabled::id}} and its family; RoleCall's promptInfo). Its text is the preset's own.
   */
  info: PresetPromptInfo[];
  /** The feature markers this preset places (feature-slots.ts); a feature not here keeps its own spot. */
  slots: Set<FeatureMarkerSlot>;
  /** This plan's placeholder nonce (feature-slots.ts), so no text from outside the plan can stand for a marker. */
  slotNonce: string;
}

/** A block the assembler cannot place. The turn stops and names it rather than dropping it. */
export class PresetPlanError extends Error {
  override name = "PresetPlanError";
}

/** One working block: the preset's fields RoleCall reads, copied so the preset itself is never touched. */
interface Working {
  id: string;
  name: string;
  content: string;
  role: AssembledRole;
  placement: PromptPlacement;
  depth: number;
  order: number;
  attachments?: PresetPrompt["attachments"];
  /** A feature marker's slot. */
  slot?: FeatureMarkerSlot;
}

const PLACEMENTS = new Set<string>(["relative", "in_chat", "append", "append_preset", "prepend_preset"]);
const HISTORY = "{{message_history}}";
const SUMMARY = /\{\{\s*(?:summary|chatsummary)\b/i;
/**
 * RoleCall's empty card slots and the macro each is given (preset-loader.ts, "Auto-populate").
 * RoleCall at the pin left `dialogueExamples` out, so every imported preset dropped the card's
 * example dialogue; fixed in both.
 */
const CARD_SLOTS: readonly (readonly [string, string])[] = [
  ["charDescription", "{{description}}"],
  ["charPersonality", "{{personality}}"],
  ["scenario", "{{scenario}}"],
  ["dialogueExamples", "{{mesExamples}}"],
];

export function presetPlan(body: PresetBody, toggles: Readonly<Record<string, boolean>> = {}, nonce = slotNonce()): PresetPlan {
  const blocks = activeBlocks(body.prompts, toggles);
  // A feature marker's block carries its placeholder (a marker of the same slot placed twice keeps the first, as one id does).
  // Appended at a depth it is its own message there instead: glued on, the feature would ride a history message the budget may drop.
  const slots = new Set<FeatureMarkerSlot>();
  for (const b of blocks) {
    if (!b.slot || slots.has(b.slot)) continue;
    slots.add(b.slot);
    b.content = slotPlaceholder(b.slot, nonce);
    if (b.placement === "append") b.placement = "in_chat";
  }
  fillSlots(blocks);
  const info = body.prompts.map((p) => ({ id: p.id, identifier: p.id, name: p.name, enabled: isOn(p, toggles), content: p.content }));
  return { ...layOut(blocks), info, slots, slotNonce: nonce };
}

/** The one test for "this block already seats the persona": fillSlots adds its own block when none does, and the Cast wing's scan asks the same. */
const carriesPersona = (b: { content: string }): boolean => b.content.includes("{{persona}}");

/** The block a persona rides in, when the preset already has one that is on (the Cast wing's "Auto-injecting via"); null when the assembler will seat its own. A preset the assembler cannot lay out reads as none. */
export function personaMacroBlock(body: PresetBody, toggles: Readonly<Record<string, boolean>> = {}): { id: string; name: string } | null {
  try {
    const hit = activeBlocks(body.prompts, toggles).find(carriesPersona);
    return hit ? { id: hit.id, name: hit.name } : null;
  } catch (error) {
    if (error instanceof PresetPlanError) return null;
    throw error;
  }
}

/** On by the scene's toggle if it has one, else by the preset. */
const isOn = (p: PresetPrompt, toggles: Readonly<Record<string, boolean>>): boolean => (typeof toggles[p.id] === "boolean" ? toggles[p.id]! : p.enabled);

/**
 * The blocks this turn sends: on by the scene's toggle if it has one (forbidOverrides is
 * SillyTavern's card-override lock and never blocks the person's own toggle, RoleCall VVS-532),
 * else by the preset; with text, or a marker kept as an anchor; the first of any repeated id.
 */
function activeBlocks(prompts: readonly PresetPrompt[], toggles: Readonly<Record<string, boolean>>): Working[] {
  const seen = new Set<string>();
  const out: Working[] = [];
  for (const p of prompts) {
    if (!isOn(p, toggles) || (p.content.trim().length === 0 && !p.marker && !p.attachments?.length)) continue;
    if (p.id) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
    }
    const label = p.name || p.id;
    if (!PLACEMENTS.has(p.placement)) throw new PresetPlanError(`The preset block "${label}" has a placement this version cannot send (${p.placement}).`);
    if (p.role === "tool") throw new PresetPlanError(`The preset block "${label}" is a tool message, which scenes cannot send yet.`);
    if (p.marker && p.attachments?.length) throw new PresetPlanError(`The preset block "${label}" is a feature marker and cannot carry file attachments.`);
    out.push({ id: p.id, name: label, content: p.content, role: p.role, placement: p.placement, depth: p.injectionDepth, order: p.injectionOrder, ...(p.attachments?.length ? { attachments: p.attachments } : {}), ...(p.marker && isFeatureMarkerSlot(p.markerSlot) ? { slot: p.markerSlot } : {}) });
  }
  return out;
}

const synthetic = (id: string, name: string, content: string, near?: Working, placement: PromptPlacement = "relative"): Working => ({
  id,
  name,
  content,
  role: "system",
  placement: near?.placement ?? placement,
  depth: near?.depth ?? 0,
  order: (near?.order ?? 0) + (near ? 1 : 0),
});

/** Gives an empty slot its macro, or adds the macro after the slot's own text. */
const fill = (block: Working, macro: string): void => {
  block.content = block.content.trim() ? `${block.content}\n\n${macro}` : macro;
};

const findId = (blocks: readonly Working[], id: string): number => blocks.findIndex((b) => b.id === id);
const historyAt = (blocks: readonly Working[]): number =>
  blocks.findIndex((b) => b.id === "chatHistory" || b.content.toLowerCase().includes(HISTORY));

/** RoleCall's five fills, in its order: lore, persona, the card slots, summary, history. */
function fillSlots(blocks: Working[]): void {
  if (!blocks.some((b) => b.content.includes("{{lore}}"))) {
    const before = findId(blocks, "worldInfoBefore");
    if (before >= 0) {
      blocks.splice(before + 1, 0, synthetic("loreInjection", "Lorebook Content", "{{lore}}", blocks[before]));
    } else {
      // No world info slot: just before the history, as SillyTavern places it, else at the top.
      const history = historyAt(blocks);
      blocks.splice(Math.max(history, 0), 0, synthetic("loreInjection", "Lorebook Content", "{{lore}}"));
    }
  }

  if (!blocks.some(carriesPersona)) {
    const slot = findId(blocks, "personaDescription");
    if (slot >= 0) {
      fill(blocks[slot]!, "{{persona}}");
    } else {
      const main = findId(blocks, "main");
      const anchor = main >= 0 ? main : findId(blocks, "jailbreak");
      blocks.splice(anchor + 1, 0, synthetic("personaInjection", "Persona", "{{persona}}", blocks[anchor]));
    }
  }

  for (const [id, macro] of CARD_SLOTS) {
    const slot = blocks.find((b) => b.id === id);
    if (slot && !slot.content.trim()) slot.content = macro;
  }

  if (!blocks.some((b) => SUMMARY.test(b.content))) {
    const slot = blocks.findIndex((b) => b.id === "summary" || b.id === "chatSummary");
    if (slot >= 0) {
      fill(blocks[slot]!, "{{summary}}");
    } else {
      const history = historyAt(blocks);
      blocks.splice(history >= 0 ? history : blocks.length, 0, synthetic("summaryInjection", "Chat Summary", "{{summary}}"));
    }
  }

  if (!blocks.some((b) => b.content.toLowerCase().includes(HISTORY))) {
    const slot = findId(blocks, "chatHistory");
    if (slot >= 0) fill(blocks[slot]!, HISTORY);
    else blocks.push(synthetic("messageHistoryInjection", "Chat History", HISTORY, undefined, "in_chat"));
  }
}

const toBlock = (w: Working): Block => ({ role: w.role, content: w.content, source: { kind: "prompt", name: w.name, id: w.id }, ...(w.attachments?.length ? { attachments: w.attachments, attachmentOwner: { id: w.id, name: w.name } } : {}) });
const byOrder = (a: Working, b: Working): number => a.order - b.order;

function layOut(blocks: readonly Working[]): Omit<PresetPlan, "info" | "slots" | "slotNonce"> {
  const inChat = new Map<number, Working[]>();
  const append = new Map<number, Block[]>();
  const plan: Omit<PresetPlan, "info" | "slots" | "slotNonce"> = { relative: [], inChat: new Map(), append, top: [], bottom: [] };
  const top: Working[] = [];
  const bottom: Working[] = [];
  for (const w of blocks) {
    if (w.placement === "relative") plan.relative.push(toBlock(w));
    else if (w.placement === "in_chat") inChat.set(w.depth, [...(inChat.get(w.depth) ?? []), w]);
    else if (w.placement === "append") append.set(w.depth, [...(append.get(w.depth) ?? []), toBlock(w)]);
    else if (w.placement === "append_preset") bottom.push(w);
    else top.push(w);
  }
  // Array.prototype.sort is stable, so equal orders keep the preset's order.
  for (const [depth, list] of inChat) plan.inChat.set(depth, [...list].sort(byOrder).map(toBlock));
  plan.top = top.sort(byOrder).map(toBlock);
  plan.bottom = bottom.sort(byOrder).map(toBlock);
  return plan;
}
