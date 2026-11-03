/** Representative public interview transitions prove ceilings, chip identity, manual ownership and adaptive follow-ups. */
import { expect, test } from "bun:test";
import { acceptAnswer, applyDeck, applyModelAnswer, editInterview, newInterview } from "./interview";
import { characterField } from "./fields";
import { modelAnswerSchema, mutationSchema, sessionSchema, TABLE_READ_LIMITS, type TableReadModelAnswer, type TableReadSession } from "./schema";

const fresh = (tempo: "cold-read" | "deep-dive" | "rapid-fire" = "cold-read") => newInterview({ tempo, connection: { id: "local", model: "writer" }, idea: "Vesper runs a bar and trades in debts." }, "session", "card");
const response = (patch: Partial<TableReadModelAnswer> = {}): TableReadModelAnswer => ({ patches: [], covered: [], question: { field: "personality", text: "What would make her forgive a debt?", chips: ["Mercy she resents", "Nothing"] }, note: "", followUp: null, deflection: false, ...patch });
const ask = (session: TableReadSession) => applyModelAnswer(session, response());

test("a living character uses canonical fields and retains manual empty values across every model response", () => {
  let session = applyModelAnswer(fresh(), response({ patches: [{ field: "name", value: "Vesper" }] }));
  session = editInterview(session, "name", "");
  session = applyModelAnswer(session, response({ patches: [{ field: "name", value: "A model replacement" }], question: null }), true);
  expect(characterField(session.body, "name")).toBe("");
  expect(session.manual).toContain("name");
  expect(sessionSchema.safeParse(session).success).toBe(true);
});

test("Cold Read has a hard question ceiling and rejects stale or forged choice identities", () => {
  const session = ask(fresh());
  expect(() => acceptAnswer(session, "old-question", { kind: "chip", chipId: "anything" }, 0)).toThrow("changed");
  expect(() => acceptAnswer(session, session.question!.id, { kind: "chip", chipId: "forged" }, 0)).toThrow("Choose");
  const accepted = acceptAnswer(session, session.question!.id, { kind: "chip", chipId: session.question!.chips[0]!.id }, 0);
  expect(accepted.transcript[0]!.answer).toBe("Mercy she resents");
  expect(applyModelAnswer({ ...accepted, turn: 8 }, response()).phase).toBe("review");
});

test("Deep Dive allows one actual-field follow-up, not a mismatched or repeated one", () => {
  const session = acceptAnswer(ask(fresh("deep-dive")), "session-q-0", { kind: "freeform", text: "She never forgives." }, 0);
  const followed = applyModelAnswer(session, response({ covered: ["personality"], followUp: "personality" }));
  expect(followed.question?.field).toBe("personality");
  expect(followed.followed).toEqual(["personality"]);
  const answered = acceptAnswer(followed, followed.question!.id, { kind: "freeform", text: "Except her brother, which she hides." }, 0);
  expect(() => applyModelAnswer(answered, response({ followUp: "personality" }))).toThrow("useful new question");
  expect(() => applyModelAnswer(session, response({ covered: ["personality"], followUp: "scenario" }))).toThrow("useful new question");
  expect(session.followed).toEqual([]);
});

test("two decoded deflections retire that target and allow the next question", () => {
  let session = acceptAnswer(ask(fresh("deep-dive")), "session-q-0", { kind: "freeform", text: "What would you choose?" }, 0);
  session = applyModelAnswer(session, response({ deflection: true }));
  expect(session.deflections).toEqual({ field: "personality", count: 1 });
  session = acceptAnswer(session, session.question!.id, { kind: "freeform", text: "I still don't know." }, 0);
  session = applyModelAnswer(session, response({ deflection: true, question: { field: "scenario", text: "Who walks through the bar door first?", chips: ["A creditor", "A friend"] } }));
  expect(session.covered).toContain("personality");
  expect(session.question?.field).toBe("scenario");
});

test("Rapid Fire starts after deck preparation and enforces its deadline and chip-only rule without truncating choices", () => {
  const base = editInterview(fresh("rapid-fire"), "name", "Vesper");
  const questions = Array.from({ length: 5 }, (_, index) => ({ field: "personality" as const, text: `Choose motive ${index}`, chips: ["Keep a promise", "Break a promise"] }));
  let session = applyDeck(base, { patches: [], questions }, 10_000);
  expect(session.deadline).toBe(100_000);
  expect(() => acceptAnswer(session, session.question!.id, { kind: "freeform", text: "anything" }, 10_001)).toThrow("displayed choices");
  expect(() => acceptAnswer(session, session.question!.id, { kind: "chip", chipId: session.question!.chips[0]!.id }, 100_000)).toThrow("ended");
  session.body.persona.personality = "x".repeat(TABLE_READ_LIMITS.field);
  session = acceptAnswer(session, session.question!.id, { kind: "chip", chipId: session.question!.chips[0]!.id }, 10_001);
  expect(characterField(session.body, "personality")).toHaveLength(TABLE_READ_LIMITS.field);
  expect(session.transcript[0]!.answer).toBe("Keep a promise");
  expect(characterField(session.body, "name")).toBe("Vesper");
});

test("trust boundaries reject unknown keys, arbitrary field paths, duplicate proposals and excessive answers", () => {
  expect(modelAnswerSchema.safeParse({ ...response(), execute: "code" }).success).toBe(false);
  expect(modelAnswerSchema.safeParse(response({ patches: [{ field: "name", value: "A" }, { field: "name", value: "B" }] })).success).toBe(false);
  expect(mutationSchema.safeParse({ action: "edit", revision: 0, field: "__proto__", value: "bad" }).success).toBe(false);
  expect(mutationSchema.safeParse({ action: "answer", revision: 0, questionId: "q", answer: { kind: "freeform", text: "x".repeat(TABLE_READ_LIMITS.answer + 1) } }).success).toBe(false);
});
