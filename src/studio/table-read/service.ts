/** Revisioned encrypted Table Read lifecycle, bounded in-flight ownership and recoverable exact-ID character creation. */
import type { StateStore } from "../../stage/contracts/state-store";
import type { StudioStoreLike } from "../contracts";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import { canonicalJsonString } from "../../core/sha256";
import { acceptAnswer, editInterview, newInterview } from "../../core/table-read/interview";
import { documentSchema, sessionSchema, TABLE_READ_LIMITS, type TableReadMutation, type TableReadSession, type TableReadView } from "../../core/table-read/schema";
import { StudioConflictError, StudioReadError, StudioValidationError } from "../errors";
import { generateInterview, type TableReadConnect } from "./generate";
import { toErrorMessage } from "../../error-message";
import { utf8ByteLength } from "../../shared/utf8";

export interface TableReadDeps {
  state: StateStore;
  studio: Pick<StudioStoreLike, "compareAndCreate" | "read">;
  connect: TableReadConnect;
  now(): number;
  id(): string;
  isCurrent?(): boolean;
}

/** One explicit runtime per opened StateStore, shared by trusted and approved-device route handlers. */
export class TableReadService {
  private readonly owner: string;
  private readonly active = new Map<string, AbortController>();
  private readonly commits = new Set<string>();
  private readonly tasks = new Set<Promise<unknown>>();
  private closed = false;

  constructor(private readonly deps: TableReadDeps) { this.owner = deps.id(); }

  private current(): void {
    if (this.closed || this.deps.isCurrent?.() === false) throw new StudioConflictError("This library changed. Reopen the Table Read before continuing.");
  }

  /** Read-only: a reload never clears a pending operation or starts another model call. */
  async read(): Promise<TableReadView> {
    this.current();
    if (!this.deps.state.readVersioned) throw new StudioValidationError("Table Read needs a revisioned local library.");
    const stored = await this.deps.state.readVersioned("tableRead");
    let session: TableReadSession | null = null;
    if (stored.text !== null) {
      if (utf8ByteLength(stored.text) > TABLE_READ_LIMITS.document) throw new StudioReadError("This Table Read is too large to open safely. Its saved data has been kept.");
      try { session = documentSchema.parse(JSON.parse(stored.text)).session; }
      catch { throw new StudioReadError("This saved Table Read could not be read. Its data has been kept; restore a library backup to recover it."); }
    }
    return { revision: stored.revision, session, running: !!session && (session.pending !== null && this.active.has(session.pending.token) || session.commit !== null && this.commits.has(session.commit.token)) };
  }

  private async write(session: TableReadSession | null, revision: number): Promise<TableReadView> {
    this.current();
    if (!this.deps.state.writeIfRevision) throw new StudioValidationError("Table Read needs a revisioned local library.");
    const document = documentSchema.parse({ version: 1, session });
    const text = JSON.stringify(document);
    if (utf8ByteLength(text) > TABLE_READ_LIMITS.document) throw new StudioValidationError("This interview has reached its saved-text limit. Shorten a long answer or field before continuing.");
    if (await this.deps.state.writeIfRevision("tableRead", text, revision) !== "saved") throw new StudioConflictError("This Table Read changed in another window. Your unsubmitted text is kept; reload its latest draft.");
    return this.read();
  }

  /** Every accepted action is tracked through shutdown; no model result owns a write after its token changes. */
  async change(input: TableReadMutation, signal?: AbortSignal): Promise<TableReadView> {
    const task = this.apply(input, signal);
    this.tasks.add(task);
    try { return await task; } finally { this.tasks.delete(task); }
  }

  private async apply(input: TableReadMutation, signal?: AbortSignal): Promise<TableReadView> {
    const view = await this.read();
    if (input.revision !== view.revision) throw new StudioConflictError("This Table Read changed in another window. Reload its latest draft before continuing.");
    const session = view.session;
    if (input.action === "start") {
      if (session) throw new StudioConflictError("Keep or discard the saved interview before starting another.");
      return this.generate(newInterview(input.settings, this.deps.id(), `table-read-${this.deps.id()}`), view.revision, "start", signal);
    }
    if (!session) throw new StudioConflictError("There is no saved interview to continue.");
    if (input.action === "save") return this.save(session, view.revision);
    if (session.phase === "committing") throw new StudioConflictError("Your character is being saved. Retry saving before editing or discarding this interview.");
    if (input.action === "discard") {
      const next = await this.write(null, view.revision);
      this.abort(session.pending?.token);
      return next;
    }
    if (session.phase === "saved") throw new StudioConflictError("This character is saved. Open it in the Workbench to edit it.");
    if (input.action === "edit") {
      const next = await this.write({ ...editInterview(session, input.field, input.value), ...(session.pending ? { error: "Your edit is kept. Continue the interview when you are ready." } : {}) }, view.revision);
      this.abort(session.pending?.token);
      return next;
    }
    if (input.action === "stop") {
      if (!session.pending) return view;
      const next = await this.write({ ...session, pending: null, error: "Stopped. Your answers and draft are kept; retry when you are ready." }, view.revision);
      this.abort(session.pending.token);
      return next;
    }
    if (input.action === "review") {
      const next = await this.write({ ...session, phase: "review", question: null, pending: null, retryKind: null, error: null, note: "Review the card as it stands. Some accepted answers may not yet have been drafted into its fields; you can edit them before saving." }, view.revision);
      this.abort(session.pending?.token);
      return next;
    }
    if (input.action === "retry") {
      const pending = session.pending;
      if (pending && (this.active.has(pending.token) || pending.owner !== this.owner && pending.expires > this.deps.now())) throw new StudioConflictError("That interview request may still be running. Stop it or wait for its deadline before retrying.");
      const kind = pending?.kind ?? session.retryKind;
      if (!kind) throw new StudioValidationError("There is no unfinished interview request to retry.");
      return this.generate(session, view.revision, kind, signal);
    }
    if (session.pending) throw new StudioConflictError("The interviewer is still working. Stop it before answering or finishing.");
    if (input.action === "finish") return this.generate(session, view.revision, "finish", signal);
    if (input.action !== "answer") throw new StudioValidationError("This interview action is not available.");
    let accepted: TableReadSession;
    try { accepted = acceptAnswer(session, input.questionId, input.answer, this.deps.now()); }
    catch (error) { throw new StudioValidationError(toErrorMessage(error, "This answer could not be accepted.")); }
    if (accepted.settings.tempo !== "rapid-fire") return this.generate(accepted, view.revision, "answer", signal);
    return this.write(accepted, view.revision);
  }

  private abort(token: string | undefined): void { if (token) this.active.get(token)?.abort(new Error("Interview stopped")); }

  private async generate(session: TableReadSession, revision: number, kind: "start" | "answer" | "finish", requestSignal?: AbortSignal): Promise<TableReadView> {
    const token = this.deps.id();
    const controller = new AbortController();
    const stop = () => controller.abort(requestSignal?.reason);
    requestSignal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("Interview deadline reached")), TABLE_READ_LIMITS.operationMs);
    this.active.set(token, controller);
    let pendingRevision: number | null = null;
    try {
      this.current();
      requestSignal?.throwIfAborted();
      const pending = { ...session, error: null, retryKind: kind, pending: { token, owner: this.owner, kind, expires: this.deps.now() + TABLE_READ_LIMITS.operationMs } };
      const stored = await this.write(pending, revision);
      pendingRevision = stored.revision;
      const next = await generateInterview(pending, kind, this.deps.connect, controller.signal, this.deps.now);
      controller.signal.throwIfAborted();
      const latest = await this.read();
      if (latest.revision !== pendingRevision || latest.session?.pending?.token !== token) return latest;
      return await this.write(next, pendingRevision);
    } catch (error) {
      if (pendingRevision === null) throw error;
      const latest = await this.read();
      if (latest.revision !== pendingRevision || latest.session?.pending?.token !== token) return latest;
      const message = error instanceof StudioValidationError ? error.message : controller.signal.aborted
        ? "The interview stopped or its connection closed. Your answers are kept; retry when ready."
        : "The interviewer could not finish this turn. Your answers are kept. Check the connection and retry.";
      return this.write({ ...latest.session, pending: null, error: message }, pendingRevision);
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", stop);
      this.active.delete(token);
    }
  }

  private async save(session: TableReadSession, revision: number): Promise<TableReadView> {
    if (session.phase === "saved") return this.read();
    if (session.phase !== "review" && session.phase !== "committing") throw new StudioValidationError("Finish and review the card before saving it.");
    if (!session.body.identity.name.trim()) throw new StudioValidationError("Give your character a name before saving.");
    if (!this.deps.studio.compareAndCreate) throw new StudioValidationError("This library cannot create a character safely. Use the local Studio.");
    const prior = session.commit;
    if (prior && (this.commits.has(prior.token) || prior.owner !== this.owner && prior.expires > this.deps.now())) throw new StudioConflictError("That save may still be running. Wait for it to finish before retrying.");
    const token = this.deps.id();
    this.commits.add(token);
    try {
      const frozen = sessionSchema.parse({ ...session, phase: "committing", question: null, pending: null, retryKind: null, commit: { token, owner: this.owner, expires: this.deps.now() + TABLE_READ_LIMITS.operationMs } });
      const stored = await this.write(frozen, revision);
      this.current();
      const result = await this.deps.studio.compareAndCreate({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: frozen.cardId, body: frozen.body });
      if (result.status === "exists") {
        const existing = await this.deps.studio.read("character", frozen.cardId);
        if (!existing || existing.kind !== "character" || canonicalJsonString(existing.body) !== canonicalJsonString(frozen.body)) {
          const message = "A different or removed character already uses this interview's identity. Nothing was overwritten. Your reviewed draft is kept; copy any fields you need before discarding this interview and starting another.";
          await this.write({ ...frozen, phase: "review", commit: null, error: message }, stored.revision);
          throw new StudioConflictError(message);
        }
      }
      return await this.write({ ...frozen, phase: "saved", commit: null, saved: { id: frozen.cardId, kind: "character", name: frozen.body.identity.name } }, stored.revision);
    } finally { this.commits.delete(token); }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort(new Error("Studio closing"));
    await Promise.allSettled([...this.tasks]);
  }
}
