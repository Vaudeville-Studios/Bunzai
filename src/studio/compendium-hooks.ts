/**
 * When a reply is filed, and what takes its filings back (04b D6 and D7). RoleCall files each reply as it lands and rolls back on a
 * swipe; here the default waits for the person's next message, so the reply they are most likely to regenerate has nothing to undo.
 * The rule is RoleCall's write delay (`lib/ai/tv-stream/postgen-write-delay.ts:62-96`): the history ends with the person's new
 * message and does not hold the reply being generated, and with a wait of N the target is the Nth newest assistant reply in it. A
 * wait of 0 files each new reply as it lands; every N-th of the person's turns files (`W:7340`, `tv_postgen_write_frequency`). A
 * regenerate or a cut files nothing and instead takes back the filings of the reply it replaces. Everything runs in the scene's lane
 * after the stream has closed and never throws: a pass that cannot land is a receipt in Activity, not an error in the reply.
 */
import { resolveCompendium } from "../core/compendium";
import type { CompendiumReceipt, Message } from "../stage/contracts/chat-store";
import type { CompendiumDeps } from "./compendium-deps";
import { fileReply } from "./compendium-filing";
import { runHistorian } from "./compendium-historian";
import { enqueue } from "./compendium-queue";
import { undoAll, undoableReceipts } from "./compendium-undo";
import type { TurnEvent } from "./scene-turn";
import type { TurnKind } from "./scene-turn-load";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import type { ProviderRequestGuard } from "../rp-core";
import { EXTENSION_BACKGROUND_FIELDS } from "../extensions/contracts/background-fields";
import { guardedProviderConnect } from "./guarded-provider-connect";
import { snapshotExtensionCommit } from "../stage/store/extension-commit-access";

const TAIL = 80;
const COVERED_CHARS = 4_000;

const textOf = (m: Message): string => m.swipes[m.current]?.content ?? "";

/** The user messages the reply at `index` answers: the `everyN` before it, oldest first (RoleCall `bookkeeping-window.ts:20-35`). */
const coveredBefore = (messages: readonly Message[], index: number, everyN: number): string[] =>
  messages.slice(0, index).filter((m) => m.role === "user").slice(-everyN).map((m) => textOf(m).slice(0, COVERED_CHARS));

/** Files the reply at `index` of a take's tail. */
async function fileAt(deps: CompendiumDeps, chatId: string, branchId: string, messages: readonly Message[], index: number, everyN: number): Promise<void> {
  const reply = messages[index]!;
  const swipe = reply.swipes[reply.current];
  if (!swipe || !textOf(reply).trim()) return;
  await fileReply(deps, { chatId, branchId, messageId: reply.id, swipeId: swipe.id, reply: textOf(reply), covered: coveredBefore(messages, index, everyN) });
}

/** The person has sent a message and a reply is starting: file the reply `wait` assistant replies back. */
async function fileOlder(deps: CompendiumDeps, chatId: string): Promise<void> {
  const chat = await deps.chats.getChat(chatId);
  const { on, filing } = resolveCompendium(chat?.compendium);
  if (!chat || !on || filing.wait < 1) return;
  const page = await deps.chats.readMessagesBefore(chat.activeBranchId, { limit: TAIL, liveOnly: true });
  const replies = page.messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  const index = replies[replies.length - filing.wait];
  if (index === undefined) return;
  if (filing.on && page.userCount % filing.everyN === 0) await fileAt(deps, chatId, chat.activeBranchId, page.messages, index, filing.everyN);
  // The Historian stops at the same boundary as the writer: the replies held back are not summarized.
  await runHistorian(deps, chatId, chat.activeBranchId, page.messages[index]!.id).catch(() => undefined);
}

/** A reply or a new version has landed. A new version first takes back what the version it replaces filed; a new reply is filed now only when the wait is 0. */
async function afterDone(deps: CompendiumDeps, chatId: string, kind: TurnKind, landed: Message): Promise<void> {
  const chat = await deps.chats.getChat(chatId);
  const { on, filing } = resolveCompendium(chat?.compendium);
  if (!chat || kind === "continue") return;
  const swipeId = landed.swipes[landed.current]?.id;
  if (kind === "swipe") {
    await undoAll(deps, chatId, await undoableReceipts(deps, chatId, chat.activeBranchId, (r) => r.messageId === landed.id && r.swipeId !== swipeId));
  }
  if (!on || filing.wait !== 0) return;
  const page = await deps.chats.readMessagesBefore(chat.activeBranchId, { limit: TAIL, liveOnly: true });
  const index = page.messages.findIndex((m) => m.id === landed.id);
  if (index < 0) return;
  if (filing.on && page.userCount % filing.everyN === 0) await fileAt(deps, chatId, chat.activeBranchId, page.messages, index, filing.everyN);
  await runHistorian(deps, chatId, chat.activeBranchId, landed.id).catch(() => undefined);
}

const later = (chatId: string, work: () => Promise<void>): Promise<void> => enqueue(chatId, work).catch(() => undefined);

/**
 * The turn route's one call per event. It only schedules: the stream is never held, and a failure cannot reach the reply.
 * Nothing is logged: the content of a book and a reply never goes to a log (F12).
 */
export function onTurnEvent(deps: CompendiumDeps, chatId: string, kind: TurnKind, event: TurnEvent, extensionCommit?: ExtensionCommitContext, providerGuard?: ProviderRequestGuard): Promise<void> {
  const scoped = extensionCommit ? { ...deps, extensionCommit: snapshotExtensionCommit(extensionCommit) } : deps;
  if (extensionCommit && !canRunExtensionCompendium(extensionCommit, chatId)) return Promise.resolve();
  const checked = providerGuard ? { ...scoped, connect: guardedProviderConnect(scoped.connect, providerGuard) } : scoped;
  if (event.type === "start" && kind === "reply") return later(chatId, () => fileOlder(checked, chatId));
  if (event.type === "done") return later(chatId, () => afterDone(checked, chatId, kind, event.message));
  return Promise.resolve();
}

function canRunExtensionCompendium(context: ExtensionCommitContext, chatId: string): boolean {
  const access = context.access;
  return !!access?.resources.some((resource) => resource.kind === "scene" && resource.id === chatId)
    && access.fields.includes(EXTENSION_BACKGROUND_FIELDS.compendiumReceipts)
    && access.fields.includes(EXTENSION_BACKGROUND_FIELDS.compendiumEntries)
    && access.resources.some((resource) => resource.kind === "lorebook");
}

/**
 * The filings a cut is about to take with it: those of the one message, or of it and every live message after it. Read before the cut,
 * because the cut hides the messages; `undoWithCut` takes them back after the cut has landed.
 */
export async function filingsUnderCut(deps: CompendiumDeps, chatId: string, branchId: string, messageId: string, scope: "one" | "from"): Promise<CompendiumReceipt[]> {
  const all = await undoableReceipts(deps, chatId, branchId, (r) => r.messageId !== undefined);
  if (all.length === 0 || scope === "one") return all.filter((r) => r.messageId === messageId);
  const cut = new Set<string>();
  for (let before: number | undefined; ; ) {
    const page = await deps.chats.readMessagesBefore(branchId, { limit: 200, liveOnly: true, ...(before === undefined ? {} : { beforeSeq: before }) });
    const at = page.messages.findIndex((m) => m.id === messageId);
    page.messages.slice(at < 0 ? 0 : at).forEach((m) => cut.add(m.id));
    if (at >= 0 || page.messages.length === 0) break;
    before = page.messages[0]!.seq;
  }
  return all.filter((r) => cut.has(r.messageId!));
}

/** The filings of one version of a reply, which cutting that version takes with it. */
export const filingsOfVersion = (deps: CompendiumDeps, chatId: string, branchId: string, messageId: string, swipeId: string): Promise<CompendiumReceipt[]> =>
  undoableReceipts(deps, chatId, branchId, (r) => r.messageId === messageId && r.swipeId === swipeId);

/** Runs a cut, and when it landed takes back the filings found before it. A cut that fails changes nothing; filings that cannot be taken back never fail the cut. */
export async function undoWithCut<T>(deps: CompendiumDeps | null, chatId: string, find: () => Promise<CompendiumReceipt[]>, cut: () => Promise<T | null>): Promise<T | null> {
  const filings = deps ? await find().catch(() => []) : [];
  const done = await cut();
  if (done && deps && filings.length > 0) await enqueue(chatId, () => undoAll(deps, chatId, filings)).catch(() => undefined);
  return done;
}
