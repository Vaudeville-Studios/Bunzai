/** One per-library owner for RP-Core turns and their ChatStore projection. */
import { Engine, type AsyncSessionHandle, type Event, type HostHooks, type TurnOutcome } from "rp-core";
import type { ChatConnection, ChatStore, Message } from "../stage/contracts/chat-store";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import type { CoreStateLifecycle, CoreStateTurnBinding } from "../stage/contracts/core-extension-state";
import { checkCoreProjection, openCoreScene, previewCoreScene } from "./core-scene";
import { reconcileCoreProjection } from "./core-scene-projection";
import type { ProviderRole } from "../stage/contracts/provider";
import { StudioConflictError } from "./errors";

export type CoreTurnActor = { kind: "host" } | { kind: "extension"; packageId: string };
export interface CoreTurnStart {
  sceneId: string; sessionId: string; kind: "reply" | "swipe" | "continue"; expectedBranchVersion: number;
  actor: CoreTurnActor; signal?: AbortSignal; hostHooks?: HostHooks | ((resolvedFingerprint: string) => HostHooks);
  expectedJournalSeq?: number;
  commit?: ExtensionCommitContext; guidance?: string; inspect?: boolean;
}
export interface CoreTurnFrame { event: Event; projected: Message | null }
export interface CoreTurnResult { turnId: string; outcome: TurnOutcome; projected: Message | null }
export interface CoreTurnSnapshot { sessionId: string; takeId: string; journalSeq: number; branchVersion: number; connection: ChatConnection | undefined }
export interface CoreTurnOwner extends CoreStateLifecycle {
  inspect(sceneId: string): Promise<CoreTurnSnapshot | null>;
  appendUserMessage(input: { sceneId: string; takeId: string; content: string; expectedVersion: number; commit: ExtensionCommitContext }): Promise<Message | null>;
  editMessage(input: { sceneId: string; takeId: string; seq: number; content: string; expectedVersion: number; commit: ExtensionCommitContext }): Promise<Message | null>;
  preview(sceneId: string, draft: string, signal: AbortSignal, apply: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasHooks: (sceneId: string) => Promise<boolean>): Promise<{ sceneId: string; label: "RP-Core prompt preview; local only; canonical shaping and budget applied."; messages: readonly { role: ProviderRole; content: string }[] } | null>;
  run(input: CoreTurnStart, onEvent: (frame: CoreTurnFrame) => void | Promise<void>): Promise<CoreTurnResult>;
  stop(sceneId: string, actor?: CoreTurnActor, turnId?: string): Promise<boolean>;
  answerReview(sceneId: string, actor: CoreTurnActor, turnId: string, answer: { action: "send" | "cancel"; edits?: { index: number; text: string }[] }): Promise<boolean>;
  answerGate(sceneId: string, actor: CoreTurnActor, turnId: string, gateId: string, answer: { action: "send" | "cancel"; edits?: { index: number; text: string }[] }): Promise<boolean>;
  status(sceneId: string, packageId: string): { turnId: string; kind: CoreTurnStart["kind"] } | null;
  close(): Promise<void>;
}
interface ActiveTurn { actor: CoreTurnActor; kind: CoreTurnStart["kind"]; controller: AbortController; session?: AsyncSessionHandle; turnId?: string; stateBinding?: CoreStateTurnBinding; gateId?: string; done: Promise<unknown> }

export function createCoreTurnOwner(chats: ChatStore, records: CoreSceneRecords, home: string): CoreTurnOwner {
  const active = new Map<string, ActiveTurn>();
  const tasks = new Set<Promise<unknown>>();
  let closed = false;

  async function project(sceneId: string, sessionId: string, session: AsyncSessionHandle, kind: CoreTurnStart["kind"], answer: Extract<TurnOutcome, { type: "done" }>["message"], targetCoreMessageId: string | undefined, expectedVersion: number, commit?: ExtensionCommitContext): Promise<Message> {
    const chat = await chats.getChat(sceneId);
    if (!chat) throw new StudioConflictError("the scene is gone");
    const branch = (await chats.listBranches(sceneId)).find((take) => take.id === chat.activeBranchId);
    if (branch?.version !== expectedVersion) throw new StudioConflictError("the scene changed during the rp-core turn; export it before continuing");
    if (kind !== "reply" && !targetCoreMessageId) throw new StudioConflictError("RP-Core swipe and continue projection require a stable message-and-swipe mapping");
    const content = answer.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
    const generation = { ...(answer.gen?.model ? { model: answer.gen.model } : {}), ...(answer.gen?.finish ? { finishReason: answer.gen.finish } : {}) };
    const operationId = commit?.invocationId ?? `host:${sessionId}`;
    const proof = commit
      ? (await records.pendingProjection(sessionId)).find((row) => row.operationId === operationId)
      : await records.hostProjection(sessionId, expectedVersion);
    if (!proof || !proof.linked || proof.sceneId !== sceneId || proof.takeId !== chat.activeBranchId) throw new StudioConflictError("the committed rp-core operation has no matching projection proof");
    const messageId = await chats.projectCoreMessage?.({ operationId, sessionId, takeId: chat.activeBranchId, coreMessageId: answer.id,
      throughSeq: proof.lastSeq, role: answer.role, content, generation, expectedVersion,
      ...(kind === "swipe" ? { mode: "swipe" as const, targetCoreMessageId } : kind === "continue" ? { mode: "continue" as const, targetCoreMessageId } : { mode: "append" as const }) });
    if (!messageId) throw new StudioConflictError("atomic rp-core message projection is unavailable");
    await reconcileCoreProjection(chats, records, sceneId, sessionId, session);
    const tail = (await chats.readMessagesBefore(chat.activeBranchId, { limit: 1, liveOnly: true })).messages[0];
    if (!tail || tail.id !== messageId) throw new StudioConflictError("the projected rp-core message is no longer the scene tail");
    await records.markProjected(operationId, proof.lastSeq);
    return tail;
  }

  return {
    async preview(sceneId, draft, signal, apply, hasHooks) {
      if (closed) throw new StudioConflictError("the Core turn owner is closed");
      const result = await previewCoreScene(chats, records, home, sceneId, draft, signal, apply, hasHooks);
      return result ? { ...result, label: "RP-Core prompt preview; local only; canonical shaping and budget applied." } : null;
    },
    async inspect(sceneId) {
      const linked = await records.sceneFor(sceneId);
      if (!linked) return null;
      const chat = await chats.getChat(sceneId);
      const branch = (await chats.listBranches(sceneId)).find((take) => take.id === linked.branchId);
      if (!chat || !branch || chat.activeBranchId !== linked.branchId) return null;
      return { sessionId: linked.sessionId, takeId: linked.branchId, journalSeq: await records.journalRevision(linked.sessionId), branchVersion: branch.version, connection: chat.connection };
    },
    async appendUserMessage(input) {
      if (closed || active.has(input.sceneId)) throw new StudioConflictError("The Core scene is busy or closing.");
      const task = (async () => {
        const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
        if (!linked || linked.branchId !== input.takeId || chat?.activeBranchId !== input.takeId) throw new StudioConflictError("The Core scene or active take changed.");
        const branch = (await chats.listBranches(input.sceneId)).find((item) => item.id === input.takeId);
        if (branch?.version !== input.expectedVersion) throw new StudioConflictError("The scene changed; review the message again.");
        const journalSeq = await records.journalRevision(linked.sessionId);
        const scoped = records.forExtension(input.commit, { operationId: input.commit.invocationId ?? "", sceneId: input.sceneId, takeId: input.takeId, sessionId: linked.sessionId, expectedJournalSeq: journalSeq });
        const engine = await Engine.openWithRecordStore({ home, recordStore: scoped, lane: "manual" });
        try {
          const session = await engine.session(linked.sessionId);
          if (await checkCoreProjection(chats, records, input.sceneId, session) !== input.expectedVersion) throw new StudioConflictError("The Core transcript was repaired; review the message again.");
          const sent = await session.send({ text: input.content, expectedVersion: await session.version() });
          const tail = (await session.view()).path.at(-1);
          if (!tail || tail.id !== sent.messageId || tail.role !== "user" || tail.blocks.filter((block) => block.k === "text").map((block) => block.text).join("") !== input.content) {
            throw new StudioConflictError(`RP-Core user append did not become the current path tail (sent ${sent.messageId}, tail ${tail?.id ?? "missing"}/${tail?.role ?? "missing"}).`);
          }
          const version = await reconcileCoreProjection(chats, records, input.sceneId, linked.sessionId, session, true);
          const uiMessageId = await records.messageFor(linked.sessionId, sent.messageId, input.takeId);
          const messages = await chats.readMessagesBefore(input.takeId, { limit: 1, liveOnly: true });
          if (messages.branchVersion !== version || !uiMessageId || messages.messages[0]?.id !== uiMessageId) {
            throw new StudioConflictError("The appended Core message is no longer the scene tail.");
          }
          return messages.messages[0] ?? null;
        } finally { await engine.close(); }
      })();
      tasks.add(task);
      try { return await task; } finally { tasks.delete(task); }
    },
    async editMessage(input) {
      if (closed || active.has(input.sceneId)) throw new StudioConflictError("The Core scene is busy or closing.");
      const task = (async () => {
        const linked = await records.sceneFor(input.sceneId), chat = await chats.getChat(input.sceneId);
        if (!linked || linked.branchId !== input.takeId || chat?.activeBranchId !== input.takeId) throw new StudioConflictError("The Core scene or active take changed.");
        const branch = (await chats.listBranches(input.sceneId)).find((item) => item.id === input.takeId);
        if (branch?.version !== input.expectedVersion) throw new StudioConflictError("The scene changed; review the edit again.");
        const page = await chats.readMessages(input.takeId, { fromSeq: input.seq, limit: 1 });
        const target = page.messages.find((item) => item.seq === input.seq), swipe = target?.swipes[target.current];
        if (!target || !swipe) return null;
        const snapshot = await records.journalRevision(linked.sessionId);
        const scoped = records.forExtension(input.commit, { operationId: input.commit.invocationId ?? "", sceneId: input.sceneId, takeId: input.takeId, sessionId: linked.sessionId, expectedJournalSeq: snapshot });
        const engine = await Engine.openWithRecordStore({ home, recordStore: scoped, lane: "manual" });
        try {
          const session = await engine.session(linked.sessionId);
          if (await checkCoreProjection(chats, records, input.sceneId, session) !== input.expectedVersion) throw new StudioConflictError("The Core transcript was repaired; review the edit again.");
          const corePath = (await session.view()).path;
          let coreMessageId: string | null = null;
          for (const candidate of corePath) {
            if (candidate.role !== target.role) continue;
            const identity = await records.messageIdentityFor(linked.sessionId, candidate.id, input.takeId);
            if (identity?.messageId === target.id && identity.swipeId === swipe.id) { coreMessageId = candidate.id; break; }
          }
          if (!coreMessageId) throw new StudioConflictError("The selected message version has no exact Core identity.");
          await session.edit({ messageId: coreMessageId, text: input.content, expectedVersion: await session.version() });
          const proof = (await records.pendingProjection(linked.sessionId)).find((row) => row.operationId === input.commit.invocationId);
          const after = (await session.messageSiblings(coreMessageId)).find((item) => item.id === coreMessageId);
          if (!proof || !after || !chats.projectCoreMessages) throw new StudioConflictError("The Core message edit has no recoverable projection proof.");
          const text = after.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
          await chats.projectCoreMessages([{ operationId: proof.operationId, sessionId: linked.sessionId, takeId: input.takeId, coreMessageId,
            targetCoreMessageId: coreMessageId, throughSeq: proof.lastSeq, role: after.role, content: text, expectedVersion: input.expectedVersion, mode: "edit" }]);
          await reconcileCoreProjection(chats, records, input.sceneId, linked.sessionId, session);
          await records.markProjected(proof.operationId, proof.lastSeq);
          return (await chats.readMessages(input.takeId, { fromSeq: input.seq, limit: 1 })).messages.find((item) => item.id === target.id) ?? null;
        } finally { await engine.close(); }
      })();
      tasks.add(task);
      try { return await task; } finally { tasks.delete(task); }
    },
    async run(input, onEvent) {
      if (closed) throw new StudioConflictError("the Core turn owner is closed");
      if (active.has(input.sceneId)) throw new StudioConflictError("a turn already owns this scene");
      const controller = new AbortController();
      const abort = () => controller.abort(input.signal?.reason);
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
      let settled!: () => void;
      const completion = new Promise<void>((resolve) => { settled = resolve; });
      tasks.add(completion);
      const activeTurn: ActiveTurn = { actor: input.actor, kind: input.kind, controller, done: completion };
      active.set(input.sceneId, activeTurn);
      let opened: Awaited<ReturnType<typeof openCoreScene>> | null = null;
      try {
        controller.signal.throwIfAborted();
        const linked = await records.sceneFor(input.sceneId);
        const chat = await chats.getChat(input.sceneId);
        if (!linked || linked.sessionId !== input.sessionId || linked.branchId !== chat?.activeBranchId) throw new StudioConflictError("the rp-core scene or active take changed");
        if (!chat?.connection) throw new StudioConflictError("choose a model before starting a Core turn");
        const branch = (await chats.listBranches(input.sceneId)).find((item) => item.id === linked.branchId);
        if (branch?.version !== input.expectedBranchVersion) throw new StudioConflictError("the scene changed; review the turn again");
        if (input.actor.kind === "extension" && (!input.commit?.invocationId || input.expectedJournalSeq === undefined)) {
          throw new StudioConflictError("An extension Core turn requires an invocation-scoped journal and projection commit.");
        }
        const invocationRecords = input.actor.kind === "extension"
          ? records.forExtension({ ...input.commit!, signal: controller.signal }, {
            operationId: input.commit!.invocationId!, sceneId: input.sceneId, takeId: linked.branchId,
            sessionId: input.sessionId, expectedJournalSeq: input.expectedJournalSeq,
          })
          : records;
        // The selected narrator binding is derived from the scene connection already shown in
        // the turn review. This changes only that role binding; extension-owned run policy below
        // narrows tools/jobs without rewriting saved config.
        opened = await openCoreScene(records, home, input.sessionId, chat.connection, { recordStore: invocationRecords, configure: true });
        const hostHooks = typeof input.hostHooks === "function" ? input.hostHooks(opened.connectionFingerprint) : input.hostHooks;
        const repairedVersion = await checkCoreProjection(chats, records, input.sceneId, opened.session, input.actor.kind === "extension");
        if (repairedVersion !== input.expectedBranchVersion) throw new StudioConflictError("The RP-Core transcript was repaired from its committed journal. Reload the scene and review the turn again.");
        controller.signal.throwIfAborted();
        const before = await opened.session.view();
        const targetCoreMessageId = input.kind === "swipe"
          ? [...before.path].reverse().find((message) => message.role === "assistant")?.id
          : input.kind === "continue" ? before.path.at(-1)?.id : undefined;
        const run = await opened.session.runTurn({ kind: input.kind, expectedVersion: await opened.session.version(),
          ...(input.guidance === undefined ? {} : { guidance: input.guidance }), ...(input.inspect ? { inspect: true } : {}),
          ...(hostHooks ? { hostHooks } : {}),
          ...(input.actor.kind === "extension" ? { hostPolicy: "extension-owned" as const } : {}),
        });
        activeTurn.session = opened.session;
        activeTurn.turnId = run.turnId;
        if (input.actor.kind === "extension" && input.commit?.invocationId && (input.kind === "reply" || input.kind === "swipe")) {
          activeTurn.stateBinding = { sceneId: input.sceneId, takeId: linked.branchId, sessionId: input.sessionId, turnId: run.turnId,
            turnOperationId: input.commit.invocationId, kind: input.kind, expectedVersion: input.expectedBranchVersion };
        }
        const stop = () => { void opened?.session.stop(run.turnId).catch(() => undefined); };
        controller.signal.addEventListener("abort", stop, { once: true });
        if (controller.signal.aborted) stop();
        const work = (async () => {
          let projected: Message | null = null;
          try {
            for await (const event of run.events) {
              if (event.type === "gate" && event.kind === "review") activeTurn.gateId = event.gateId;
              if (event.type === "done") { await run.result; projected = await project(input.sceneId, input.sessionId, opened!.session, input.kind, event.message, targetCoreMessageId, input.expectedBranchVersion, input.commit); }
              else if (event.type === "stopped" && event.message) { await run.result; projected = await project(input.sceneId, input.sessionId, opened!.session, input.kind, event.message, targetCoreMessageId, input.expectedBranchVersion, input.commit); }
              await onEvent({ event, projected });
            }
            return { turnId: run.turnId, outcome: await run.result, projected };
          } finally {
            controller.signal.removeEventListener("abort", stop);
            input.signal?.removeEventListener("abort", abort);
            if (input.actor.kind === "extension" && input.commit?.invocationId && run.turnId) await chats.discardCorePendingState?.(input.commit.invocationId, run.turnId);
            if (active.get(input.sceneId) === activeTurn) active.delete(input.sceneId);
            await opened?.engine.close();
          }
        })();
        return await work;
      } catch (error) {
        input.signal?.removeEventListener("abort", abort);
        if (active.get(input.sceneId) === activeTurn) active.delete(input.sceneId);
        await opened?.engine.close();
        throw error;
      } finally {
        settled();
        tasks.delete(completion);
      }
    },
    async stop(sceneId, actor, turnId) {
      const turn = active.get(sceneId);
      if (!turn || (actor && !sameActor(turn.actor, actor)) || (turnId && turn.turnId !== turnId)) return false;
      if (turn.session && turn.turnId) await turn.session.stop(turn.turnId);
      else turn.controller.abort();
      return true;
    },
    async answerReview(sceneId, actor, turnId, answer) {
      const turn = active.get(sceneId);
      if (!turn?.session || turn.turnId !== turnId || !turn.gateId || !sameActor(turn.actor, actor)) return false;
      const accepted = await turn.session.answerGate(turnId, turn.gateId, answer);
      if (accepted) turn.gateId = undefined;
      return accepted;
    },
    async answerGate(sceneId, actor, turnId, gateId, answer) {
      const turn = active.get(sceneId);
      if (!turn || !turn.session || turn.turnId !== turnId || turn.gateId !== gateId || !sameActor(turn.actor, actor)) return false;
      const accepted = await turn.session.answerGate(turnId, gateId, answer);
      if (accepted) turn.gateId = undefined;
      return accepted;
    },
    status(sceneId, packageId) {
      const turn = active.get(sceneId);
      return turn?.actor.kind === "extension" && turn.actor.packageId === packageId && turn.turnId
        ? { turnId: turn.turnId, kind: turn.kind }
        : null;
    },
    ownedTurn(packageId, sceneId, turnId) {
      const turn = active.get(sceneId);
      return turn?.actor.kind === "extension" && turn.actor.packageId === packageId && turn.turnId === turnId ? turn.stateBinding ?? null : null;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const turn of active.values()) {
        turn.controller.abort();
        if (turn.session && turn.turnId) await turn.session.stop(turn.turnId).catch(() => undefined);
      }
      await Promise.allSettled([...tasks]);
    },
  };
}

function sameActor(left: CoreTurnActor, right: CoreTurnActor): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "host" || (right.kind === "extension" && left.packageId === right.packageId);
}
