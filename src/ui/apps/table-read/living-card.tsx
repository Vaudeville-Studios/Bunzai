/** Workbench character sections over the interview's canonical body and explicit bounded scratch edits. */
import { useState, type JSX } from "react";
import { useStore } from "zustand";
import { characterField, FIELD_LABELS, type TableReadField } from "../../../core/table-read/fields";
import { TABLE_READ_LIMITS, type TableReadSession } from "../../../core/table-read/schema";
import { Button } from "../../components/button";
import { Textarea } from "../../components/rc-controls";
import { BentoCard } from "../../components/bento-card";
import { useCopyFeedback } from "../../_shared/use-copy-feedback";
import { EditorField } from "../workbench/layout/editor-field";
import { CharacterTextControl } from "../workbench/controls/character-text-control";
import { FIELD_MODULES } from "../workbench/fields";
import editorStyles from "../workbench/editor-styles";
import type { TableReadCommand } from "./use-interview";
import { manualDraftDirty, type TableReadDraftStore } from "./draft-store";
import { useFieldUpdates } from "./use-field-updates";
import styles from "./styles.module.css";

const SECTIONS: readonly (readonly [string, readonly TableReadField[]])[] = [
  ["Identity", ["name", "tagline"]], ["Description", ["description"]],
  ["Personality", ["personality"]], ["Scenario", ["scenario"]],
  ["First Message", ["firstMessage"]], ["Examples", ["exampleMessages"]],
];
const editorId = (field: TableReadField): string => field === "firstMessage" ? "firstMes" : field === "exampleMessages" ? "mesExample" : field;

export function LivingCard({ session, drafts, change }: { session: TableReadSession; drafts: TableReadDraftStore; change(command: TableReadCommand): Promise<boolean> }): JSX.Element {
  const edit = useStore(drafts, (state) => state.edit);
  const dirty = useStore(drafts, manualDraftDirty);
  const setEdit = (next: { field: TableReadField; value: string; baseline: string } | null): void => drafts.setState({ edit: next });
  const [keeping, setKeeping] = useState(false);
  const updated = useFieldUpdates(session, drafts);
  const [copyState, copyEdit] = useCopyFeedback(edit?.value ?? "");
  const frozen = session.phase === "committing" || session.phase === "saved";
  const begin = (field: TableReadField, value: string): void => {
    if (!frozen && !keeping && edit?.field !== field && !dirty) setEdit({ field, value, baseline: value });
  };
  const keep = async (): Promise<void> => {
    if (!edit || keeping || frozen) return;
    const sent = edit;
    setKeeping(true);
    try { if (await change({ action: "edit", field: sent.field, value: sent.value }) && drafts.getState().edit === sent) setEdit(null); }
    finally { setKeeping(false); }
  };
  return <div className={styles.living} data-editor="frame" data-part="table-read.card">
    {frozen && edit && <section className={styles.editForm} data-part="table-read.card.retained-edit">
      <label className={styles.label} htmlFor="table-read-retained-edit">Your unkept {FIELD_LABELS[edit.field]} edit</label>
      <p className={styles.muted}>The reviewed card is being saved or is already in your Library. This local edit has not been applied. Copy it into the Workbench after saving completes, or discard it here.</p>
      <Textarea id="table-read-retained-edit" rows={5} readOnly value={edit.value} onFocus={(event) => event.currentTarget.select()} />
      <div className={styles.actions}><Button size="sm" onClick={copyEdit}>{copyState === "copied" ? "Copied" : "Copy unkept edit"}</Button><Button size="sm" variant="quiet" onClick={() => setEdit(null)}>Discard unkept edit</Button></div>
      {copyState === "failed" && <p className={styles.muted} role="status">Copy was unavailable. Select the text above and copy it manually.</p>}
    </section>}
    {SECTIONS.map(/* bounded-ok: six sections for the seven supported character fields */ ([title, fields]) => <BentoCard key={title} title={title}>
      {fields.map(/* bounded-ok: Identity has two fields; each other section has one */ (field) => {
        const module = FIELD_MODULES.find((item) => item.id === editorId(field))!;
        const accepted = characterField(session.body, field);
        const active = edit?.field === field && !frozen;
        const value = active ? edit.value : accepted;
        const disabled = frozen || keeping || (dirty && !active);
        return <div key={field} className={styles.field} data-updated={updated.includes(field) || undefined} data-part="table-read.card.field">
          <EditorField label={module.sheetLabel} required={module.required} htmlFor={`table-read-field-${field}`} wide={module.kind === "prose"}>
            <CharacterTextControl field={module} id={`table-read-field-${field}`} value={value} styles={editorStyles} maxLength={TABLE_READ_LIMITS.field} disabled={disabled} defaultRendered={false}
              onFocus={() => begin(field, accepted)} onChange={(next) => {
                if (disabled) return;
                setEdit({ field, value: next, baseline: active ? edit.baseline : accepted });
              }} />
          </EditorField>
          <span className={styles.fieldMeta}>{updated.includes(field) && <span role="status">Updated</span>}{session.manual.includes(field) ? "Your edit" : !accepted ? "Unwritten" : ""}</span>
          {active && <form className={styles.editForm} onSubmit={(event) => { event.preventDefault(); void keep(); }}>
            <div className={styles.actions}><Button type="submit" size="sm" disabled={keeping}>{keeping ? "Keeping..." : "Keep edit"}</Button><Button size="sm" variant="quiet" disabled={keeping} onClick={() => setEdit(null)}>Cancel edit</Button></div>
            <span className={styles.muted}>{dirty ? "This edit has not been kept yet. Keep or cancel it before editing another field." : "Keeping an empty field leaves it blank."}</span>
          </form>}
        </div>;
      })}
    </BentoCard>)}
  </div>;
}
