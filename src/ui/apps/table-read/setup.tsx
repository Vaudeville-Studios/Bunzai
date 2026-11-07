/** Table Read setup: three real interview tempos and the user's existing saved model choices. */
import type { JSX } from "react";
import { useStore } from "zustand";
import type { AppContext } from "../../app-contract";
import type { TableReadSettings } from "../../../core/table-read/schema";
import { TABLE_READ_LIMITS } from "../../../core/table-read/schema";
import { Button, Card } from "../../components/button";
import { Panel } from "../../components/panel";
import { Select, Textarea } from "../../components/rc-controls";
import { modelChoices, useSceneModels } from "../scenes/use-scene-models";
import { TEMPO_COPY } from "./ui-core";
import type { TableReadDraftStore } from "./draft-store";
import styles from "./styles.module.css";
import { ReaderPicker } from "./reader-picker";
import type { ReaderArt } from "./reader-art";

export function Setup({ ctx, drafts, busy, onStart, reader, onReaderChange }: { ctx: AppContext; drafts: TableReadDraftStore; busy: boolean; onStart(settings: TableReadSettings): void; reader: ReaderArt; onReaderChange(value: ReaderArt): void }): JSX.Element {
  const { tempo, idea, model } = useStore(drafts, (state) => state.setup);
  const update = (change: Partial<{ tempo: TableReadSettings["tempo"]; idea: string; model: string }>): void => drafts.setState((state) => ({ setup: { ...state.setup, ...change } }));
  const models = useSceneModels(ctx, null, () => undefined);
  const choices = modelChoices(models);
  const picked = choices.find((choice) => choice.value === model);
  const available = (models.conns ?? []).some((connection) => !connection.unavailable);
  const copy = TEMPO_COPY.find((mode) => mode.value === tempo)!;
  return <div className={styles.setup} data-part="table-read.setup">
    <div className={styles.tempos} aria-label="Choose an interview tempo">
      {TEMPO_COPY.map(/* bounded-ok: the three interview modes */ (mode) => <Card key={mode.value} kind="choice" selected={mode.value === tempo} aria-pressed={mode.value === tempo} mark="Selected" kicker={mode.title} heading={mode.subtitle} onClick={() => update({ tempo: mode.value })} disabled={busy} data-part="table-read.tempo" />)}
    </div>
    <ReaderPicker value={reader} onChange={onReaderChange} />
    <Panel className={styles.setupBody} data-part="table-read.brief">
      <div>
        <p className={styles.eyebrow}>The first spark</p>
        <h2 className={styles.heading}>Who are we bringing to life?</h2>
        <p className={styles.muted}>A name, a scene, a strange habit. Start with what you already know. The Understudy will ask about the rest.</p>
        <label className={styles.label} htmlFor="table-read-idea">Your character idea</label>
        <Textarea id="table-read-idea" value={idea} maxLength={TABLE_READ_LIMITS.idea} rows={6} disabled={busy} placeholder="Vesper runs a midnight bar where every drink buys a secret. She keeps a ledger of favors, but quietly pays off debts she should be collecting." onChange={(event) => update({ idea: event.target.value })} />
      </div>
      <div className={styles.setupAside}>
        <label className={styles.label} htmlFor="table-read-model">Interview model</label>
        <Select id="table-read-model" value={model} disabled={busy || !choices.length} onChange={(event) => update({ model: event.target.value })}>
          <option value="">{models.conns === null ? "Loading your connections..." : "Choose a saved model"}</option>
          {choices.map(/* bounded-ok: shared saved model choices in a native select */ (choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </Select>
        {models.conns !== null && !available ? <div className={styles.empty}>
          <strong>Add a provider to begin.</strong>
          <p>The Table Read uses a connection you choose. Your answers are sent to that model; no other Library pieces are included.</p>
          <Button size="sm" onClick={(event) => { event.currentTarget.ownerDocument.defaultView!.location.hash = "settings/models"; ctx.openApp("settings"); }}>Open Connections</Button>
        </div> : <p className={styles.muted}>Use any available saved connection. A local model works too.</p>}
        <div className={styles.modeNote}><strong>{copy.title}</strong><p>{copy.detail}</p></div>
        <p className={styles.muted}>Your interview is kept in the encrypted library. Nothing becomes a Library character until you review and save.</p>
        <Button variant="primary" icon="lucide:message-square" disabled={busy || !picked || !idea.trim()} onClick={() => { if (picked) onStart({ tempo, connection: picked.conn, idea: idea.trim() }); }}>
          {busy ? "Preparing your Table Read..." : "Begin the Table Read"}
        </Button>
      </div>
    </Panel>
  </div>;
}
