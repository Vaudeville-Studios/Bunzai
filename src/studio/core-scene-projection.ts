/** Exact Core-path projection and restart repair; never match messages by text alone. */
import type { AsyncSessionHandle } from "rp-core";
import type { ChatStore, Message } from "../stage/contracts/chat-store";
import type { CoreMessageProjection, CoreSceneRecords } from "../stage/contracts/core-record-store";
import { greetingsOf } from "./scenes";
import { StudioConflictError } from "./errors";

type CoreMessage = Awaited<ReturnType<AsyncSessionHandle["view"]>>["path"][number];
const coreText = (message: CoreMessage): string => message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
type CoreSibling = Awaited<ReturnType<AsyncSessionHandle["messageSiblings"]>>[number];
const siblingText = (message: CoreSibling): string => message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");
function generation(message: CoreMessage): CoreMessageProjection["generation"] {
  return { ...(message.gen?.model ? { model: message.gen.model } : {}), ...(message.gen?.finish ? { finishReason: message.gen.finish } : {}) };
}

async function allMessages(chats: ChatStore, takeId: string, expectedVersion: number): Promise<Message[]> {
  const messages: Message[] = [];
  let fromSeq = 1;
  while (true) {
    const page = await chats.readMessages(takeId, { fromSeq, limit: 200 });
    if (page.branchVersion !== expectedVersion) throw new StudioConflictError("the take changed while checking its Core projection");
    messages.push(...page.messages);
    if (page.nextSeq === null) return messages;
    fromSeq = page.nextSeq;
  }
}

export async function reconcileCoreProjection(chats: ChatStore, records: CoreSceneRecords, sceneId: string, sessionId: string, session: AsyncSessionHandle, repairDeferredGreeting = false): Promise<number> {
  const chat = await chats.getChat(sceneId);
  if (!chat) throw new StudioConflictError("the scene is gone");
  const branch = (await chats.listBranches(sceneId)).find((item) => item.id === chat.activeBranchId);
  if (!branch) throw new StudioConflictError("the active take is gone");
  const path = (await session.view()).path;
  let ui = await allMessages(chats, branch.id, branch.version);
  if (ui.length > path.length) throw new StudioConflictError("the scene is ahead of its RP-Core journal");
  if (!repairDeferredGreeting && ui.length === 0 && path.length === 1 && path[0]?.gen?.kind === "greeting") return branch.version;
  if (ui.length === 0 && path[0]?.gen?.kind === "greeting" && (chat.opening?.edits.length ?? 0) > 0) {
    throw new StudioConflictError("an edited greeting needs an explicit Core greeting identity before projection repair");
  }

  const proof = await records.hostProjection(sessionId, branch.version);
  const acknowledgements = new Map<string, number>();
  let currentVersion = branch.version;
  const first = path[0];
  const firstUi = ui[0];
  if (first?.gen?.kind === "greeting" && firstUi) {
    const siblings = await session.messageSiblings(first.id);
    const snapshot = await chats.castSnapshot(sceneId);
    const templates = snapshot ? greetingsOf(snapshot.character) : [];
    const rendered = siblings.map(siblingText);
    const exactLegacy = !chat.opening?.edits.length && firstUi.role === "assistant" && firstUi.current === first.swipe.index
      && firstUi.swipes.length === templates.length && templates.length === rendered.length
      && firstUi.swipes.every((swipe, index) => swipe.content === templates[index] || swipe.content === rendered[index])
      && (await Promise.all(siblings.map((sibling) => records.messageIdentityFor(sessionId, sibling.id, branch.id)))).every((identity) => identity === null);
    if (exactLegacy) {
      for (const [index, sibling] of siblings.entries()) {
        const swipe = firstUi.swipes[index]!;
        const rendered = siblingText(sibling);
        if (swipe.content !== rendered) {
          await chats.editSwipe(firstUi.id, swipe.id, rendered, { expectedVersion: currentVersion });
          currentVersion++;
        }
      }
      ui = await allMessages(chats, branch.id, currentVersion);
    }
  }
  if (!chats.projectCoreMessages && path.length > ui.length) throw new StudioConflictError("atomic Core projection is unavailable");
  for (let index = 0; index < path.length; index++) {
    const core = path[index]!;
    let message = ui[index];
    if (!message) {
      const first = (await session.messageSiblings(core.id))[0];
      if (!first) throw new StudioConflictError("the RP-Core message has no authoritative sibling history");
      const inputs: CoreMessageProjection[] = [{ operationId: proof.operationId, sessionId, takeId: branch.id,
        coreMessageId: first.id, throughSeq: proof.lastSeq, role: first.role, content: siblingText(first), ...(generation(first) ? { generation: generation(first) } : {}), expectedVersion: currentVersion, mode: "append" }];
      await chats.projectCoreMessages!(inputs);
      currentVersion++;
      ui = await allMessages(chats, branch.id, currentVersion);
      message = ui[index];
    }
    if (!message || message.role !== core.role || Boolean(core.hidden) !== (message.hidden === true)) throw new StudioConflictError("the RP-Core journal and scene differ; export this scene before continuing");
    const siblings = await session.messageSiblings(core.id);
    if (!siblings.length || siblings.some((sibling, siblingIndex) => sibling.swipe.index !== siblingIndex || sibling.swipe.count !== siblings.length || sibling.role !== core.role)) {
      throw new StudioConflictError("RP-Core returned an inconsistent sibling history");
    }
    if (message.swipes.length > siblings.length) {
      throw new StudioConflictError("the RP-Core journal and scene differ; export this scene before continuing");
    }
    for (const [siblingIndex, sibling] of siblings.entries()) {
      if (siblingIndex >= message.swipes.length) continue;
      if (message.swipes[siblingIndex]?.content === siblingText(sibling)) continue;
      let repaired = false;
      for (const pending of await records.pendingProjection(sessionId)) {
        if (pending.origin !== "extension" || pending.operation !== "messages.edit.apply" || pending.projectedSeq >= pending.lastSeq) continue;
        let exactUserEdit = false;
        for await (const entry of records.projectionEntries(pending.operationId)) {
          if (entry.t === "edit" && entry.target === sibling.id && entry.reason === "user") exactUserEdit = true;
        }
        if (!exactUserEdit) continue;
        const identity = await records.messageIdentityFor(sessionId, sibling.id, branch.id);
        if (!identity || identity.messageId !== message.id || identity.swipeId !== message.swipes[siblingIndex]?.id || !chats.projectCoreMessages) continue;
        await chats.projectCoreMessages([{ operationId: pending.operationId, sessionId, takeId: branch.id, coreMessageId: sibling.id,
          targetCoreMessageId: sibling.id, throughSeq: pending.lastSeq, role: sibling.role, content: siblingText(sibling), expectedVersion: currentVersion, mode: "edit" }]);
        currentVersion++;
        acknowledgements.set(pending.operationId, pending.lastSeq);
        ui = await allMessages(chats, branch.id, currentVersion);
        message = ui[index]!;
        repaired = true;
        break;
      }
      if (!repaired) throw new StudioConflictError("the RP-Core journal and scene differ; export this scene before continuing");
    }
    for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex++) {
      const sibling = siblings[siblingIndex]!;
      let identity = await records.messageIdentityFor(sessionId, sibling.id, branch.id);
      if (identity && (identity.messageId !== message.id || identity.swipeId !== message.swipes[siblingIndex]?.id)) throw new StudioConflictError("the Core journal maps to a different UI message or swipe");
      if (!identity && siblingIndex < message.swipes.length) {
        await records.linkMessage({ operationId: proof.operationId, sessionId, takeId: branch.id, coreMessageId: sibling.id,
          chatMessageId: message.id, chatSwipeId: message.swipes[siblingIndex]!.id, throughSeq: proof.lastSeq }, currentVersion);
        identity = await records.messageIdentityFor(sessionId, sibling.id, branch.id);
      } else if (!identity && siblingIndex >= message.swipes.length) {
        if (siblingIndex === 0) throw new StudioConflictError("the UI projection is missing its first Core sibling");
        const previous = siblings[siblingIndex - 1]!;
        await chats.projectCoreMessages!([{ operationId: proof.operationId, sessionId, takeId: branch.id,
          coreMessageId: sibling.id, targetCoreMessageId: previous.id, throughSeq: proof.lastSeq, role: sibling.role,
          content: siblingText(sibling), ...(generation(sibling) ? { generation: generation(sibling) } : {}), expectedVersion: currentVersion, mode: "swipe" }]);
        currentVersion++;
        ui = await allMessages(chats, branch.id, currentVersion);
        message = ui[index]!;
      }
    }
    ui = await allMessages(chats, branch.id, currentVersion);
    message = ui[index]!;
    for (const [siblingIndex, sibling] of siblings.entries()) {
      const swipe = message.swipes[siblingIndex]!;
      const identity = await records.messageIdentityFor(sessionId, sibling.id, branch.id);
      if (identity && (identity.messageId !== message.id || identity.swipeId !== swipe.id)) throw new StudioConflictError("the Core journal maps to a different UI message or swipe");
      if (!identity) throw new StudioConflictError("the Core projection is missing a sibling identity");
    }
    if (message.current !== core.swipe.index) {
      if (!await chats.selectSwipe(message.id, core.swipe.index, { expectedVersion: currentVersion })) throw new StudioConflictError("the active RP-Core sibling could not be selected in the scene");
      currentVersion++;
      ui = await allMessages(chats, branch.id, currentVersion);
    }
  }
  if (ui.length !== path.length) throw new StudioConflictError("the Core projection did not reach the journal path");
  for (let index = 0; index < path.length; index++) {
    const core = path[index]!, message = ui[index]!, swipe = message.swipes[message.current];
    if (!swipe || core.role !== message.role || coreText(core) !== swipe.content || core.swipe.index !== message.current
      || core.swipe.count !== message.swipes.length || Boolean(core.hidden) !== (message.hidden === true)) {
      throw new StudioConflictError("the RP-Core journal and scene differ; export this scene before continuing");
    }
    for (const sibling of await session.messageSiblings(core.id)) {
      const identity = await records.messageIdentityFor(sessionId, sibling.id, branch.id);
      const projectedSwipe = message.swipes[sibling.swipe.index];
      if (!identity || identity.messageId !== message.id || identity.swipeId !== projectedSwipe?.id) throw new StudioConflictError("the Core projection is missing a final sibling identity");
    }
  }
  const finalChat = await chats.getChat(sceneId);
  const finalBranch = finalChat && (await chats.listBranches(sceneId)).find((item) => item.id === finalChat.activeBranchId);
  if (!finalBranch || finalChat.activeBranchId !== branch.id) throw new StudioConflictError("the active take changed during Core projection repair");
  const finalMessages = await allMessages(chats, branch.id, finalBranch.version);
  if (finalMessages.length !== path.length || finalMessages.some((message, index) => {
    const core = path[index]!, swipe = message.swipes[message.current];
    return !swipe || core.role !== message.role || coreText(core) !== swipe.content || core.swipe.index !== message.current
      || core.swipe.count !== message.swipes.length || Boolean(core.hidden) !== (message.hidden === true);
  })) throw new StudioConflictError("the Core projection changed during final identity validation");
  for (const [index, core] of path.entries()) {
    const identity = await records.messageIdentityFor(sessionId, core.id, branch.id);
    const message = finalMessages[index]!, swipe = message.swipes[message.current];
    if (!identity || identity.messageId !== message.id || identity.swipeId !== swipe?.id) throw new StudioConflictError("the Core projection is missing a final message identity");
  }
  await chats.applyCoreExtensionState?.(sessionId);
  for (const [operationId, throughSeq] of acknowledgements) await records.markProjected(operationId, throughSeq);
  await records.markProjected(proof.operationId, proof.lastSeq);
  return finalBranch.version;
}
