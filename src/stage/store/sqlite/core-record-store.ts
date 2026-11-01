/** rp-core's ordered journal inside the unlocked, encrypted Bunzai library. */
import type { Entry, Lease, RecordStore, SessionHeader } from "rp-core";
import type { CellCipher } from "../../crypto/cell-cipher";
import type { StageDatabase } from "./database";
import type { CoreSceneRecords } from "../../contracts/core-record-store";
import { coreInvocation, coreRecordAuthority, requireHostCoreBirth, type CoreInvocation } from "./core-record-authority";
import { coreRecordProjection } from "./core-record-projection";
import { corePendingState } from "./core-pending-state";
export type { CoreSceneRecords } from "../../contracts/core-record-store";

const HEADER = "core_sessions.header_cell";
const TITLE = "core_sessions.title_cell";
const ENTRY = "core_entries.entry_cell";
const LEASE_MS = 30_000;

interface SessionRow { header_cell: string; title_cell: string | null; updated_at: string; lease_owner: string | null; lease_until: number | null }
interface EntryRow { seq: number; entry_cell: string }

/** A lease is checked again inside each write transaction, including renewal and release. */
export function sqliteCoreRecordStore(database: StageDatabase, cipher: CellCipher, now: () => number = Date.now): CoreSceneRecords {
  return scopedCoreRecords(database, cipher, now);
}
function scopedCoreRecords(database: StageDatabase, cipher: CellCipher, now: () => number, scope?: CoreInvocation, hostBirth?: { sceneId: string; takeId: string }): CoreSceneRecords {
  if (scope && hostBirth) throw new Error("Core record scope cannot combine extension and host birth authority");
  const { statement, transaction } = database;
  const readSession = (id: string): SessionRow | null =>
    statement("SELECT header_cell, title_cell, updated_at, lease_owner, lease_until FROM core_sessions WHERE id = ?").get(id) as SessionRow | null;
  const write = <T>(fn: () => T): Promise<T> => database.patiently(() => transaction(() => { cipher.ready(); return fn(); }));
  const own = (id: string, token: string): SessionRow => {
    const row = readSession(id);
    if (!row || row.lease_owner !== token || row.lease_until === null || row.lease_until <= now()) throw new Error("rp-core session lease lost");
    return row;
  };
  const lastSeq = (id: string): number =>
    (statement("SELECT COALESCE(MAX(seq), 0) AS seq FROM core_entries WHERE session_id = ?").get(id) as { seq: number }).seq;
  const authority = coreRecordAuthority(database, cipher);
  const projection = coreRecordProjection(database, cipher, () => { if (scope || hostBirth) throw new Error("Scoped Core writers cannot invoke privileged projection recovery"); });
  const checkRead = (id: string) => {
    if (scope && id !== (scope.target.sessionId ?? authority.operation(scope.target.operationId)?.session_id)) throw new Error("Core read is outside its invocation session");
  };

  return {
    ...projection,
    async journalRevision(sessionId) { checkRead(sessionId); cipher.ready(); await database.idle(); return lastSeq(sessionId); },
    forExtension(commit, target) {
      if (scope || hostBirth) throw new Error("A scoped Core store cannot change its invocation authority");
      return scopedCoreRecords(database, cipher, now, coreInvocation(commit, target));
    },
    forHostSceneCreation(sceneId, takeId): RecordStore {
      if (scope || hostBirth) throw new Error("A scoped Core store cannot create another host scene");
      return scopedCoreRecords(database, cipher, now, undefined, { sceneId, takeId });
    },
    async link(chatId: string, sessionId: string, branchId: string): Promise<void> {
      await write(() => {
        if (hostBirth) throw new Error("Host Core scene creation links atomically with its session header");
        if (scope) {
          if (chatId !== scope.target.sceneId || branchId !== scope.target.takeId) throw new Error("Core link differs from the invocation target");
          authority.authorize(scope, sessionId);
        }
        statement("INSERT INTO core_scene_links (chat_id, session_id, branch_id) VALUES (?, ?, ?)").run(chatId, sessionId, branchId);
      });
    },
    async sceneFor(chatId: string): Promise<{ sessionId: string; branchId: string } | null> {
      cipher.ready();
      await database.idle();
      const row = statement("SELECT session_id, branch_id FROM core_scene_links WHERE chat_id = ?").get(chatId) as { session_id: string; branch_id: string } | null;
      return row ? { sessionId: row.session_id, branchId: row.branch_id } : null;
    },
    async sceneForBranch(branchId: string): Promise<string | null> {
      cipher.ready();
      await database.idle();
      const row = statement("SELECT l.chat_id FROM core_scene_links l JOIN branches b ON b.chat_id = l.chat_id WHERE b.id = ?").get(branchId) as { chat_id: string } | null;
      return row?.chat_id ?? null;
    },
    async sceneForMessage(messageId: string): Promise<string | null> {
      cipher.ready();
      await database.idle();
      const row = statement("SELECT l.chat_id FROM core_scene_links l JOIN branches b ON b.chat_id = l.chat_id JOIN messages m ON m.branch_id = b.id WHERE m.id = ?").get(messageId) as { chat_id: string } | null;
      return row?.chat_id ?? null;
    },
    async create(header: SessionHeader, initial: readonly Entry[] = []): Promise<void> {
      await write(() => {
        if (scope) authority.authorize(scope, header.id, true);
        if (hostBirth) requireHostCoreBirth(database, cipher, hostBirth.sceneId, hostBirth.takeId);
        if (readSession(header.id)) throw new Error("rp-core session already exists");
        let seq = 0;
        for (const entry of initial) if (entry.seq !== ++seq) throw new Error("rp-core journal sequence gap");
        statement("INSERT INTO core_sessions (id, header_cell, title_cell, updated_at) VALUES (?, ?, ?, ?)").run(
          header.id, cipher.seal(HEADER, JSON.stringify(header)), header.title ? cipher.seal(TITLE, header.title) : null, header.created,
        );
        for (const entry of initial) statement("INSERT INTO core_entries (session_id, seq, entry_cell) VALUES (?, ?, ?)").run(header.id, entry.seq, cipher.seal(ENTRY, JSON.stringify(entry)));
        if (scope) authority.accepted(scope, header.id, initial.length ? 1 : 0, initial.length);
        if (hostBirth) authority.acceptedHostCreation(hostBirth.sceneId, hostBirth.takeId, header.id, initial.length ? 1 : 0, initial.length);
      });
    },
    async acquire(session: string): Promise<Lease> {
      checkRead(session);
      const token = crypto.randomUUID();
      await write(() => {
        const row = readSession(session);
        if (!row) throw new Error("rp-core session not found");
        if (row.lease_owner && row.lease_until !== null && row.lease_until > now()) throw new Error("rp-core session locked");
        statement("UPDATE core_sessions SET lease_owner = ?, lease_until = ? WHERE id = ?").run(token, now() + LEASE_MS, session);
      });
      let released = false;
      return {
        session,
        async renew(): Promise<void> {
          if (released) throw new Error("rp-core session lease released");
          await write(() => {
            own(session, token);
            statement("UPDATE core_sessions SET lease_until = ? WHERE id = ?").run(now() + LEASE_MS, session);
          });
        },
        async release(): Promise<void> {
          if (released) return;
          await write(() => {
            own(session, token);
            statement("UPDATE core_sessions SET lease_owner = NULL, lease_until = NULL WHERE id = ?").run(session);
          });
          released = true;
        },
        get owner() { return token; },
      } as Lease;
    },
    async *read(session: string): AsyncIterable<SessionHeader | Entry> {
      checkRead(session);
      cipher.ready();
      await database.idle();
      const row = readSession(session);
      if (!row) throw new Error("rp-core session not found");
      const entries = statement("SELECT seq, entry_cell FROM core_entries WHERE session_id = ? ORDER BY seq").all(session) as EntryRow[];
      yield JSON.parse(cipher.open(HEADER, row.header_cell)) as SessionHeader;
      for (const entry of entries) yield JSON.parse(cipher.open(ENTRY, entry.entry_cell)) as Entry;
    },
    async append(lease: Lease, entries: readonly Entry[], _durable: boolean): Promise<void> {
      if (hostBirth) throw new Error("Host Core scene birth authority permits only its atomic session create");
      const token = (lease as Lease & { owner?: string }).owner;
      if (!token) throw new Error("foreign rp-core session lease");
      if (entries.length === 0) return;
      await write(() => {
        if (scope) authority.authorize(scope, lease.session);
        const row = own(lease.session, token);
        let seq = lastSeq(lease.session);
        const firstSeq = seq + 1;
        for (const entry of entries) if (entry.seq !== ++seq) throw new Error("rp-core journal sequence gap");
        for (const entry of entries) statement("INSERT INTO core_entries (session_id, seq, entry_cell) VALUES (?, ?, ?)").run(lease.session, entry.seq, cipher.seal(ENTRY, JSON.stringify(entry)));
        const latest = entries.at(-1)!;
        const title = latest.t === "name" && !latest.leaf ? cipher.seal(TITLE, latest.title) : row.title_cell;
        const updated = "ts" in latest ? latest.ts : row.updated_at;
        statement("UPDATE core_sessions SET title_cell = ?, updated_at = ? WHERE id = ?").run(title, updated, lease.session);
        if (scope) authority.accepted(scope, lease.session, firstSeq, seq);
        if (scope) corePendingState(database, cipher, now).accept(scope, entries);
      });
    },
    async list(): Promise<{ id: string; title?: string; updated: string }[]> {
      cipher.ready();
      await database.idle();
      const rows = statement("SELECT id, title_cell, updated_at FROM core_sessions ORDER BY updated_at DESC").all() as Array<{ id: string; title_cell: string | null; updated_at: string }>;
      return rows.filter((row) => !scope || row.id === (scope.target.sessionId ?? authority.operation(scope.target.operationId)?.session_id)).map((row) => ({ id: row.id, ...(row.title_cell ? { title: cipher.open(TITLE, row.title_cell) } : {}), updated: row.updated_at }));
    },
  };
}
