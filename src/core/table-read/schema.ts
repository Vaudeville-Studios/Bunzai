/** Bounded value-only Table Read requests, model answers and durable session snapshots. */
import { z } from "zod";
import { characterBodySchema } from "../../entities/character/runtime-schema";
import { TABLE_READ_FIELDS } from "./fields";

export const TABLE_READ_LIMITS = { field: 20_000, answer: 8_000, idea: 8_000, question: 1_000, chip: 240, turns: 24, transcript: 48, output: 96_000, document: 512_000, request: 192_000, operationMs: 120_000, rapidMs: 90_000 } as const;
export const TEMPOS = ["cold-read", "deep-dive", "rapid-fire"] as const;
export const fieldSchema = z.enum(TABLE_READ_FIELDS);
const shortId = z.string().min(1).max(100);
const fieldText = z.string().max(TABLE_READ_LIMITS.field);
const nonempty = (max: number) => z.string().trim().min(1).max(max);
export const settingsSchema = z.strictObject({ tempo: z.enum(TEMPOS), connection: z.strictObject({ id: shortId, model: nonempty(240) }), idea: nonempty(TABLE_READ_LIMITS.idea) });
export const patchSchema = z.strictObject({ field: fieldSchema, value: fieldText });
export const questionSchema = z.strictObject({
  id: shortId, field: fieldSchema, text: nonempty(TABLE_READ_LIMITS.question),
  chips: z.array(z.strictObject({ id: shortId, label: nonempty(TABLE_READ_LIMITS.chip), value: nonempty(TABLE_READ_LIMITS.answer) })).max(6),
}).superRefine((question, ctx) => {
  if (new Set(question.chips.map((chip) => chip.id)).size !== question.chips.length) ctx.addIssue({ code: "custom", message: "Question choices must have distinct identities" });
});
// Model question identities are assigned by the host, never trusted from generated output.
const generatedQuestionSchema = z.strictObject({ field: fieldSchema, text: nonempty(TABLE_READ_LIMITS.question), chips: z.array(nonempty(TABLE_READ_LIMITS.chip)).min(2).max(6) });
export const modelAnswerSchema = z.strictObject({
  patches: z.array(patchSchema).max(TABLE_READ_FIELDS.length), covered: z.array(fieldSchema).max(TABLE_READ_FIELDS.length),
  question: generatedQuestionSchema.nullable(), note: z.string().max(1_000),
  followUp: fieldSchema.nullable(), deflection: z.boolean(),
}).superRefine((answer, ctx) => {
  if (new Set(answer.patches.map((patch) => patch.field)).size !== answer.patches.length) ctx.addIssue({ code: "custom", message: "A field may be proposed only once" });
});
export const deckAnswerSchema = z.strictObject({ patches: z.array(patchSchema).max(TABLE_READ_FIELDS.length), questions: z.array(generatedQuestionSchema).min(5).max(18) });
export const answerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("chip"), chipId: shortId }),
  z.strictObject({ kind: z.literal("freeform"), text: nonempty(TABLE_READ_LIMITS.answer) }),
]);
const transcriptSchema = z.strictObject({ question: z.string().max(TABLE_READ_LIMITS.question), answer: z.string().max(TABLE_READ_LIMITS.answer), field: fieldSchema });
export const sessionSchema = z.strictObject({
  id: shortId, cardId: shortId, settings: settingsSchema, body: characterBodySchema,
  manual: z.array(fieldSchema).max(TABLE_READ_FIELDS.length), covered: z.array(fieldSchema).max(TABLE_READ_FIELDS.length),
  followed: z.array(fieldSchema).max(TABLE_READ_FIELDS.length), transcript: z.array(transcriptSchema).max(TABLE_READ_LIMITS.transcript),
  deflections: z.strictObject({ field: fieldSchema, count: z.number().int().min(1).max(2) }).nullable(),
  question: questionSchema.nullable(), deck: z.array(questionSchema).max(18),
  phase: z.enum(["interview", "review", "committing", "saved"]), turn: z.number().int().min(0).max(TABLE_READ_LIMITS.turns),
  deadline: z.number().finite().nullable(), note: z.string().max(1_000), error: z.string().max(1_000).nullable(),
  pending: z.strictObject({ token: shortId, owner: shortId, kind: z.enum(["start", "answer", "finish"]), expires: z.number().finite() }).nullable(),
  retryKind: z.enum(["start", "answer", "finish"]).nullable(),
  commit: z.strictObject({ token: shortId, owner: shortId, expires: z.number().finite() }).nullable(),
  saved: z.strictObject({ id: shortId, name: z.string().max(TABLE_READ_LIMITS.field), kind: z.literal("character") }).nullable(),
}).superRefine((session, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (session.turn !== session.transcript.length) invalid("Interview turns must match accepted answers");
  for (const values of [session.manual, session.covered, session.followed]) if (new Set(values).size !== values.length) invalid("Field ownership and coverage must have distinct identities");
  if (session.pending && session.retryKind !== session.pending.kind) invalid("Pending requests must preserve their retry action");
  if (session.phase === "committing" ? !session.commit || session.pending || session.saved : session.commit) invalid("Only a frozen committing interview may hold a save lease");
  if (session.phase === "saved" ? !session.saved || session.pending : session.saved) invalid("A saved character requires its completed receipt");
  if (session.saved && (session.saved.id !== session.cardId || session.saved.name !== session.body.identity.name)) invalid("The saved receipt must identify this exact character");
  if (new Set(session.deck.map((question) => question.id)).size !== session.deck.length) invalid("Rapid Fire questions must have distinct identities");
});
export const documentSchema = z.strictObject({ version: z.literal(1), session: sessionSchema.nullable() });
export const mutationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), revision: z.number().int().min(-1), settings: settingsSchema }),
  z.strictObject({ action: z.literal("answer"), revision: z.number().int().min(0), questionId: shortId, answer: answerSchema }),
  z.strictObject({ action: z.literal("edit"), revision: z.number().int().min(0), field: fieldSchema, value: fieldText }),
  ...(["finish", "review", "retry", "stop", "discard", "save"] as const).map((action) => z.strictObject({ action: z.literal(action), revision: z.number().int().min(0) })),
]);
export type TableReadSettings = z.infer<typeof settingsSchema>;
export type TableReadQuestion = z.infer<typeof questionSchema>;
export type TableReadSession = z.infer<typeof sessionSchema>;
export type TableReadDocument = z.infer<typeof documentSchema>;
export type TableReadMutation = z.infer<typeof mutationSchema>;
export type TableReadAnswer = z.infer<typeof answerSchema>;
export type TableReadModelAnswer = z.infer<typeof modelAnswerSchema>;
export type TableReadDeckAnswer = z.infer<typeof deckAnswerSchema>;
export interface TableReadView { revision: number; session: TableReadSession | null; running: boolean }
