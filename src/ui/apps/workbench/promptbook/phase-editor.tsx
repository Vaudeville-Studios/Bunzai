/** A phase edits existing preset blocks and links reusable pieces, without a second prompt-placement model. */
import { useState, type JSX } from "react";
import type { BookPhase } from "../../../../entities/promptbook/schema";
import { emptySkillBody } from "../../../../entities/skill/schema";
import type { PresetPrompt } from "../../../../entities/preset/schema";
import type { PresetAttachment } from "../../../../entities/preset/schema";
import type { StagedAssetUpload } from "../../../app-contract-editor";
import type { AppContext } from "../../../app-contract";
import { Button, Toggle } from "../../../components/button";
import { Input, Textarea, Select, Checkbox } from "../../../components/rc-controls";
import { VirtualRows } from "../../../_shared/virtual-list";
import { BookCards } from "./book-cards";
import { ModelChoice } from "./model-choice";
import { useLibraryPieces } from "./use-library-pieces";
import { addBlock, deleteBlock, reorderBlock } from "../preset/session";
import { buildOrder, placementsForProfile } from "../../../../core/preset";
import { reorderChangesBuild } from "../nodes/pipeline";
import { PromptEditPanel } from "../preset/prompt-edit-panel";
import s from "./promptbook.module.css";
import { SkillConditionEditor } from "../pieces/skill-condition";

export function PhaseEditor({ phase, earlier, ctx, onChange, cards, onRemove, uploads, stageAsset, pinUploads, discardUploads, onAddAttachment, onRemoveAttachment }: { phase: BookPhase; earlier: BookPhase[]; ctx: AppContext; onChange(p: BookPhase): void; cards: boolean; onRemove(): void; uploads: readonly StagedAssetUpload[]; stageAsset(file: File, signal?: AbortSignal): Promise<StagedAssetUpload>; pinUploads(refs: readonly string[]): void; discardUploads(refs: readonly string[]): Promise<void>; onAddAttachment(promptId: string, attachment: PresetAttachment, receipt: string): boolean; onRemoveAttachment(promptId: string, ref: string, occurrence: number): void }): JSX.Element {
  const patch = (over: Partial<BookPhase>) => onChange({ ...phase, ...over });
  const prompt = (id: string, over: Partial<PresetPrompt>) => patch({ preset: { ...phase.preset, prompts: phase.preset.prompts.map((p) => p.id === id ? { ...p, ...over } : p) } });
  const condition = phase.condition;
  const { pieces, error } = useLibraryPieces(ctx);
  const [selectedBlock, selectBlock] = useState<string | null>(null);
  const ordered = buildOrder(phase.preset);
  return <section className={s.phase} data-part="promptbook.phase">
    <div className={s.toolbar}><Input aria-label="Phase name" value={phase.name} onChange={(e) => patch({ name: e.target.value })} /><strong>{phase.role === "reply" ? "The reply" : phase.role === "private" ? "Private notes" : "After the reply"}</strong>{phase.role !== "reply" && <><Toggle label="Run phase" on={phase.enabled} onChange={(enabled) => patch({ enabled })} /><Button size="sm" variant="danger" onClick={onRemove}>Remove phase</Button></>}</div>
    <Textarea aria-label="Phase description" rows={2} placeholder="What should this phase do?" value={phase.description} onChange={(e) => patch({ description: e.target.value })} />
    <fieldset><legend>Run by</legend>{error && <p role="alert">{error}</p>}<Button size="sm" onClick={() => { const next = { ...phase }; delete next.agentId; onChange(next); }}>Scene narrator</Button><VirtualRows items={pieces.filter((p) => p.kind === "agent")} keyOf={(p) => p.id} estimate={40} render={(p) => <Button block variant="quiet" aria-pressed={phase.agentId === p.id} onClick={() => patch({ agentId: p.id })}>{p.name}</Button>} /><ModelChoice ctx={ctx} value={phase.connection} onChange={(connection) => patch({ connection })} /><Button size="sm" onClick={() => { const next = { ...phase }; delete next.connection; onChange(next); }}>Use Agent or scene model</Button></fieldset>
    <label>Reply token budget<Input type="number" min={1} aria-label="Phase reply token budget" placeholder="Same as scene" value={phase.maxTokens ?? ""} onChange={(e) => { const maxTokens = e.target.valueAsNumber; const next = { ...phase }; if (Number.isFinite(maxTokens)) next.maxTokens = maxTokens; else delete next.maxTokens; onChange(next); }} /></label>
    {phase.role !== "reply" && <fieldset><legend>When</legend><Select aria-label="Phase condition" value={condition ? "mentioned" : "always"} onChange={(e) => { const next = { ...phase }; if (e.target.value === "always") delete next.condition; else { const { triggers, secondaryTriggers, selectiveLogic, caseSensitive, matchWholeWords, scanDepth } = emptySkillBody(phase.name); next.condition = { triggers, secondaryTriggers, selectiveLogic, caseSensitive, matchWholeWords, scanDepth }; } onChange(next); }}><option value="always">Always</option><option value="mentioned">When the chat mentions…</option></Select>
      {condition && <SkillConditionEditor value={condition} onChange={(condition) => patch({ condition })} />}
    </fieldset>}
    <fieldset><legend>Gets from earlier phases</legend><VirtualRows items={earlier} keyOf={(p) => p.id} estimate={36} render={(p) => <label><Checkbox checked={phase.reads.includes(p.id)} onChange={(e) => patch({ reads: e.target.checked ? [...phase.reads, p.id] : phase.reads.filter((id) => id !== p.id) })} />{p.name}</label>} />{earlier.length === 0 && <p>This is the first phase.</p>}</fieldset>
    {!cards && <BookCards phase={phase} ctx={ctx} onChange={onChange} expanded={false} />}
    <h3>Prompt blocks</h3><p>These use the preset's placement and grouping rules. Context markers stay in the same ordered stack.</p>
    <Button size="sm" onClick={() => patch({ preset: addBlock(phase.preset) })}>Add prompt block</Button>
    <VirtualRows items={ordered} keyOf={(p) => p.id} estimate={120} render={(p, i) => <article className={s.block}><div className={s.toolbar}><Input aria-label={`Block ${i + 1} name`} value={p.name} onChange={(e) => prompt(p.id, { name: e.target.value })} /><Toggle label={`Use ${p.name}`} on={p.enabled} onChange={(enabled) => prompt(p.id, { enabled })} /><Button size="sm" disabled={i === 0} onClick={() => { const preset = reorderBlock(phase.preset, p.id, ordered[i - 1]!.id); if (reorderChangesBuild(phase.preset, preset)) patch({ preset }); else ctx.setStatus("These blocks have different placement or order values. Change their settings to move them in the built prompt."); }}>Move up</Button><Button size="sm" onClick={() => selectBlock(p.id)}>Settings</Button><Button size="sm" variant="quiet" onClick={() => patch({ preset: deleteBlock(phase.preset, p.id) })}>Remove block</Button></div>{p.marker ? <p>Context: {p.markerSlot ?? p.id}</p> : <Textarea aria-label={`${p.name} instructions`} rows={4} value={p.content} onChange={(e) => prompt(p.id, { content: e.target.value })} />}</article>} />
    {selectedBlock && <PromptEditPanel ownerKey={phase.id} block={phase.preset.prompts.find((p) => p.id === selectedBlock) ?? null} stops={placementsForProfile("full")} writeFor="full" groups={phase.preset.groups ?? []} uploads={uploads} stageAsset={stageAsset} pinUploads={pinUploads} discardUploads={discardUploads} onAddAttachment={(attachment, receipt) => onAddAttachment(selectedBlock, attachment, receipt)} onRemoveAttachment={(ref, occurrence) => onRemoveAttachment(selectedBlock, ref, occurrence)} onSetGroup={(groupId) => prompt(selectedBlock, { groupId: groupId ?? undefined })} onClose={() => selectBlock(null)} onPatch={(over) => prompt(selectedBlock, over)} />}
  </section>;
}
