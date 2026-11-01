/** Per-store, bounded host-action relay plus ephemeral host-drawn extension UI projections. */
import { decodeInteractiveDescriptor } from "../contracts/interactive";
import { extensionHostActionAnswerSchema, extensionUiNoticeSchema, extensionUiPanelSchema, extensionUiStatusSchema, pendingExtensionHostActionSchema, sceneTurnRegexAnswerSchema,
  type ExtensionHostActionAnswer, type ExtensionHostActionSnapshot, type ExtensionRunPrincipal, type ExtensionUiNotice, type ExtensionUiPanel, type ExtensionUiStatus, type PendingExtensionHostAction } from "../contracts/host-actions";
import { createBoundedHostActionQueue } from "./confirmation";

type NewTicket<T> = T extends unknown ? Omit<T, "id" | "expiresAt"> : never;
export type NewExtensionHostAction = NewTicket<PendingExtensionHostAction>;
export interface HostActionPort {
  request(action: NewExtensionHostAction, signal: AbortSignal): Promise<ExtensionHostActionAnswer | undefined>;
  actions(): readonly PendingExtensionHostAction[];
  get(id: string): PendingExtensionHostAction | null;
  claim(id: string): PendingExtensionHostAction | null;
  answer(id: string, answer: ExtensionHostActionAnswer): boolean;
  setPanel(panel: ExtensionUiPanel): boolean;
  removePanel(packageId: string, contributionId: string, principal: ExtensionRunPrincipal): boolean;
  setStatus(status: ExtensionUiStatus): boolean;
  showNotice(packageId: string, principal: ExtensionRunPrincipal, text: string): void;
  snapshot(): ExtensionHostActionSnapshot;
  invalidatePackage(packageId: string): void;
  close(): void;
}

const validAnswer = (ticket: PendingExtensionHostAction, answer: ExtensionHostActionAnswer): boolean => {
  if (answer.status === "cancelled") return true;
  if (answer.status === "ambiguous") return ["clipboard.write", "links.open", "ui.scene.open", "ui.editor.open", "composer.draft.set", "playback.play", "playback.pause", "playback.stop"].includes(ticket.action);
  if (ticket.action === "clipboard.read") return answer.status === "read";
  if (ticket.action === "playback.status") return answer.status === "playback-state";
  if (ticket.action === "regex.preview") return answer.status === "regex-result";
  if (ticket.action === "scene-turn.regex") return sceneTurnRegexAnswerSchema.safeParse(answer).success;
  if (ticket.action === "composer.draft.set") return answer.status === "composer-draft-result";
  if (ticket.action === "ui.dialog.request") return answer.status === "accepted" || answer.status === "declined";
  return answer.status === "completed";
};
const sameGrant = (left: ExtensionRunPrincipal, right: ExtensionRunPrincipal): boolean =>
  left.storeId === right.storeId && left.packageId === right.packageId && left.packageDigest === right.packageDigest && left.grantRevision === right.grantRevision;
const effectful = (ticket: PendingExtensionHostAction): boolean => ["clipboard.write", "links.open", "ui.scene.open", "ui.editor.open", "composer.draft.set", "playback.play", "playback.pause", "playback.stop"].includes(ticket.action);

export function createHostActionPort(options: { now(): number; id(): string; ttlMs?: number; maxPending?: number }): HostActionPort {
  const queue = createBoundedHostActionQueue<PendingExtensionHostAction, ExtensionHostActionAnswer>({ ...options,
    protectedExpiryValue: (ticket) => effectful(ticket) ? { status: "ambiguous" } : { status: "cancelled" },
    protectedAbortValue: (ticket) => effectful(ticket) ? { status: "ambiguous" } : { status: "cancelled" },
  });
  const panels = new Map<string, ExtensionUiPanel>();
  const statuses = new Map<string, ExtensionUiStatus>();
  const notices: ExtensionUiNotice[] = [];
  const panelKey = (packageId: string, contributionId: string): string => `${packageId}\0${contributionId}`;
  return {
    async request(action, signal) {
      const ticket = pendingExtensionHostActionSchema.parse({ ...action, id: options.id(), expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
      const answer = await queue.enqueue(ticket, signal);
      if (!answer && signal.aborted) throw new DOMException("The host action was cancelled.", "AbortError");
      return answer;
    },
    actions: () => queue.list(),
    get: (id) => queue.get(id),
    claim(id) {
      const ticket = queue.claim(id);
      if (ticket && effectful(ticket) && !queue.protect(id)) {
        queue.answer(id, { status: "ambiguous" });
        return null;
      }
      return ticket;
    },
    answer(id, answerInput) {
      const answer = extensionHostActionAnswerSchema.parse(answerInput);
      const ticket = queue.get(id);
      if (ticket && effectful(ticket) && ticket.expiresAt <= options.now()) {
        queue.answer(id, { status: "ambiguous" });
        return false;
      }
      return !!ticket && validAnswer(ticket, answer) && queue.answer(id, answer);
    },
    setPanel(input) {
      const panel = extensionUiPanelSchema.parse({ ...input, descriptor: decodeInteractiveDescriptor(input.descriptor) });
      const key = panelKey(panel.packageId, panel.contributionId), current = panels.get(key);
      if (current && sameGrant(current.principal, panel.principal) && current.principal.runEpoch > panel.principal.runEpoch) return false;
      panels.set(key, panel);
      while (panels.size > 64) panels.delete(panels.keys().next().value!);
      return true;
    },
    removePanel(packageId, contributionId, principal) {
      const key = panelKey(packageId, contributionId), current = panels.get(key);
      if (!current || !sameGrant(current.principal, principal) || current.principal.runEpoch > principal.runEpoch) return false;
      return panels.delete(key);
    },
    setStatus(input) {
      const status = extensionUiStatusSchema.parse(input);
      const current = statuses.get(status.packageId);
      if (current && sameGrant(current.principal, status.principal) && current.principal.runEpoch > status.principal.runEpoch) return false;
      if (status.text === null) statuses.delete(status.packageId); else statuses.set(status.packageId, status);
      while (statuses.size > 128) statuses.delete(statuses.keys().next().value!);
      return true;
    },
    showNotice(packageId, principal, text) {
      const notice = extensionUiNoticeSchema.parse({ id: options.id(), packageId, principal, text, createdAt: options.now() });
      notices.push(notice);
      if (notices.length > 20) notices.splice(0, notices.length - 20);
    },
    snapshot() { return { actions: [...queue.list()], panels: [...panels.values()], statuses: [...statuses.values()], notices: [...notices] }; },
    invalidatePackage(packageId) {
      for (const [key, panel] of panels) if (panel.packageId === packageId) panels.delete(key);
      statuses.delete(packageId);
      for (let i = notices.length - 1; i >= 0; i--) if (notices[i]!.packageId === packageId) notices.splice(i, 1);
      for (const ticket of queue.all()) if (ticket.packageId === packageId) queue.answer(ticket.id, effectful(ticket) && queue.protectedIds().includes(ticket.id) ? { status: "ambiguous" } : { status: "cancelled" });
    },
    close() { panels.clear(); statuses.clear(); notices.length = 0; queue.close(); },
  };
}
