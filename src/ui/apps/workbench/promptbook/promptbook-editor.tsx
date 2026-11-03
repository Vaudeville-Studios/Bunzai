/** The Promptbook's three views share one revision-checked draft; rehearsal never sends a model request. */
import { useRef, useState, type JSX } from "react";
import type { PromptbookBody, BookPhase } from "../../../../entities/promptbook/schema";
import { bookRecipe, newBookPhase, phaseVerdict } from "../../../../core/promptbook";
import type { LoreScan } from "../../../../core/lore/engine";
import { Button, Segmented } from "../../../components/button";
import { Input, Textarea } from "../../../components/rc-controls";
import { VirtualRows, VirtualShelf } from "../../../_shared/virtual-list";
import type { KindEditorProps } from "../editors";
import { PieceFrame } from "../pieces/piece-frame";
import { usePieceEditor } from "../pieces/use-piece-editor";
import { PhaseEditor } from "./phase-editor";
import { BookBoard } from "./book-board";
import { BookCards } from "./book-cards";
import { promptbookBodySchema } from "../../../../entities/promptbook/runtime-schema";
import { Select } from "../../../components/rc-controls";
import s from "./promptbook.module.css";
import { useAssetUploads } from "../../../_shared/asset-upload";
import { toErrorMessage } from "../../../_shared/error-message";
import type { PresetAttachment } from "../../../../entities/preset/schema";

export function PromptbookEditor({ entity, revision, ctx, piece, topRight }: KindEditorProps): JSX.Element {
  const media = useAssetUploads(ctx.api.uploadAsset, ctx.api.discardAssetUploads, (error) => ctx.setStatus(toErrorMessage(error, "could not stage prompt attachment")));
  const session = usePieceEditor<PromptbookBody>({ kind: "promptbook", entity, revision, ctx, piece, assetUploads: media });
  const { body, edit } = session;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const [view, setView] = useState<"phases" | "cards" | "board">("phases");
  const [selected, select] = useState(body.phases[0]!.id);
  const [line, setLine] = useState("");
  const [sample, rehearse] = useState<string | null>(null);
  const [setupName, setSetupName] = useState("");
  const phase = body.phases.find((p) => p.id === selected) ?? body.phases[0]!;
  const update = (next: BookPhase) => edit((b) => ({ ...b, phases: b.phases.map((p) => p.id === next.id ? next : p) }));
  const updatePromptAttachment = (phaseId: string, promptId: string, attachment: PresetAttachment | string, occurrence?: number): boolean => {
    let next = bodyRef.current;
    let changed = false;
    edit((current) => {
      const phaseAt = current.phases.findIndex((p) => p.id === phaseId);
      const phase = current.phases[phaseAt];
      const promptAt = phase?.preset.prompts.findIndex((prompt) => prompt.id === promptId) ?? -1;
      const prompt = phase?.preset.prompts[promptAt];
      if (!phase || !prompt) return current;
      const attachments = prompt.attachments ?? [];
      const removeAt = typeof attachment === "string" ? (occurrence ?? attachments.findIndex((item) => item.ref === attachment)) : -1;
      if (typeof attachment === "string" && (removeAt < 0 || attachments[removeAt]?.ref !== attachment)) return current;
      if (typeof attachment !== "string" && attachments.some((item) => item.ref === attachment.ref)) return current;
      const prompts = [...phase.preset.prompts];
      prompts[promptAt] = { ...prompt, attachments: typeof attachment === "string" ? attachments.filter((_item, index) => index !== removeAt) : [...attachments, attachment] };
      const phases = [...current.phases];
      phases[phaseAt] = { ...phase, preset: { ...phase.preset, prompts } };
      next = { ...current, phases };
      changed = true;
      return next;
    });
    bodyRef.current = next;
    return changed;
  };
  const scan: LoreScan = { messages: [{ role: "user", content: sample ?? "" }], messageCount: 1, character: { name: "", description: "", personality: "", scenario: "", tags: [] }, persona: "", variables: {}, generationType: "normal", now: 0 };
  const add = (role: "private" | "after") => {
    const made = newBookPhase(crypto.randomUUID(), role === "private" ? "Think" : "Tidy up", role);
    edit((b) => { const phases = [...b.phases]; phases.splice(role === "private" ? phases.findIndex((p) => p.role === "reply") : phases.length, 0, made); return { ...b, phases }; });
    select(made.id);
  };
  const remove = (id: string) => edit((b) => ({ ...b, phases: b.phases.filter((p) => p.id !== id).map((p) => ({ ...p, reads: p.reads.filter((from) => from !== id) })), setups: b.setups.map((setup) => ({ ...setup, off: setup.off.filter((from) => from !== id) })) }));
  const move = (by: number) => {
    const phases = [...body.phases]; const from = phases.findIndex((p) => p.id === phase.id); const to = from + by;
    if (!phases[to]) return;
    [phases[from], phases[to]] = [phases[to]!, phases[from]!];
    if (promptbookBodySchema.safeParse({ ...body, phases }).success) edit((b) => ({ ...b, phases }));
    else ctx.setStatus("That move would put a phase before notes it reads, or cross the reply. Change its hand-offs first.");
  };
  return <PieceFrame kind="Promptbook" noun="promptbook" piece={piece} session={session} meta={`${body.phases.length} phases`} topRight={topRight}>
    <div className={s.root} data-part="promptbook.editor">
      <div className={s.toolbar}>
        <Segmented label="Promptbook view" value={view} onChange={setView} items={[{ value: "phases", label: "Phases" }, { value: "cards", label: "Cards" }, { value: "board", label: "Board" }]} />
        <Button size="sm" onClick={() => add("private")}>Add private phase</Button><Button size="sm" onClick={() => add("after")}>Add after phase</Button>
      </div>
      <Textarea aria-label="Promptbook description" rows={2} placeholder="What is this book for?" value={body.description} onChange={(e) => edit((b) => ({ ...b, description: e.target.value }))} />
      <div className={s.toolbar}><Button size="sm" disabled={body.phases.indexOf(phase) === 0} onClick={() => move(-1)}>Move phase earlier</Button><Button size="sm" disabled={body.phases.indexOf(phase) === body.phases.length - 1} onClick={() => move(1)}>Move phase later</Button></div>
      <div className={s.toolbar}><Input aria-label="Setup name" placeholder="Save this on/off setup" value={setupName} onChange={(e) => setSetupName(e.target.value)} /><Button size="sm" disabled={!setupName.trim()} onClick={() => { edit((b) => ({ ...b, setups: [...b.setups, { id: crypto.randomUUID(), name: setupName.trim(), off: b.phases.filter((p) => !p.enabled).map((p) => p.id) }] })); setSetupName(""); }}>Save setup</Button><Select aria-label="Apply setup" value="" onChange={(e) => { const setup = body.setups.find((s) => s.id === e.target.value); if (setup) edit((b) => ({ ...b, phases: b.phases.map((p) => ({ ...p, enabled: !setup.off.includes(p.id) })) })); }}><option value="">Apply a saved setup…</option>{body.setups.map(/* bounded-ok: native select options for the book's saved setups */ (setup) => <option key={setup.id} value={setup.id}>{setup.name}</option>)}</Select></div>
      {body.phases.length === 1 && body.phases[0]!.cards.length === 0 && <section className={s.recipes} aria-label="Promptbook recipes"><h2>How should your story think?</h2><p>Start with a reply, or plan quietly before writing it.</p><Button onClick={() => { const recipe = bookRecipe(body.name, "think"); const think = { ...recipe.phases[0]!, id: crypto.randomUUID() }; edit((b) => ({ ...b, phases: [think, { ...b.phases[0]!, reads: [think.id] }] })); select(think.id); }}>Think, then write</Button></section>}
      <div className={s.layout}>
        <section className={s.main}>
          {view === "board" ? <BookBoard phases={body.phases} selected={phase.id} onSelect={select} onChange={update} ctx={ctx} bookId={piece.id} /> : view === "cards" ? <VirtualShelf items={body.phases} keyOf={(p) => p.id} rowClass={s.columns!} estimate={420} render={(p) => <section className={s.phaseColumn}><Button block aria-pressed={p.id === phase.id} onClick={() => select(p.id)}>{p.name} · {p.role}</Button><BookCards phase={p} ctx={ctx} onChange={update} expanded /></section>} /> : <nav className={s.phaseList} aria-label="Phases"><VirtualRows items={body.phases} keyOf={(p) => p.id} estimate={74} render={(p, i) => <Button block variant={p.id === phase.id ? "primary" : "quiet"} aria-pressed={p.id === phase.id} onClick={() => select(p.id)}>{i + 1}. {p.name} · {p.role === "reply" ? "The reply" : p.role}{sample !== null ? ` · ${phaseVerdict(p, scan).on ? "Runs" : "Skipped"}` : ""}</Button>} /></nav>}
          <PhaseEditor phase={phase} earlier={body.phases.slice(0, body.phases.indexOf(phase))} ctx={ctx} onChange={update} cards={view === "cards"} onRemove={() => remove(phase.id)} uploads={media.uploads} stageAsset={media.stageAsset} pinUploads={media.pin} discardUploads={media.discard} onAddAttachment={(promptId, attachment) => updatePromptAttachment(phase.id, promptId, attachment)} onRemoveAttachment={(promptId, ref, occurrence) => updatePromptAttachment(phase.id, promptId, ref, occurrence)} />
        </section>
        <aside className={s.rehearsal} data-part="promptbook.rehearsal"><h2>Try a line</h2><p>Check phase conditions. No model calls or saved scene changes. Library skills still use their own conditions.</p><Input aria-label="Rehearsal line" value={line} onChange={(e) => setLine(e.target.value)} /><Button onClick={() => rehearse(line)}>Try</Button>
          {sample !== null && <VirtualRows items={body.phases} keyOf={(p) => p.id} estimate={82} render={(p) => { const verdict = phaseVerdict(p, scan); return <article className={s.trace} data-on={verdict.on}><strong>{p.name}: {verdict.on ? "Runs" : "Skipped"}</strong><p>{verdict.why}</p>{p.reads.length > 0 && <small>Reads: {p.reads.map((id) => body.phases.find((from) => from.id === id)?.name).join(", ")}</small>}</article>; }} />}
        </aside>
      </div>
    </div>
  </PieceFrame>;
}
