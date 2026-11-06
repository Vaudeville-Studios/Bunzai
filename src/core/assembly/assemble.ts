/**
 * The pure prompt assembler: RoleCall's `assemblePrompt` for a
 * scene with or without a preset (preset.ts lays one out), in the same order and with the same
 * quirks, over the canonical cast instead
 * of RoleCall's rows. Each step names the section of `prompt-assembly.ts` it ports.
 * What is not here yet arrives with its step: lorebooks and {{lore}} (2e), regex and reasoning
 * (2f), summaries and {{summary}} (2g).
 */
import { countText } from "../tokens";
import { injectPersonaXml } from "../persona/inject";
import { personaMoves, placePersona } from "./persona-place";
import { runLore, type LoreHit, type LoreScan, type LoreScanMessage, type LoreVerdict } from "../lore/engine";
import { mulberry32 } from "../lore/rng";
import type { MacroContext, MacroVariable } from "../macros";
import type { GlobalWrite } from "../macros/types";
import type { CharacterCardContext } from "../macros/handlers/character";
import { appendAtDepth, buildConversation, defaultPrompts, DEFAULT_MAX_TOKENS, injectAtDepth, type Block } from "./conversation";
import { minHistoryKeep, type DepthPlacement } from "./history-cut";
import { applyLoreEffects, variableDiff, type LoreUndo } from "./lore-effects";
import { placeLore } from "./lore-place";
import { loreShareTokens, placeRecall, RECALL_NO_WINDOW_TOKENS } from "./recall-place";
import { hideCovered } from "./chat-summary";
import { cutSummarized, summaryText } from "./summary-cut";
import { personaMacroBlock, presetPlan, PresetPlanError } from "./preset";
import { HISTORY_MARKER, macroPass } from "./macro-pass";
import { macroSink, variableChanges } from "./macro-report";
import { historyText, stripUnresolvedMacros } from "./sanitize";
import { continuationPrefill } from "./continuation";
import { DEFAULT_IMPERSONATION_PROMPT, impersonationText } from "../draft-prompts";
import { cardView } from "./card";
import { applyGuides, decorateMacroValue, prependUserGuides, resolveGuides, startLatchKey } from "./guides";
import { noteDue, placeNote } from "./note";
import { injectionTexts, linkedTrackersText, placeBlock, trackersText } from "./trackers";
import { refreshTrackerTexts, trackerViews } from "../tracker";
import { storyboardsBlock } from "./storyboards";
import { fillSlot, leftPlaceholder, withoutPlaceholders, slotPlaceholder } from "./feature-slots";
import { skillRuns, skillsText } from "./skills";
import type { FeatureMarkerSlot } from "../preset/build";
import { placeDirector } from "./director";
import { DEFAULT_LORE_SHARE, type AssemblyInput, type HistoryMessage, type AssemblyResult, type AssembledMessage, type AssemblyLoreHit, type VariableDiff } from "./types";
import { resolveSelections } from "../macros/choice-groups";
import { effectiveToggles, toChoiceGroups } from "../preset/choices";

/** Reply tokens RoleCall reserves when a window comes without a reply cap. */
const FALLBACK_REPLY = 1024;

/** A block that asks for the character's colors itself (the macro and its aliases, character handlers). */
const PALETTE_MACRO = /\{\{\s*(?:palette|charpalette|character\.palette)\s*\}\}/i;

export function assemble(input: AssemblyInput): AssemblyResult {
  const card = cardView(input.character);
  const guides = resolveGuides(input.guides);
  // A standard user-role guide rides in front of the message being answered (guides.ts); an opening with no message has none.
  const currentText = input.current.content === "" ? "" : prependUserGuides(input.current.content, guides.user);
  // Section 9's layout comes first here: the macro context carries its switches (RoleCall reads
  // them in loadPresetPrompts, before assembly starts).
  // The preset's choice answers set the baseline for the blocks they name; the scene's own switches go on top (core/preset/choices.ts).
  const choiceGroups = toChoiceGroups(input.preset?.choices);
  const choiceSelections = resolveSelections(choiceGroups, input.choices);
  const toggles = effectiveToggles(choiceGroups, choiceSelections, input.promptToggles);
  const plan = input.preset ? presetPlan(input.preset, toggles, input.slotNonce) : defaultPrompts();
  /** A history message as the model and the history macros read it: tool-call leaks out, and an assistant reply's thinking out unless the scene keeps it. */
  const cleaned = (m: HistoryMessage): string => historyText(m, input.reasoning, input.keepThinking);
  const [first, ...rest] = input.history;
  // Section 7: the greeting is the opening assistant message. RoleCall rebuilds it from the card by
  // its stored index; Bunzai stores the chosen greeting as that message, so it reads it back.
  const greetingSource = first?.role === "assistant" ? first : undefined;
  const history = greetingSource ? rest : input.history;

  // Section 4: the persona's XML, and {{user}}'s name.
  const personaXml = input.persona ? injectPersonaXml(input.persona) : undefined;
  const userName = input.persona?.name || "User";
  // Section 4.5: macro-aimed guides decorate the macro values (not the card's own character prompt, as in RoleCall).
  const personaText = decorateMacroValue(personaXml ?? "", guides.macro, "persona");
  // The stored stop moves the persona out of the {{persona}} macro and into one placed block, unless the preset already seats it itself (the tab locks the stops then).
  const personaStop = input.persona?.chatInjection;
  const placedPersona = personaText !== "" && personaMoves(personaStop) && !(input.preset && personaMacroBlock(input.preset, toggles));
  const persona = placedPersona ? "" : personaText;
  // The card's named colors ride as XML tags with the description, unless the preset asks for them itself with {{palette}}.
  const paletteNamed = [...plan.relative, ...plan.top, ...plan.bottom, ...[...plan.inChat.values()].flat(), ...[...plan.append.values()].flat()].some((b) => PALETTE_MACRO.test(b.content));
  const tagged = card.paletteTags && !paletteNamed ? [card.description, card.paletteTags].filter(Boolean).join("\n") : card.description;
  const described = decorateMacroValue(tagged, guides.macro, "description");
  const personality = decorateMacroValue(card.personality, guides.macro, "personality");
  const scenario = decorateMacroValue(card.scenario, guides.macro, "scenario");
  const summary = decorateMacroValue(input.chatSummary?.text ?? "", guides.macro, "summary");

  // Section 3: the macro context, card fields included, and RoleCall's own second-pass names.
  const localVariables = new Map(input.localVariables);
  const globalVariables = new Map(input.globalVariables);
  /** Every write to a global variable, as the operation it was, in the order made: what the turn keeps (core/scene-state/globals.ts). */
  const globalWrites: GlobalWrite[] = [];
  const context: Partial<CharacterCardContext> = {
    ...card.macroFields,
    characterName: card.name,
    characterDescription: described,
    characterPersonality: personality,
    scenario,
    userName,
    ...(persona ? { userPersona: persona } : {}),
    ...(summary ? { chatSummary: summary } : {}),
    messages: input.history.map((m) => ({ role: m.role, content: cleaned(m) })),
    messageCount: input.history.length,
    firstMessage: greetingSource?.content ?? "",
    localVariables,
    globalVariables,
    globalWrites,
    now: input.now,
    ...(input.preset ? { presetPrompts: plan.info } : {}),
    ...(choiceGroups.length > 0 ? { choiceGroups, choiceSelections } : {}),
    ...(input.persona?.presentation?.signatureColor ? { personaAccentColor: input.persona.presentation.signatureColor } : {}),
    ...(input.deadline ? { deadline: input.deadline } : {}),
  };
  // The library trackers the scene links, for {{tracker::...}} (core/tracker.ts); each one's template renders below, once the pass exists.
  const linked = trackerViews(input.linkedTrackers);
  if (linked.size > 0) context.trackers = linked;
  const sink = macroSink(countText);
  const macros = macroPass(context as Partial<MacroContext>, {
    world: "",
    lore: "",
    persona,
    character: "",
    "character.scenario": scenario,
    "character.description": described,
    "character.personality": personality,
    "character.examples": card.examples,
    "character.first_mes": greetingSource?.content ?? "",
    "character.phi": card.postHistory,
    phi: card.postHistory,
    summary,
    chatsummary: summary,
    message_history: HISTORY_MARKER,
    last_message: "",
  }, input.randomSeed, sink);

  refreshTrackerTexts(linked, macros.reported);
  const linkedText = linkedTrackersText(linked.values());

  // Section 4.6: a chat-start guide runs once per scene for its side effects and its text is dropped; the latch keeps a regenerate from rolling it again.
  for (const g of guides.chatStart) {
    const latch = startLatchKey(g.id);
    if (localVariables.has(latch)) continue;
    macros.write(g.content);
    localVariables.set(latch, { value: "1", createdAt: input.now, updatedAt: input.now });
  }

  // End of section 5.5: the card's own depth notes, expanded once as RoleCall does here.
  const depthNotes = new Map<number, Block[]>();
  for (const note of card.depthNotes) {
    const at = depthNotes.get(note.depth) ?? [];
    at.push({ role: note.role, content: macros.write(note.text), source: { kind: "depth", depth: note.depth } });
    depthNotes.set(note.depth, at);
  }

  if (placedPersona) placePersona(plan, depthNotes, personaText, personaStop!);

  // 2e-d4: the lore engine, run once, before section 10's macro pass so an entry's own macros run
  // like the preset's own blocks. World hits join the {{lore}} legacy macro (fix 3); everything else
  // is placed straight into the plan and the depth-note map (lore-place.ts). Side effects are not
  // applied yet: not yet - applied with 2f's variable pass.
  let loreResult: AssemblyResult["lore"];
  let loreImportant: string[] = [];
  let loreUndo: LoreUndo[] = [];
  /** What the lore engine and the skills' triggers read: the chat with the message being answered, the card, and the variables as they stand. */
  const loreScan = (): LoreScan => ({
    messages: [
      ...input.history.map((m): LoreScanMessage => ({ role: m.role, content: m.content, ...(m.at === undefined ? {} : { at: m.at }) })),
      { role: input.current.role, content: currentText, ...(input.current.at === undefined ? {} : { at: input.current.at }) },
    ],
    messageCount: input.history.length + 1,
    character: { name: card.name, tags: card.macroFields.charTags ?? [], description: card.description, personality: card.personality, scenario: card.scenario },
    persona: personaXml ?? "",
    generationType: input.generationType ?? "normal",
    currentSpeaker: card.name,
    variables: scanVariables(localVariables, globalVariables),
    now: input.now,
  });
  if (input.lore) {
    const run = runLore(
      input.lore.books,
      loreScan(),
      {
        rng: mulberry32(input.randomSeed ^ 0x9e3779b9),
        countTokens: countText,
        budgetTokens: input.window ? loreShareTokens(input.window.context, input.lore.budgetShare) : Number.POSITIVE_INFINITY,
        recentFires: input.lore.recentFires,
        // th-t3 plan step 1: TrackHare's trace needs a verdict per entry to explain misses.
        explain: true,
      },
    );
    // Side Effects run over the macros' own variable maps before any macro resolves, so {{getvar}} sees them.
    loreUndo = applyLoreEffects(run.sideEffects, localVariables, globalVariables, input.now, globalWrites);
    macros.legacy["lore"] = run.injected
      .filter((h) => h.position.kind === "world")
      .map((h) => h.content)
      .join("\n");
    placeLore(plan, depthNotes, run.injected, input.lore.books);
    // Depth hits are already reserved through depthNotes below; every other position is new content.
    loreImportant = run.injected.filter((h) => h.position.kind !== "depth").map((h) => h.content);
    loreResult = {
      fires: run.fires,
      injected: run.injected.map(toLoreHitTrace),
      cut: run.cut.map(toLoreHitTrace),
      totalTokens: run.totalTokens,
      seed: input.randomSeed,
      undo: loreUndo,
      ...truncateVerdicts(run.verdicts ?? []),
    };
  }

  // The skills that are on this turn (skills.ts), decided once the lore's side effects are in the variables, their text rendered here so the budget reserves it.
  const skillsRun = input.skills ? skillRuns(input.skills, loreScan(), mulberry32(input.randomSeed ^ 0x5bd1e995)) : undefined;
  // Rendered like any prompt text: the macros run, and what no macro answers is stripped (section 12's own rule).
  const skillText = (skills: NonNullable<AssemblyInput["skills"]>) => skillsRun ? skillsText(skills, skills.map((s) => skillsRun.find((r) => r.id === s.id)!), (text) => stripUnresolvedMacros(macros.write(text), HISTORY_MARKER)) : "";
  const skillsBlock = skillText((input.skills ?? []).filter((s) => !s.slots?.length));
  const placedSkills = (input.skills ?? []).flatMap((s) => (s.slots ?? []).map((slot) => ({ slot, text: skillText([s]) })));
  const skillsReserved = [skillsBlock, ...placedSkills.map((s) => s.text)].filter(Boolean);

  // Summary-aware truncation (summary-cut.ts): recaps replace the oldest messages they cover, and a recap lore already placed is not sent twice.
  const loreKeys = new Set(loreResult?.injected.map((h) => h.entryKey));
  const cut = input.summaries ? cutSummarized(history, input.summaries.recaps) : { drop: 0, used: [] };
  const placedRecaps = cut.used.filter((r) => !loreKeys.has(r.entryKey));
  const recapBlocks: Block[] = placedRecaps.map((r) => ({ role: "system", content: summaryText(r), source: { kind: "summary", entryKey: r.entryKey } }));
  const afterRecaps = cut.drop > 0 ? history.slice(cut.drop) : history;
  // The chat summary stands in for the messages it covers (chat-summary.ts), after the recaps have taken theirs.
  const hide = input.chatSummary?.hideKeep !== undefined ? hideCovered(afterRecaps, input.chatSummary.through, input.chatSummary.hideKeep) : 0;
  const shown = hide > 0 ? afterRecaps.slice(hide) : afterRecaps;

  // Recall (04b D4): the Compendium's picks, inside what the lore share has left and never repeating what lore placed. RoleCall
  // injects them after assembly (worker.ts:4111-4125) and only before a message being answered, so an opening gets none.
  const recallPlaced = input.recall && currentText !== "" ? placeRecall(
    input.recall.entries,
    input.window ? Math.max(0, loreShareTokens(input.window.context, input.lore?.budgetShare ?? DEFAULT_LORE_SHARE) - (loreResult?.totalTokens ?? 0)) : RECALL_NO_WINDOW_TOKENS,
    new Set([...loreKeys, ...cut.used.map((r) => r.entryKey)]),
  ) : undefined;

  // Section 6: RoleCall's character prompt. No-preset turns never send it, but RoleCall builds it
  // anyway: its macros run here (in this order, with their effects) and the budget reserves it.
  const characterPrompt = card.characterPrompt(macros.write);
  macros.legacy["character"] = characterPrompt;
  const greeting: Block | null = greetingSource
    ? { role: "assistant", content: macros.write(greetingSource.content), source: { kind: "greeting", messageId: greetingSource.id }, historical: true }
    : null;

  // Section 8: stored history, read-only, with leaked tool-call markup removed.
  let kept: Block[] = shown.map((m) => ({ role: m.role, content: cleaned(m), source: { kind: "history", messageId: m.id }, historical: true }));
  const current: Block = { role: "user", content: currentText, source: { kind: "current", messageId: input.current.id } };
  if (kept.length > 0) macros.legacy["last_message"] = kept[kept.length - 1]!.content;

  // Section 8.5: the budget.
  const trimmed: string[] = [];
  if (input.window && input.window.context > 0 && input.budgeter) {
    const window = { context: input.window.context, reply: input.window.reply || FALLBACK_REPLY };
    // P2: every depth this turn places something at, card depth notes and lore
    // hits already folded into the same maps (placeLore ran above), plus the preset's own in-chat
    // and append blocks - so a safe pre-trim (budget-app.ts's fitHistory) never cuts history down
    // past what a depth note, an in-chat block or an append block still needs to land correctly.
    const placements: DepthPlacement[] = [
      ...[...depthNotes.keys()].map((depth) => ({ depth })),
      ...[...plan.inChat.keys()].map((depth) => ({ depth })),
      ...[...plan.append.entries()].flatMap(([depth, items]) => items.map((item) => ({ depth, role: item.role === "assistant" ? ("assistant" as const) : ("user" as const) }))),
    ];
    const minKeep = minHistoryKeep(shown.map((m) => m.role), placements);
    const keep = input.budgeter.fitHistory({
      window,
      required: [characterPrompt, ...(greeting ? [[greeting]] : []), currentText],
      // RoleCall keeps the card's depth notes on its lorebook depth list, so it reserves them as lore.
      important: [
        ...(personaXml && !placedPersona ? [personaXml] : []),
        ...(depthNotes.size > 0 ? [[...depthNotes.values()].flat().map((n) => n.content).join("\n")] : []),
        // The engine already applied the lore share; this just reserves what survived it.
        ...(loreImportant.length > 0 ? [loreImportant.join("\n")] : []),
        ...(recallPlaced?.text ? [recallPlaced.text] : []),
        ...(recapBlocks.length > 0 ? [recapBlocks.map((b) => b.content).join("\n")] : []),
        // The trackers' block and the texts that ride beside the messages (the tool definitions) are fixed, like the card: history gives way to them, never they to history.
        ...(linkedText ? [linkedText] : []),
        ...skillsReserved,
        ...(input.reserved ?? []),
      ],
      raw: shown.map((m) => m.content),
      history: kept,
      minKeep,
      // P2: the exact content finalPass will measure for the i-th newest stored
      // message, so a real per-message cost sum (budget-app.ts's fitHistory) proves an overflow
      // instead of estimating one. `kept` is oldest-first and already stripToolCallLeaks'd (section
      // 8 above); text with no "{{" cannot change under the macro pass, so it already is the final
      // content, at no extra cost. `macros.historical` memoizes by exact text, so a message this
      // inspects and later keeps is never macro-expanded twice.
      contentFromNewest: (i) => {
        const content = kept[kept.length - 1 - i]!.content;
        return content.includes("{{") ? macros.historical(content) : content;
      },
    });
    for (const block of kept.slice(0, kept.length - keep)) if (block.source.kind === "history") trimmed.push(block.source.messageId);
    kept = kept.slice(kept.length - keep);
  }

  // Section 9: the preset's layout, or RoleCall's default set without one. Either way a
  // {{message_history}} block stands where the history goes: the preset's own, or the one presetPlan
  // added, so RoleCall's no-marker branch cannot be reached and is not ported. An in-chat marker
  // block is placed once; the other in-chat blocks go inside the history when it is expanded.
  const isMarker = (b: Block) => b.content.toLowerCase().includes("{{message_history}}");
  const inChat = [...plan.inChat.values()].flat();
  let blocks = buildConversation(plan.relative, new Map(), null, [], { role: "user", content: "", source: current.source });
  if (!plan.relative.some(isMarker)) blocks.push(...inChat.filter(isMarker));
  const woven = new Map<number, Block[]>();
  for (const [depth, list] of plan.inChat) {
    const kept = list.filter((b) => !isMarker(b));
    if (kept.length > 0) woven.set(depth, kept);
  }

  // Section 10: macros, then the history expanded at its marker.
  blocks = blocks.map((b) => ({ ...b, content: b.historical ? macros.historical(b.content) : macros.write(b.content) }));
  let region = { start: -1, end: -1 };
  blocks = blocks.flatMap((b) => {
    if (b.role === "user" && b.content === "" && !b.attachments?.length) return [];
    if (!b.content.includes(HISTORY_MARKER)) return [b];
    const [before = "", after = ""] = b.content.split(HISTORY_MARKER);
    return [
      ...(before.trim() ? [{ ...b, content: before.trim() }] : []),
      { ...b, content: HISTORY_MARKER },
      ...(after.trim() ? [{ ...b, content: after.trim() }] : []),
    ];
  });
  const at = blocks.findIndex((b) => b.content === HISTORY_MARKER);
  if (at >= 0) {
    let expanded = buildConversation([], woven, greeting, kept, current);
    // RoleCall runs the macros over the expansion only when it wove preset blocks into it.
    if (woven.size > 0) expanded = expanded.map((b) => ({ ...b, content: b.historical ? macros.historical(b.content) : macros.write(b.content) }));
    blocks.splice(at, 1, ...expanded);
    region = { start: at, end: at + expanded.length };
  }

  // Section 10.4.8: append blocks, glued onto history messages, shallowest depth first.
  const appendRegion = region.start >= 0 ? { ...region } : { start: 0, end: blocks.length };
  for (const depth of [...plan.append.keys()].sort((a, b) => a - b)) {
    for (const item of plan.append.get(depth)!) {
      const content = macros.write(item.content).trim();
      if (!content) continue;
      const glued = appendAtDepth(blocks, { ...item, content }, depth, appendRegion);
      blocks = glued.blocks;
      if (glued.inserted) {
        appendRegion.end += 1;
        if (region.start >= 0) region.end += 1;
      }
    }
  }

  // Section 10.5: depth notes, placed within the history.
  if (depthNotes.size > 0) {
    const noted = new Map([...depthNotes].map(([depth, notes]) => [depth, notes.map((n) => ({ ...n, content: macros.write(n.content) }))]));
    blocks = injectAtDepth(blocks, noted, region.start >= 0 ? region : { start: 0, end: blocks.length });
  }

  // Section 10.6: the scene note, after the depth notes and before the pins. Its macros run once here and again in the final pass, as RoleCall's do.
  if (noteDue(input.note, history.filter((m) => m.role === "user").length)) blocks = placeNote(blocks, macros.write(input.note!.text), input.note!);

  // Section 10.7: pinned blocks, at the very bottom and the very top; their macros run below.
  blocks = [...plan.top, ...blocks, ...plan.bottom];

  // Section 12: the final macro pass, the strip of anything unresolved, and empty messages dropped.
  blocks = blocks
    .map((b) => ({ ...b, content: b.source.kind === "prompt" && b.source.id && Object.hasOwn(input.literalPrompts ?? {}, b.source.id) ? input.literalPrompts![b.source.id]! : stripUnresolvedMacros(b.historical ? macros.historical(b.content) : macros.write(b.content), HISTORY_MARKER) }))
    .filter((b) => b.content.length > 0 || Boolean(b.attachments?.length));

  // The recaps ride in front of the history that is left (after the greeting), as data like recall's text; the budget only ever drops history.
  if (recapBlocks.length > 0) {
    const at = blocks.findIndex((b) => b.source.kind === "history" || b.source.kind === "current");
    blocks.splice(at < 0 ? blocks.length : at, 0, ...recapBlocks);
  }

  // Recall's block rides in front of the message being answered, after the macro pass (its text is data, as RoleCall's is) and
  // before the final budget pass, which only ever drops history, so the block is measured and never dropped.
  if (recallPlaced?.text) {
    const at = blocks.findIndex((b) => b.source.kind === "current");
    if (at >= 0) blocks.splice(at, 0, { role: "system", content: recallPlaced.text, source: { kind: "recall" } });
  }

  // The final budget pass over the finished request.
  for (const { slot } of placedSkills) {
    const mark = slotPlaceholder(slot, plan.slotNonce);
    if (blocks.reduce((n, b) => n + b.content.split(mark).length - 1, 0) > 1) throw new PresetPlanError("A Skill card was placed more than once through include. Add another Skill card instead so its budget is reserved.");
  }
  let finalPassDropped = 0;
  let overflow = false;
  if (input.window && input.window.context > 0 && input.budgeter) {
    const cap = Math.max(1, input.window.context - (input.window.reply || FALLBACK_REPLY));
    // The fixed texts are measured as messages at the end, so the pass counts them; their entries in `keep` are never read (blocks has none).
    const fixed: AssembledMessage[] = [...(linkedText ? [linkedText] : []), ...skillsReserved, ...(input.reserved ?? [])].map((content) => ({ role: "system", content }));
    // A feature marker's placeholder is measured as nothing: its content is fixed and added after this pass.
    const measured = blocks.map((b) => ({ role: b.role, content: withoutPlaceholders(b.content, plan.slotNonce) }));
    const { keep, dropped, overflow: over } = input.budgeter.finalPass([...measured, ...fixed], cap, [...blocks.map((b) => b.source.kind === "history"), ...fixed.map(() => false)]);
    for (const [i, b] of blocks.entries()) if (!keep[i] && b.source.kind === "history") trimmed.push(b.source.messageId);
    blocks = blocks.filter((_, i) => keep[i]);
    finalPassDropped = dropped;
    overflow = over === true;
  }

  // The trackers' state (trackers.ts), measured and never dropped, as RoleCall's rides on top of the budget. A feature with a marker in the preset
  // fills it now (feature-slots.ts), so the guides below count its real messages; one without goes after the guides, after the leading system messages.
  const turn = history.filter((m) => m.role === "user").length + (currentText === "" ? 0 : 1);
  const tracked = trackersText(input.trackers, turn);
  const boards = storyboardsBlock(input.storyboards, turn);
  const features: [FeatureMarkerSlot, string[], "trackers" | "storyboards" | "skills"][] = [
    ["trackers", [...(tracked ? [tracked] : []), ...injectionTexts(input.trackers, turn)], "trackers"],
    ["linkedTrackers", linkedText ? [linkedText] : [], "trackers"],
    ["storyboards", boards ? [boards] : [], "storyboards"],
    ["skills", skillsBlock ? [skillsBlock] : [], "skills"],
  ];
  const parts: AssemblyResult["parts"] = {
    features: Object.fromEntries(features.map(([slot, texts]) => [slot, texts])),
    lore: { keys: [...loreKeys, ...cut.used.map((r) => r.entryKey)], tokens: loreResult?.totalTokens ?? 0 },
  };
  for (const [slot, texts, kind] of features) if (plan.slots.has(slot)) blocks = fillSlot(blocks, slot, plan.slotNonce, texts, { kind });
  for (const skill of placedSkills) blocks = fillSlot(blocks, skill.slot, plan.slotNonce, skill.text ? [skill.text] : [], { kind: "skills" });
  if (leftPlaceholder(blocks, plan.slotNonce)) throw new PresetPlanError("A feature marker in the preset could not be filled, so the turn was stopped rather than send its placeholder.");

  // The worker's steps after assembly (guides.ts): the system guide block and the depth and append guides.
  blocks = applyGuides(blocks, guides, macros.write);

  for (const [slot, texts, kind] of features) if (!plan.slots.has(slot)) for (const text of texts) blocks = placeBlock(blocks, text, kind);
  // The Story Director (director.ts): this turn's directive at depth 1 and its contract at the top, after the budget so neither is ever dropped.
  blocks = placeDirector(blocks, input.director);

  // Expand as character (RoleCall section 11): one last system message, after the guides, so nothing lands below it.
  if (input.impersonation) {
    const custom = input.preset?.systemPrompts?.impersonation?.trim();
    const text = impersonationText(macros.write(custom ? input.preset!.systemPrompts!.impersonation! : DEFAULT_IMPERSONATION_PROMPT), input.impersonation.perspective, input.impersonation.brief);
    blocks.push({ role: "system", content: text, source: { kind: "prompt", name: "Impersonation" } });
  }

  // The assistant prefill, its macros expanded last as RoleCall's worker does; the turn loop places it
  // (request.ts withPrefill), since whether it is sent depends on the model. Assistant-role guides are the
  // chat-level prefill and replace the preset's (prefill-injection.ts resolvePrefillPlan).
  const presetPrefill = (input.impersonation ? input.preset?.systemPrompts?.assistantImpersonation : input.preset?.systemPrompts?.assistantPrefill)?.trim();
  const chatPrefill = input.impersonation ? [] : [...(input.prefill?.trim() ? [input.prefill] : []), ...guides.prefill.filter((p) => p.trim())];
  const prefillText = chatPrefill.length > 0 ? chatPrefill.join("\n") : presetPrefill;
  // A continue sends the reply itself instead, as stored text, not a template (turn-loop rule 13).
  const prefill = input.continuation !== undefined ? continuationPrefill(input.continuation) || undefined : prefillText ? macros.write(prefillText) : undefined;

  const nudge = input.continuation !== undefined ? input.preset?.systemPrompts?.continueNudge?.trim() : undefined;
  const continueNudge = nudge ? macros.write(nudge) : undefined;

  const local = variableDiff(input.localVariables, localVariables);
  const global = variableDiff(input.globalVariables, globalVariables);
  const changes = variableChanges({ local: input.localVariables, global: input.globalVariables }, { local, global });
  return {
    messages: blocks.map(toMessage),
    trace: blocks.map((b) => ({ source: b.source, role: b.role, tokens: countText(b.content) })),
    budget: { budgeter: input.budgeter && input.window ? input.budgeter.name : "none", trimmed, finalPassDropped, ...(overflow ? { overflow: true as const } : {}), ...(linkedText || skillsReserved.length > 0 || (input.reserved?.length ?? 0) > 0 ? { fixed: true as const } : {}) },
    local,
    global,
    globalWrites,
    ...(sink.report() ? { macros: sink.report()! } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    maxTokens: input.preset?.samplers?.maxTokens ?? DEFAULT_MAX_TOKENS,
    expansion: { names: { user: userName, char: card.name }, expand: (text) => macros.historical(text), context: macros.context },
    ...(prefill ? { prefill } : {}),
    ...(continueNudge ? { continueNudge } : {}),
    ...(loreResult ? { lore: loreResult } : {}),
    parts,
    ...(hide > 0 ? { chatSummary: { hidden: afterRecaps.slice(0, hide).map((m) => m.id) } } : {}),
    ...(cut.drop > 0 ? { summaries: { dropped: history.slice(0, cut.drop).map((m) => m.id), injected: placedRecaps.map((r) => ({ entryKey: r.entryKey, title: r.title, tokens: countText(summaryText(r)) })) } } : {}),
    ...(skillsRun ? { skills: skillsRun } : {}),
    ...(recallPlaced ? { recall: { injected: recallPlaced.injected, cut: recallPlaced.cut, repeated: recallPlaced.repeated, totalTokens: recallPlaced.injected.reduce((n, h) => n + h.tokens, 0) } } : {}),
  };
}

const toMessage = (b: Block): AssembledMessage => ({ role: b.role, content: b.content, ...(b.attachments?.length ? { attachments: b.attachments, attachmentOwner: b.attachmentOwner } : {}) });

const toLoreHitTrace = ({ entryKey, title, reason, matched, tokens, position }: LoreHit): AssemblyLoreHit => ({ entryKey, title, reason, matched, tokens, position });

/** th-t3 plan step 1: every verdict at or below 1000; above that, every fired one, then misses up to
 * 1000 total, flagged truncated. Book order then entry order (the engine's own), kept both ways. */
const VERDICT_CAP = 1000;
function truncateVerdicts(verdicts: readonly LoreVerdict[]): { verdicts: LoreVerdict[]; verdictsTruncated?: true } {
  if (verdicts.length <= VERDICT_CAP) return { verdicts: [...verdicts] };
  const fired = verdicts.filter((v) => v.fired);
  const missed = verdicts.filter((v) => !v.fired).slice(0, Math.max(0, VERDICT_CAP - fired.length));
  return { verdicts: [...fired, ...missed], verdictsTruncated: true };
}

/** A read-only view of the turn's variables for the lore engine's triggers; non-scalar values are left out. */
function scanVariables(local: ReadonlyMap<string, MacroVariable>, global: ReadonlyMap<string, MacroVariable>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, v] of global) if (typeof v.value === "string" || typeof v.value === "number") out[name] = v.value;
  for (const [name, v] of local) if (typeof v.value === "string" || typeof v.value === "number") out[name] = v.value;
  return out;
}
