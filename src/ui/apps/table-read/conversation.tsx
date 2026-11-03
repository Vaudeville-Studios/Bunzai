/** The interview side of the Living Card: accepted answers, one current question and truthful composing state. */
import { useEffect, useRef, useState, type JSX } from "react";
import { useStore } from "zustand";
import type { TableReadSession } from "../../../core/table-read/schema";
import { TABLE_READ_LIMITS } from "../../../core/table-read/schema";
import { missingFields } from "../../../core/table-read/interview";
import { FIELD_LABELS } from "../../../core/table-read/fields";
import { Button, Chip, Disclosure } from "../../components/button";
import { Panel } from "../../components/panel";
import { Textarea } from "../../components/rc-controls";
import { VirtualRows } from "../../_shared/virtual-list";
import type { TableReadCommand } from "./use-interview";
import { rapidChoicesComplete, secondsRemaining, TEMPO_COPY } from "./ui-core";
import type { TableReadDraftStore } from "./draft-store";
import styles from "./styles.module.css";

export function Conversation({ session, drafts, busy, running, now, change }: { session: TableReadSession; drafts: TableReadDraftStore; busy: boolean; running: boolean; now: number; change(command: TableReadCommand): Promise<boolean> }): JSX.Element {
  const heldAnswer = useStore(drafts, (state) => state.answer);
  const [history, setHistory] = useState(false);
  const question = session.question;
  const answer = heldAnswer?.questionId === question?.id ? heldAnswer?.text ?? "" : "";
  const setAnswer = (text: string): void => { if (question) drafts.setState({ answer: { questionId: question.id, text } }); };
  const questionId = question?.id;
  const questionRef = useRef<HTMLHeadingElement>(null);
  const rapid = session.settings.tempo === "rapid-fire";
  const completed = rapidChoicesComplete(session);
  const seconds = session.deadline === null ? null : secondsRemaining(session.deadline, now);
  const waiting = busy || running || session.pending !== null;
  const mayAnswer = !waiting && session.phase === "interview" && question !== null && (!rapid || seconds === null || seconds > 0);
  const missing = missingFields(session);
  useEffect(() => { if (questionId) questionRef.current?.focus(); }, [questionId]);
  const submit = async (): Promise<void> => {
    if (!question || !mayAnswer || !answer.trim()) return;
    const asked = answer;
    const sent = heldAnswer;
    if (await change({ action: "answer", questionId: question.id, answer: { kind: "freeform", text: asked } }) && drafts.getState().answer === sent) drafts.setState({ answer: null });
  };
  return <Panel className={styles.conversation} data-part="table-read.conversation">
    <div className={styles.panelTop}>
      <div><p className={styles.eyebrow}>The interview</p><h2 className={styles.heading}>The Understudy</h2></div>
      <span className={styles.status}>{TEMPO_COPY.find((mode) => mode.value === session.settings.tempo)?.title}</span>
    </div>
    <p className={styles.brief}>{session.settings.idea}</p>
    {session.transcript.length > 0 && <div className={styles.history}>
      <Disclosure open={history} onClick={() => setHistory(!history)} label={`${session.transcript.length} ${session.transcript.length === 1 ? "answer" : "answers"} kept`} data-part="table-read.history.toggle" />
      {history && <div className={styles.historyList} data-part="table-read.history">
        <VirtualRows items={session.transcript} keyOf={(_entry, index) => String(index)} estimate={140} render={(entry) => <article className={styles.exchange}>
          <p><span>Understudy</span>{entry.question}</p><p><span>You</span>{entry.answer}</p>
        </article>} />
      </div>}
    </div>}
    {session.phase === "interview" && <div className={styles.questionArea} data-part="table-read.question">
      <div className={styles.panelTop}>
        <span className={styles.eyebrow}>{completed ? "All choices kept" : question ? `Question ${session.turn + 1}` : "Finding the next question"}</span>
        {rapid && seconds !== null && !completed && <span className={styles.clock} role="timer" aria-label={`${seconds} seconds remaining`}>{seconds}s</span>}
      </div>
      {question && <h3 ref={questionRef} tabIndex={-1} className={styles.question}>{question.text}</h3>}
      {question && <div className={styles.choices} aria-label="Quick answers">
        {question.chips.map(/* bounded-ok: a question has at most six quick answers */ (chip) => <Chip key={chip.id} disabled={!mayAnswer} onClick={() => { void change({ action: "answer", questionId: question.id, answer: { kind: "chip", chipId: chip.id } }); }} data-part="table-read.answer.choice">{chip.label}</Chip>)}
      </div>}
      {!rapid && question && <form className={styles.answerForm} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className={styles.label} htmlFor="table-read-answer">Or write your own</label>
        <Textarea id="table-read-answer" rows={4} maxLength={TABLE_READ_LIMITS.answer} value={answer} disabled={!mayAnswer} placeholder="Give them a detail only you would think of..." onChange={(event) => setAnswer(event.target.value)} />
        <div className={styles.actions}><Button type="submit" variant="primary" disabled={!mayAnswer || !answer.trim()}>Keep this answer</Button></div>
      </form>}
      {rapid && seconds === 0 && !completed && !waiting && <p className={styles.muted}>Time is up. Review the draft as it stands, or ask the interviewer to finish it.</p>}
      {completed && !waiting && <p className={styles.muted}>Every choice is kept. Review your draft, or ask the interviewer to bring the answers together.</p>}
      {(busy || running) && <div className={styles.composing} role="status"><span className={styles.busyMark} aria-hidden="true" />{session.pending?.kind === "finish" ? "Putting your answers into a character..." : rapid && session.deadline === null ? "Preparing your quick picks. The clock has not started." : "The Understudy is working with your answer..."}</div>}
      {session.pending && !running && !busy && <p className={styles.muted}>An earlier request still owns this draft. You can stop it before retrying.</p>}
      <div className={styles.actions}>
        {session.pending && <Button onClick={() => { void change({ action: "stop" }); }} data-part="table-read.stop">Stop</Button>}
        {!running && !busy && (session.retryKind || session.error || session.pending) && <Button onClick={() => { void change({ action: "retry" }); }}>{session.error || session.pending ? "Retry" : "Continue the interview"}</Button>}
        <Button variant="quiet" onClick={() => { void change({ action: "review" }); }} data-part="table-read.review-current" title="Review the draft already kept here, without another model request">Review current draft</Button>
        {!waiting && <Button variant="quiet" onClick={() => { void change({ action: "finish" }); }}>Finish with the interviewer</Button>}
      </div>
    </div>}
    {!waiting && heldAnswer?.text && heldAnswer.questionId !== question?.id && <div className={styles.direction} data-part="table-read.answer.kept">
      <p className={styles.eyebrow}>Kept draft answer</p><p>{heldAnswer.text}</p><p className={styles.muted}>This text has not been submitted to the current question. You can copy it before clearing it.</p>
      <Button size="sm" variant="quiet" onClick={() => drafts.setState({ answer: null })}>Discard draft answer</Button>
    </div>}
    {(session.phase === "review" || session.phase === "committing") && <div className={styles.reviewNote} data-part="table-read.review">
      <p className={styles.eyebrow}>Your character, your call</p><h3 className={styles.question}>Give them one last read.</h3>
      <p>This is your current draft. Reviewing it does not ask the model to complete it.</p>
      <p>Edit anything on the living card. Blank fields are still blank; you can fill them here or later in the Workbench.</p>
      {missing.length > 0 && <p className={styles.muted}>Still blank: {missing.map((field) => FIELD_LABELS[field]).join(", ")}.</p>}
      <p className={styles.muted}>The drafted wording is a proposal based on this interview. Keep what sounds like your character.</p>
      {session.phase === "committing" && <p role="status">Keeping your reviewed character in the Library...</p>}
    </div>}
    {session.error && <p className={styles.failure} role="alert">{session.error}</p>}
    {session.note && <p className={styles.direction} data-part="table-read.direction">{session.note}</p>}
  </Panel>;
}
