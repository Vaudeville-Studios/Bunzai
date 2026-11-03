/** Pure bounded interview transitions: one canonical draft, manual ownership and mode-specific progress. */
import { emptyCharacterBody } from "../../entities/character/schema";
import { characterField, setCharacterField, TABLE_READ_FIELDS, type TableReadField } from "./fields";
import { TABLE_READ_LIMITS, type TableReadAnswer, type TableReadDeckAnswer, type TableReadModelAnswer, type TableReadQuestion, type TableReadSession, type TableReadSettings } from "./schema";

export function newInterview(settings: TableReadSettings, id: string, cardId: string): TableReadSession {
  return { id, cardId, settings, body: emptyCharacterBody(""), manual: [], covered: [], followed: [], deflections: null, transcript: [], question: null, deck: [], phase: "interview", turn: 0, deadline: null, note: "", error: null, pending: null, retryKind: null, commit: null, saved: null };
}

/** Persisted manual ownership includes deliberate empty values and applies to every future response. */
export function editInterview(session: TableReadSession, field: TableReadField, value: string): TableReadSession {
  return { ...session, body: setCharacterField(session.body, field, value), manual: [...new Set([...session.manual, field])], covered: [...new Set([...session.covered, field])], pending: null, error: null };
}

function patched(session: TableReadSession, patches: TableReadModelAnswer["patches"]): TableReadSession {
  let body = session.body;
  for (const patch of patches) if (!session.manual.includes(patch.field)) body = setCharacterField(body, patch.field, patch.value);
  return { ...session, body };
}

const hostedQuestion = (question: TableReadDeckAnswer["questions"][number], id: string): TableReadQuestion => ({
  field: question.field, text: question.text, id, chips: question.chips.map((label, index) => ({ id: `${id}-${index}`, label, value: label })),
});

/** A deck is prepared before the Rapid Fire clock begins; choosing a chip needs no inference call. */
export function applyDeck(session: TableReadSession, answer: TableReadDeckAnswer, now: number): TableReadSession {
  const next = patched(session, answer.patches);
  const deck = answer.questions.filter((question) => !next.manual.includes(question.field)).map((question, index) => hostedQuestion(question, `${session.id}-rapid-${index}`));
  if (deck.length === 0) return { ...next, phase: "review", pending: null, retryKind: null };
  return { ...next, question: deck[0]!, deck: deck.slice(1), deadline: now + TABLE_READ_LIMITS.rapidMs, pending: null, retryKind: null, error: null };
}

/** One accepted answer; stale identities and invalid chip choices never advance a session. */
export function acceptAnswer(session: TableReadSession, questionId: string, answer: TableReadAnswer, now: number): TableReadSession {
  const question = session.question;
  if (session.phase !== "interview" || !question || question.id !== questionId) throw new Error("This question has changed. Reload the interview before answering.");
  const rapid = session.settings.tempo === "rapid-fire";
  if (rapid && session.deadline !== null && now >= session.deadline) throw new Error("Rapid Fire has ended. Finish the card from the choices you made.");
  if (rapid && answer.kind === "freeform") throw new Error("Rapid Fire accepts the displayed choices only.");
  const text = answer.kind === "freeform" ? answer.text : question.chips.find((chip) => chip.id === answer.chipId)?.value;
  if (!text?.trim()) throw new Error("Choose one of this question's options or write an answer.");
  const turn = session.turn + 1;
  if (turn > TABLE_READ_LIMITS.turns) throw new Error("The interview has reached its question limit. Finish your card.");
  const transcript = [...session.transcript, { question: question.text, answer: text, field: question.field }];
  if (!rapid) return { ...session, turn, transcript, question: null, error: null };
  const previous = characterField(session.body, question.field);
  const combined = previous ? `${previous}\n${text}` : text;
  // Every accepted choice remains in the transcript. A full field waits for final synthesis rather than silently clipping it.
  const body = session.manual.includes(question.field) || combined.length > TABLE_READ_LIMITS.field ? session.body : setCharacterField(session.body, question.field, combined);
  return { ...session, body, turn, transcript, question: session.deck[0] ?? null, deck: session.deck.slice(1), error: null };
}

/** The host enforces ceilings and coverage even when a model keeps proposing more questions. */
export function applyModelAnswer(session: TableReadSession, answer: TableReadModelAnswer, finishing = false): TableReadSession {
  const next = patched(session, answer.patches);
  const prior = session.transcript.at(-1)?.field;
  const deflections = answer.deflection && prior ? { field: prior, count: Math.min(2, session.deflections?.field === prior ? session.deflections.count + 1 : 1) } : null;
  const covered = [...new Set([...next.covered, ...answer.covered, ...(deflections?.count === 2 ? [deflections.field] : [])])];
  const deep = session.settings.tempo === "deep-dive";
  const limit = deep ? 20 : 8;
  const target = deep ? 12 : 5;
  const proposed = answer.question;
  const follow = deep && proposed !== null && answer.followUp === proposed.field && !session.followed.includes(proposed.field) && !session.manual.includes(proposed.field);
  const asked = proposed ? session.transcript.filter((entry) => entry.field === proposed.field).length : 0;
  const reask = proposed !== null && deflections?.field === proposed.field && deflections.count === 1;
  const ready = TABLE_READ_FIELDS.filter((field) => !["tagline", "exampleMessages"].includes(field)).every((field) => characterField(next.body, field).trim().length > 0);
  const complete = finishing || session.turn >= limit || (!proposed && ready) || (session.turn >= target && ready);
  const mayAsk = proposed && !session.manual.includes(proposed.field) && (!covered.includes(proposed.field) || follow || reask) && (asked === 0 || (asked === 1 && (follow || reask)));
  if (!complete && !mayAsk) throw new Error("The interviewer did not provide a useful new question. Your draft is kept; retry this turn or finish with what you have.");
  return {
    ...next, covered, deflections, followed: mayAsk && follow && proposed ? [...session.followed, proposed.field] : session.followed,
    phase: complete || !mayAsk ? "review" : "interview",
    question: complete || !mayAsk ? null : hostedQuestion(proposed, `${session.id}-q-${session.turn}`),
    note: answer.note, pending: null, retryKind: null, error: null,
  };
}

/** Missing fields remain visible rather than being represented as completed facts. */
export const missingFields = (session: TableReadSession): TableReadField[] => TABLE_READ_FIELDS.filter((field) => !characterField(session.body, field).trim());
