/** The canonical character's living card, with explicit manual edits that survive later model proposals. */
import { useState, type JSX } from "react";
import { useStore } from "zustand";
import { characterField, FIELD_LABELS, TABLE_READ_FIELDS, type TableReadField } from "../../../core/table-read/fields";
import { TABLE_READ_LIMITS, type TableReadSession } from "../../../core/table-read/schema";
import { Button } from "../../components/button";
import { Input, Textarea } from "../../components/rc-controls";
import { Panel } from "../../components/panel";
import { useCopyFeedback } from "../../_shared/use-copy-feedback";
import type { TableReadCommand } from "./use-interview";
import { manualDraftDirty, type TableReadDraftStore } from "./draft-store";
import styles from "./styles.module.css";

export function LivingCard({ session, drafts, change }: { session: TableReadSession; drafts: TableReadDraftStore; change(command: TableReadCommand): Promise<boolean> }): JSX.Element {
  const edit = useStore(drafts, (state) => state.edit);
  const dirty = useStore(drafts, manualDraftDirty);
  const setEdit = (next: { field: TableReadField; value: string; baseline: string } | null): void => drafts.setState({ edit: next });
  const [keeping, setKeeping] = useState(false);
  const [copyState, copyEdit] = useCopyFeedback(edit?.value ?? "");
  const frozen = session.phase === "committing" || session.phase === "saved";
  const keep = async (): Promise<void> => {
    if (!edit || keeping || frozen) return;
    const sent = edit;
    setKeeping(true);
    try { if (await change({ action: "edit", field: sent.field, value: sent.value }) && drafts.getState().edit === sent) setEdit(null); }
    finally { setKeeping(false); }
  };
  return <Panel deck="character" className={styles.living} data-part="table-read.card">
    <div className={styles.panelTop}><div><p className={styles.eyebrow}>The living card</p><h2 className={styles.cardName}>{session.body.identity.name || "A character taking shape"}</h2></div><span className={styles.status}>{session.phase === "saved" ? "In your Library" : "Interview draft"}</span></div>
    <p className={styles.muted}>You can take the pen at any time. Fields you edit stay yours.</p>
    {frozen && edit && <section className={styles.editForm} data-part="table-read.card.retained-edit">
      <label className={styles.label} htmlFor="table-read-retained-edit">Your unkept {FIELD_LABELS[edit.field]} edit</label>
      <p className={styles.muted}>The reviewed card is being saved or is already in your Library. This local edit has not been applied. Copy it into the Workbench after saving completes, or discard it here.</p>
      <Textarea id="table-read-retained-edit" rows={5} readOnly value={edit.value} onFocus={(event) => event.currentTarget.select()} />
      <div className={styles.actions}><Button size="sm" onClick={copyEdit}>{copyState === "copied" ? "Copied" : "Copy unkept edit"}</Button><Button size="sm" variant="quiet" onClick={() => setEdit(null)}>Discard unkept edit</Button></div>
      {copyState === "failed" && <p className={styles.muted} role="status">Copy was unavailable. Select the text above and copy it manually.</p>}
    </section>}
    <div className={styles.fields}>
      {TABLE_READ_FIELDS.map(/* bounded-ok: the seven canonical interview fields */ (field) => {
        const value = characterField(session.body, field);
        const manual = session.manual.includes(field);
        return <section key={field} className={styles.field} data-part="table-read.card.field">
          <div className={styles.fieldHead}><h3>{FIELD_LABELS[field]}</h3><span className={styles.fieldMeta}>{manual ? "Your edit" : value ? "Drafted" : "Not drafted yet"}</span>
            {!frozen && <Button size="sm" variant="quiet" disabled={keeping || (dirty && edit?.field !== field)} aria-label={`Edit ${FIELD_LABELS[field]}`} onClick={() => setEdit({ field, value, baseline: value })}>Edit</Button>}
          </div>
          {edit?.field === field && !frozen ? <form className={styles.editForm} onSubmit={(event) => { event.preventDefault(); void keep(); }}>
            <label className="sr-only" htmlFor={`table-read-field-${field}`}>{FIELD_LABELS[field]}</label>
            {field === "name" || field === "tagline" ? <Input id={`table-read-field-${field}`} autoFocus maxLength={TABLE_READ_LIMITS.field} value={edit.value} disabled={keeping} onChange={(event) => setEdit({ ...edit, value: event.target.value })} /> : <Textarea id={`table-read-field-${field}`} autoFocus rows={6} maxLength={TABLE_READ_LIMITS.field} value={edit.value} disabled={keeping} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />}
            <div className={styles.actions}><Button type="submit" size="sm" disabled={keeping}>{keeping ? "Keeping..." : "Keep edit"}</Button><Button size="sm" variant="quiet" disabled={keeping} onClick={() => setEdit(null)}>Cancel edit</Button><span className={styles.muted}>{dirty ? "This edit has not been kept yet." : "Keeping an empty field leaves it blank."}</span></div>
          </form> : <p className={value ? styles.fieldText : styles.placeholder}>{value || (manual ? "Kept blank" : "This part will take shape as you answer.")}</p>}
        </section>;
      })}
    </div>
  </Panel>;
}
