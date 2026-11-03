/** The Table Read app: a model-backed interview and one editable, resumable canonical character draft. */
import { useEffect, useLayoutEffect, useState, type JSX } from "react";
import { useStore } from "zustand";
import type { AppContext, BunzaiApp } from "../../app-contract";
import { Button, Segmented } from "../../components/button";
import { InkDialog } from "../../components/ink-dialog";
import { RoomHeader } from "../../components/room-header";
import { icSvg } from "../../_shared/ic-svg";
import { useVisibleInterval } from "../../_shared/use-visible-interval";
import { characterField } from "../../../core/table-read/fields";
import { Conversation } from "./conversation";
import { LivingCard } from "./living-card";
import { Setup } from "./setup";
import { useInterview } from "./use-interview";
import { bindInterviewDraft, manualDraftDirty, useTableReadDraftStore } from "./draft-store";
import { rapidChoicesComplete } from "./ui-core";
import { readerArt, READER_PREF, type ReaderArt } from "./reader-art";
import { ReaderPicker } from "./reader-picker";
import styles from "./styles.module.css";

export function TableRead({ ctx }: { ctx: AppContext }): JSX.Element {
  const { view, loading, error, busy, change, refresh } = useInterview(ctx);
  const drafts = useTableReadDraftStore(ctx);
  const session = view?.session;
  const [pane, setPane] = useState<"interview" | "card">("interview");
  const [discard, setDiscard] = useState(false);
  const [reader, setReader] = useState(() => readerArt(ctx.prefs.get(READER_PREF)));
  const chooseReader = (next: ReaderArt): void => { setReader(next); ctx.prefs.set(READER_PREF, next.id); };
  const dirty = useStore(drafts, manualDraftDirty);
  const draftAnswer = useStore(drafts, (state) => Boolean(state.answer?.text.trim()));
  const draftIdea = useStore(drafts, (state) => Boolean(state.setup.idea.trim()));
  const [now, setNow] = useState(Date.now);
  const sessionId = session?.id ?? null;
  const deadline = session?.deadline ?? null;
  const confirmed = view !== null;
  useLayoutEffect(() => { if (confirmed) bindInterviewDraft(drafts, sessionId); }, [confirmed, drafts, sessionId]);
  useLayoutEffect(() => { setNow(Date.now()); }, [deadline, sessionId]);
  useVisibleInterval(() => setNow(Date.now()), session?.deadline != null && session.phase === "interview" && !rapidChoicesComplete(session) && now < session.deadline ? 1000 : null);
  useEffect(() => {
    if (!dirty && !draftAnswer && (session || !draftIdea)) return;
    const protect = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, draftAnswer, draftIdea, session]);
  const openSaved = (): void => {
    if (!session?.saved) return;
    const summary = session.saved;
    ctx.pieces.accept(summary);
    ctx.workbench.open(summary);
  };
  const frozen = session?.phase === "committing";
  const actions = session ? <div className={styles.actions}>
    {session.phase === "review" && <Button variant="primary" icon="lucide:save" disabled={busy || dirty || !characterField(session.body, "name").trim()} onClick={() => { void change({ action: "save" }); }}>Save character</Button>}
    {frozen && !busy && !view?.running && <Button variant="primary" onClick={() => { void change({ action: "save" }); }}>Retry saving this character</Button>}
    {session.phase === "saved" && <Button variant="primary" icon="lucide:pen-line" onClick={openSaved}>Open in the Workbench</Button>}
    <Button variant="quiet" disabled={busy || frozen || dirty} onClick={() => setDiscard(true)}>{session.phase === "saved" ? "Start another" : "Discard interview"}</Button>
  </div> : undefined;

  return <main className={styles.room} data-part="table-read.room">
    <RoomHeader title="The Table Read" actions={actions} data-part="table-read.header" />
    {error && <div className={styles.error} role="alert" data-part="table-read.error"><span>{error}</span><Button variant="quiet" size="sm" onClick={() => { void refresh(); }}>Reload draft</Button></div>}
    {loading && !view ? <p className={styles.loading} role="status">Opening your Table Read...</p> : !view ? <div className={styles.empty}><p>Your interview could not be opened.</p><Button onClick={() => { void refresh(); }}>Try again</Button></div> : !session ? <Setup ctx={ctx} drafts={drafts} busy={busy} reader={reader} onReaderChange={chooseReader} onStart={(settings) => { void change({ action: "start", settings }); }} /> : <>
      <div className={styles.sessionLine} data-part="table-read.session">
        <span>{session.phase === "saved" ? "Saved to your Library" : session.phase === "committing" ? "Saving your reviewed card" : "Interview kept in your encrypted library"}</span>
        <span>Model: {session.settings.connection.model}</span>
        <ReaderPicker value={reader} onChange={chooseReader} compact />
      </div>
      <div className={styles.paneSwitch}><Segmented label="Table Read view" items={[{ value: "interview", label: "Interview" }, { value: "card", label: "Living card" }]} value={pane} onChange={setPane} data-part="table-read.panes" /></div>
      <div className={styles.workspace}>
        <div className={styles.interviewPane} data-active={pane === "interview"}><Conversation session={session} drafts={drafts} busy={busy} running={view.running} now={now} change={change} reader={reader} />
          {session.phase === "saved" && <div className={styles.saved} data-part="table-read.saved"><p className={styles.eyebrow}>Ready for their entrance</p><h2>{session.saved?.name || session.body.identity.name}</h2><p>Your character is in the Library. Open the Workbench to add artwork, expand their card or export them.</p><Button onClick={openSaved}>Open character</Button></div>}
        </div>
        <div className={styles.cardPane} data-active={pane === "card"}><LivingCard key={session.id} session={session} drafts={drafts} change={change} /></div>
      </div>
      {dirty && <p className={styles.unsaved} role="status">Keep or cancel your field edit before saving or discarding the interview.</p>}
    </>}
    {discard && session && <InkDialog ariaLabel={session.phase === "saved" ? "Start another Table Read?" : "Discard this interview?"} onDismiss={() => setDiscard(false)}>
      <h2 className={styles.heading}>{session.phase === "saved" ? "Ready for another character?" : "Put this interview away?"}</h2>
      <p>{session.phase === "saved" ? "Your saved character stays in the Library. This clears the interview so you can begin another." : "This clears the interview and its unsaved character draft. It cannot be undone. Saved characters in your Library are not removed."}</p>
      <div className={styles.actions}><Button onClick={() => setDiscard(false)}>Keep this interview</Button><Button variant="danger" disabled={busy || frozen} onClick={() => { void change({ action: "discard" }).then((done) => { if (done) setDiscard(false); }); }}>{session.phase === "saved" ? "Start another" : "Discard interview"}</Button></div>
    </InkDialog>}
  </main>;
}

const app: BunzaiApp = {
  manifest: { id: "table-read", title: "The Table Read", markSvg: icSvg("lucide:message-square", 18), accent: "var(--deck-character)", order: 15, subtitle: "Create by conversation", catalogOnly: true },
  Component: TableRead,
};
export default app;
