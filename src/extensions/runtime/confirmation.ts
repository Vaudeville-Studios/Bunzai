/** Bounded host-owned approval tickets for extension effects. */
import { z } from "zod";
import { isRecord } from "../../core/guards";
import { decodeJsonValue, type JsonValue } from "../contracts/value";
import { operationIdSchema } from "../contracts/operation-id";
import { EXTENSION_HTTP_METHODS } from "../contracts/destination";
import { fileActionAnswerSchema, pendingExtensionFileActionSchema, type PendingExtensionFileAction, type FileActionAnswer } from "../contracts/file-actions";

const resourceSchema = z.object({ kind: z.string().min(1).max(80), id: z.string().min(1).max(200) }).strict();
export const pendingExtensionEffectSchema = z.object({
  id: z.string().min(1).max(200), packageId: z.string().min(1).max(200), packageName: z.string().min(1).max(120),
  operation: operationIdSchema, effect: z.string().min(1).max(80), resources: z.array(resourceSchema).max(64),
  fields: z.array(z.string().max(120)).max(128), methods: z.array(z.enum(EXTENSION_HTTP_METHODS)).max(EXTENSION_HTTP_METHODS.length), destinations: z.array(z.string().max(200)).max(64),
  review: z.custom<JsonValue>((value) => { try { decodeJsonValue(value); return true; } catch { return false; } }), expiresAt: z.number().int().nonnegative(),
}).strict();
export type PendingExtensionEffect = z.infer<typeof pendingExtensionEffectSchema>;

interface ExpiringTicket { id: string; expiresAt: number }
/** Shared bounded ticket transport. It carries typed host actions but makes no permission decisions. */
export function createBoundedHostActionQueue<T extends ExpiringTicket, R>(options: { now(): number; maxPending?: number; onSettled?(id: string): void; onProtectedExpiry?(ticket: T): void | Promise<void>; protectedExpiryValue?(ticket: T): R; protectedAbortValue?(ticket: T): R }) {
  const tickets = new Map<string, { ticket: T; resolve(value: R | undefined): void; signal: AbortSignal; abort(): void; timer: ReturnType<typeof setTimeout>; claimed: boolean; protected: boolean; expiring: boolean }>();
  const limit = Math.min(8, Math.max(0, options.maxPending ?? 8));
  const settle = (id: string, value: R | undefined, acceptExpired = false): boolean => {
    const pending = tickets.get(id);
    if (!pending) return false;
    tickets.delete(id); clearTimeout(pending.timer); pending.signal.removeEventListener("abort", pending.abort); options.onSettled?.(id);
    pending.resolve(value && (acceptExpired || pending.ticket.expiresAt > options.now()) ? value : undefined);
    return true;
  };
  const expire = (id: string): void => {
    const pending = tickets.get(id);
    if (!pending) return;
    if (!pending.protected) { settle(id, undefined, true); return; }
    if (pending.expiring) return;
    pending.expiring = true;
    void Promise.resolve(options.onProtectedExpiry?.(pending.ticket)).catch(() => undefined).finally(() => {
      if (tickets.get(id) === pending) settle(id, options.protectedExpiryValue?.(pending.ticket), true);
    });
  };
  const prune = (): void => { for (const [id, item] of tickets) if (item.ticket.expiresAt <= options.now()) expire(id); };
  return {
    enqueue(ticket: T, signal: AbortSignal): Promise<R | undefined> {
      prune();
      if (tickets.has(ticket.id)) return Promise.resolve(undefined);
      if (signal.aborted || ticket.expiresAt <= options.now() || ticket.expiresAt > options.now() + 120_000 || tickets.size >= limit) { options.onSettled?.(ticket.id); return Promise.resolve(undefined); }
      return new Promise<R | undefined>((resolve) => {
        const abort = () => {
          const item = tickets.get(ticket.id);
          if (item?.protected) {
            const value = options.protectedAbortValue?.(item.ticket);
            if (value !== undefined) settle(ticket.id, value, true);
          } else settle(ticket.id, undefined, true);
        };
        const timer = setTimeout(() => expire(ticket.id), Math.max(1, ticket.expiresAt - options.now()));
        timer.unref?.();
        tickets.set(ticket.id, { ticket, resolve, signal, abort, timer, claimed: false, protected: false, expiring: false });
        signal.addEventListener("abort", abort, { once: true });
      });
    },
    list(): readonly T[] { prune(); return [...tickets.values()].filter(({ claimed, ticket, protected: protectedTicket }) => !claimed && (protectedTicket || ticket.expiresAt > options.now())).map(({ ticket }) => ticket); },
    all(): readonly T[] { prune(); return [...tickets.values()].map(({ ticket }) => ticket); },
    get(id: string): T | null { prune(); return tickets.get(id)?.ticket ?? null; },
    claim(id: string): T | null {
      prune();
      const pending = tickets.get(id);
      if (!pending || pending.claimed) return null;
      pending.claimed = true;
      return pending.ticket;
    },
    protect(id: string): boolean { const pending = tickets.get(id); if (!pending || pending.protected || pending.ticket.expiresAt <= options.now()) return false; pending.protected = true; return true; },
    protectedIds(): readonly string[] { prune(); return [...tickets.values()].filter((item) => item.protected).map((item) => item.ticket.id); },
    answer(id: string, result: R): boolean { const pending = tickets.get(id); return settle(id, result, !!pending?.protected && pending.ticket.expiresAt <= options.now()); },
    close(): void { for (const [id, item] of tickets) item.protected ? expire(id) : settle(id, undefined, true); },
  };
}

export function createExtensionConfirmations(options: { now(): number; id(): string; maxPending?: number; ttlMs?: number }) {
  const queue = createBoundedHostActionQueue<PendingExtensionEffect, boolean>(options);
  return {
    request(packageId: string, packageName: string, effectInput: JsonValue, signal: AbortSignal): Promise<boolean> {
      const effect = decodeJsonValue(effectInput);
      if (!isRecord(effect)) return Promise.resolve(false);
      const row = effect as Record<string, JsonValue>;
      const ticket = pendingExtensionEffectSchema.parse({ id: options.id(), packageId, packageName, operation: row.operation,
        effect: row.effect, resources: row.resources, fields: row.fields, methods: row.methods, destinations: row.destinations, review: row.review,
        expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
      return queue.enqueue(ticket, signal).then((approved) => approved === true);
    },
    list(): readonly PendingExtensionEffect[] { return queue.list(); },
    answer(id: string, approved: boolean): boolean { return queue.answer(id, approved); },
    close(): void { queue.close(); },
  };
}

export function createExtensionFileActionQueue(options: { now(): number; id(): string; maxPending?: number; ttlMs?: number }) {
  const queue = createBoundedHostActionQueue<PendingExtensionFileAction, FileActionAnswer>(options);
  return {
    request(ticketInput: Omit<PendingExtensionFileAction, "id" | "expiresAt">, signal: AbortSignal): Promise<FileActionAnswer | undefined> {
      if (signal.aborted) return Promise.resolve(undefined);
      const ticket = pendingExtensionFileActionSchema.parse({ ...ticketInput, id: options.id(), expiresAt: options.now() + Math.min(120_000, Math.max(1, options.ttlMs ?? 120_000)) });
      return queue.enqueue(ticket, signal);
    },
    list(): readonly PendingExtensionFileAction[] { return queue.list(); },
    answer(id: string, answer: FileActionAnswer): boolean {
      const parsed = fileActionAnswerSchema.parse(answer);
      return queue.answer(id, parsed);
    },
    close(): void { queue.close(); },
  };
}
