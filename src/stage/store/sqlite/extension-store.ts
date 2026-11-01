/** SQLite ExtensionStore: content is sealed, indexed by keyed hashes, and all writes are fenced. */
import { refuseWhileLocked, type CellCipher } from "../../crypto/cell-cipher";
import type { EffectReceipt } from "../../../extensions/contracts/grants";
import { MAX_EXTENSION_LOG_PAGE_SIZE } from "../../../extensions/contracts/limits";
import { isOperationId } from "../../../extensions/contracts/operation-id";
import type { ExtensionStore, ExtensionRuntimeFence, ExtensionCommitContext, ExtensionWriteFence, StoredExtensionControl, StoredExtensionData, StoredExtensionPackage, ExtensionBudget, ExtensionBudgetReservation, StoredExtensionLog } from "../../contracts/extension-store";
import { checkedControl, checkedFence, checkedPackage, checkedReceipt, receiptUpdate, checkedExtensionLog, checkedValue, checkExtensionId, checkExtensionKey, checkExtensionPackageDigest, MAX_EXTENSION_BUDGET_RESERVATIONS, MAX_EXTENSION_CONTROLS, MAX_EXTENSION_DATA_BYTES, MAX_EXTENSION_DATA_KEYS, MAX_EXTENSION_DATA_TOTAL_BYTES, MAX_EXTENSION_LIST, MAX_EXTENSION_PACKAGE_TOTAL_BYTES, MAX_EXTENSION_RECEIPTS, MAX_EXTENSION_LOGS } from "../extension-store-rules";
import { requireExtensionCommit } from "./extension-commit-guard";
import type { StageDatabase } from "./database";

type LeaseRow = { epoch: number; owner_cell: string | null; expires_at: number; last_now: number };
type ControlRow = { revision: number; body_cell: string };

export function sqliteExtensionStore(database: StageDatabase, cipher: CellCipher, clock: () => number = Date.now): ExtensionStore {
  const { statement } = database;
  const readLease = (): LeaseRow | null => statement("SELECT epoch, owner_cell, expires_at, last_now FROM extension_runtime_lease WHERE singleton = 1").get() as LeaseRow | null;
  const owns = (fence: ExtensionRuntimeFence, now: number): boolean => {
    const row = readLease();
    return !!row && !!row.owner_cell && row.epoch === fence.epoch && cipher.open("extension_runtime_lease.owner_cell", row.owner_cell) === fence.owner && now >= row.last_now && now < row.expires_at;
  };
  const requireFence = (fence: ExtensionRuntimeFence, now = clock()): void => {
    checkedFence(fence);
    if (!owns(fence, now)) throw new Error("extension runtime fence is stale");
  };
  const requireDataFence = (packageId: string, fence: ExtensionWriteFence): void => {
    requireFence(fence);
    if ("packageId" in fence) requireExtensionCommit(database, cipher, fence as ExtensionCommitContext, packageId);
  };
  const sql = {
    acquireRuntimeFence: async (owner: string, now: number, ttlMs: number) => database.patiently(() => database.transaction(() => {
      if (!/^[a-f0-9-]{36}$/.test(owner) || ttlMs !== 30_000 || !Number.isSafeInteger(now)) throw new Error("invalid extension lease request");
      const row = readLease();
      if (row && (now < row.last_now || (row.owner_cell !== null && now < row.expires_at))) return null;
      const recoveryRequired = row?.owner_cell !== null && row !== null;
      const epoch = (row?.epoch ?? 0) + 1;
      const ownerCell = cipher.seal("extension_runtime_lease.owner_cell", owner);
      if (row) statement("UPDATE extension_runtime_lease SET epoch = ?, owner_cell = ?, expires_at = ?, last_now = ? WHERE singleton = 1")
        .run(epoch, ownerCell, now + ttlMs, now);
      else statement("INSERT INTO extension_runtime_lease (singleton, epoch, owner_cell, expires_at, last_now) VALUES (1, ?, ?, ?, ?)")
        .run(epoch, ownerCell, now + ttlMs, now);
      return { owner, epoch, recoveryRequired };
    })),
    renewRuntimeFence: async (fence: ExtensionRuntimeFence, now: number, ttlMs: number) => database.patiently(() => database.transaction(() => {
      if (ttlMs !== 30_000 || !Number.isSafeInteger(now) || !owns(fence, now)) return null;
      statement("UPDATE extension_runtime_lease SET expires_at = ?, last_now = ? WHERE singleton = 1 AND epoch = ?").run(now + ttlMs, now, fence.epoch);
      return { ...fence };
    })),
    releaseRuntimeFence: async (fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      if (!owns(fence, clock())) return false;
      statement("UPDATE extension_runtime_lease SET owner_cell = NULL, expires_at = 0 WHERE singleton = 1 AND epoch = ?").run(fence.epoch);
      return true;
    })),
    savePackage: async (input: StoredExtensionPackage, fence: ExtensionRuntimeFence) => {
      const pkg = await checkedPackage(input);
      await database.patiently(() => database.transaction(() => {
        requireFence(fence);
        const existing = statement("SELECT bytes, body_cell FROM extension_packages WHERE digest = ?").get(pkg.digest) as { bytes: number; body_cell: string } | null;
        if (existing) {
          const bytes = Uint8Array.from(Buffer.from(cipher.open("extension_packages.body_cell", existing.body_cell), "base64"));
          if (existing.bytes !== pkg.bytes.byteLength || bytes.byteLength !== pkg.bytes.byteLength || bytes.some((byte, index) => byte !== pkg.bytes[index])) throw new Error("package digest collision");
          return;
        }
        const total = statement("SELECT COALESCE(SUM(bytes), 0) AS n FROM extension_packages").get() as { n: number };
        if (total.n + pkg.bytes.byteLength > MAX_EXTENSION_PACKAGE_TOTAL_BYTES) throw new Error("extension package storage limit reached");
        statement("INSERT INTO extension_packages (digest, bytes, body_cell) VALUES (?, ?, ?)").run(pkg.digest, pkg.bytes.byteLength, cipher.seal("extension_packages.body_cell", Buffer.from(pkg.bytes).toString("base64")));
        requireFence(fence);
      }));
    },
    readPackage: async (digest: string) => {
      checkExtensionPackageDigest(digest);
      const row = statement("SELECT bytes, body_cell FROM extension_packages WHERE digest = ?").get(digest) as { bytes: number; body_cell: string } | null;
      if (!row) return null;
      const bytes = Uint8Array.from(Buffer.from(cipher.open("extension_packages.body_cell", row.body_cell), "base64"));
      if (bytes.byteLength !== row.bytes) throw new Error("stored extension package size mismatch");
      return checkedPackage({ digest, bytes });
    },
    listControls: async () => (statement("SELECT id_hash, body_cell FROM extension_controls ORDER BY id_hash").all() as { id_hash: string; body_cell: string }[]).map(({ id_hash, body_cell }) => {
      const control = checkedControl(JSON.parse(cipher.open("extension_controls.body_cell", body_cell)) as StoredExtensionControl);
      if (cipher.index(control.id) !== id_hash) throw new Error("stored extension control identity mismatch");
      return control;
    }),
    readControl: async (id: string) => {
      const hash = cipher.index(checkExtensionId(id));
      const row = statement("SELECT id_hash, body_cell FROM extension_controls WHERE id_hash = ?").get(hash) as { id_hash: string; body_cell: string } | null;
      if (!row) return null;
      const control = checkedControl(JSON.parse(cipher.open("extension_controls.body_cell", row.body_cell)) as StoredExtensionControl);
      if (control.id !== id || cipher.index(control.id) !== row.id_hash) throw new Error("stored extension control identity mismatch");
      return control;
    },
    compareAndSaveControl: async (input: StoredExtensionControl, expectedRevision: number, fence: ExtensionWriteFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      if ("packageId" in fence) requireExtensionCommit(database, cipher, fence);
      const control = checkedControl(input); const idHash = cipher.index(control.id);
      const row = statement("SELECT revision FROM extension_controls WHERE id_hash = ?").get(idHash) as { revision: number } | null;
      if ((row?.revision ?? -1) !== expectedRevision || control.revision !== expectedRevision + 1) return "stale" as const;
      if (!row && (statement("SELECT COUNT(*) AS n FROM extension_controls").get() as { n: number }).n >= MAX_EXTENSION_CONTROLS) throw new Error("extension count limit reached");
      const cell = cipher.seal("extension_controls.body_cell", JSON.stringify(control));
      if (row) statement("UPDATE extension_controls SET revision = ?, body_cell = ? WHERE id_hash = ?").run(control.revision, cell, idHash);
      else statement("INSERT INTO extension_controls (id_hash, revision, body_cell) VALUES (?, ?, ?)").run(idHash, control.revision, cell);
      requireFence(fence);
      return "saved" as const;
    })),
    removeInstalled: async (packageId: string, expectedRevision: number, fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      const id = checkExtensionId(packageId); const idHash = cipher.index(id);
      const row = statement("SELECT revision, body_cell FROM extension_controls WHERE id_hash = ?").get(idHash) as { revision: number; body_cell: string } | null;
      if (!row || row.revision !== expectedRevision) return "stale" as const;
      const control = checkedControl(JSON.parse(cipher.open("extension_controls.body_cell", row.body_cell)) as StoredExtensionControl);
      if (control.id !== id) throw new Error("stored extension control identity mismatch");
      if (control.hostTrusted) throw new Error("host-trusted extensions cannot be uninstalled");
      const packageHash = cipher.index(id);
      statement("DELETE FROM extension_controls WHERE id_hash = ?").run(idHash);
      statement("DELETE FROM extension_data WHERE package_hash = ?").run(packageHash);
      statement("DELETE FROM extension_receipts WHERE package_hash = ?").run(packageHash);
      statement("DELETE FROM extension_logs WHERE package_hash = ?").run(packageHash);
      statement("DELETE FROM extension_budget_reservations WHERE package_hash = ?").run(packageHash);
      statement("DELETE FROM extension_budget_usage WHERE package_hash = ?").run(packageHash);
      const references = (statement("SELECT id_hash, body_cell FROM extension_controls").all() as { id_hash: string; body_cell: string }[]).some(({ id_hash: otherHash, body_cell }) => {
        const other = checkedControl(JSON.parse(cipher.open("extension_controls.body_cell", body_cell)) as StoredExtensionControl);
        if (cipher.index(other.id) !== otherHash) throw new Error("stored extension control identity mismatch");
        return other.packageDigest === control.packageDigest;
      });
      if (!references) statement("DELETE FROM extension_packages WHERE digest = ?").run(control.packageDigest);
      requireFence(fence);
      return "saved" as const;
    })),
    readData: async (packageId: string, key: string) => {
      const id = checkExtensionId(packageId); const name = checkExtensionKey(key);
      const row = statement("SELECT revision, bytes, body_cell FROM extension_data WHERE package_hash = ? AND key_hash = ?").get(cipher.index(id), cipher.index(`${id}\0${name}`)) as { revision: number; bytes: number; body_cell: string } | null;
      if (!row) return null;
      const doc = JSON.parse(cipher.open("extension_data.body_cell", row.body_cell)) as { packageId: string; key: string; value: unknown };
      if (doc.packageId !== id || doc.key !== name) throw new Error("extension data identity mismatch");
      const value = checkedValue(doc.value as StoredExtensionData["value"]);
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength !== row.bytes) throw new Error("stored extension data size mismatch");
      return { revision: row.revision, value };
    },
    listDataKeys: async (packageId: string, limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LIST) throw new Error("invalid extension data list limit");
      const id = checkExtensionId(packageId); const rows = statement("SELECT body_cell FROM extension_data WHERE package_hash = ? ORDER BY key_hash LIMIT ?").all(cipher.index(id), Math.min(MAX_EXTENSION_DATA_KEYS, limit)) as { body_cell: string }[];
      return rows.map(({ body_cell }) => {
        const doc = JSON.parse(cipher.open("extension_data.body_cell", body_cell)) as { packageId: string; key: string };
        if (doc.packageId !== id) throw new Error("extension data identity mismatch");
        return checkExtensionKey(doc.key);
      }).sort();
    },
    compareAndSaveData: async (packageId: string, key: string, input: StoredExtensionData["value"], expectedRevision: number, fence: ExtensionWriteFence) => database.patiently(() => database.transaction(() => {
      requireDataFence(packageId, fence);
      const id = checkExtensionId(packageId); const name = checkExtensionKey(key); const value = checkedValue(input);
      const packageHash = cipher.index(id); const keyHash = cipher.index(`${id}\0${name}`);
      const row = statement("SELECT revision FROM extension_data WHERE package_hash = ? AND key_hash = ?").get(packageHash, keyHash) as { revision: number } | null;
      if ((row?.revision ?? -1) !== expectedRevision) return "stale" as const;
      const count = statement("SELECT COUNT(*) AS n FROM extension_data WHERE package_hash = ?").get(packageHash) as { n: number };
      if (!row && count.n >= MAX_EXTENSION_DATA_KEYS) throw new Error("extension data key limit reached");
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      const current = statement("SELECT bytes FROM extension_data WHERE package_hash = ? AND key_hash = ?").get(packageHash, keyHash) as { bytes: number } | null;
      const total = statement("SELECT COALESCE(SUM(bytes), 0) AS n FROM extension_data WHERE package_hash = ?").get(packageHash) as { n: number };
      if (bytes > MAX_EXTENSION_DATA_BYTES || total.n - (current?.bytes ?? 0) + bytes > MAX_EXTENSION_DATA_TOTAL_BYTES) throw new Error("extension data storage limit reached");
      const revision = expectedRevision + 1; const body = JSON.stringify({ packageId: id, key: name, value });
      const cell = cipher.seal("extension_data.body_cell", body);
      if (row) statement("UPDATE extension_data SET revision = ?, bytes = ?, body_cell = ? WHERE package_hash = ? AND key_hash = ?")
        .run(revision, bytes, cell, packageHash, keyHash);
      else statement("INSERT INTO extension_data (package_hash, key_hash, revision, bytes, body_cell) VALUES (?, ?, ?, ?, ?)")
        .run(packageHash, keyHash, revision, bytes, cell);
      requireDataFence(packageId, fence);
      return "saved" as const;
    })),
    deleteData: async (packageId: string, key: string, expectedRevision: number, fence: ExtensionWriteFence) => database.patiently(() => database.transaction(() => {
      requireDataFence(packageId, fence);
      const id = checkExtensionId(packageId); const packageHash = cipher.index(id); const keyHash = cipher.index(`${id}\0${checkExtensionKey(key)}`);
      const row = statement("SELECT revision FROM extension_data WHERE package_hash = ? AND key_hash = ?").get(packageHash, keyHash) as { revision: number } | null;
      if ((row?.revision ?? -1) !== expectedRevision) return "stale" as const;
      statement("DELETE FROM extension_data WHERE package_hash = ? AND key_hash = ?").run(packageHash, keyHash);
      requireDataFence(packageId, fence);
      requireFence(fence);
      return "saved" as const;
    })),
    reserveBudget: async (input: ExtensionBudgetReservation, limits: ExtensionBudget, fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      const packageId = checkExtensionId(input.packageId);
      if (!isOperationId(input.operation) || !Number.isSafeInteger(input.grantRevision) || input.grantRevision < 0
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || !Number.isSafeInteger(input.tokens) || input.tokens < 0) throw new Error("invalid extension budget reservation");
      for (const amount of Object.values(limits)) if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid extension budget limit");
      const packageHash = cipher.index(packageId); const operationHash = cipher.index(input.operation); const reservationHash = cipher.index(`${packageId}\0${input.id}`);
      if (statement("SELECT 1 FROM extension_budget_reservations WHERE reservation_hash = ?").get(reservationHash)) return false;
      const pending = statement("SELECT COUNT(*) AS n FROM extension_budget_reservations WHERE package_hash = ?").get(packageHash) as { n: number };
      if (pending.n >= MAX_EXTENSION_BUDGET_RESERVATIONS) return false;
      const row = statement("SELECT body_cell FROM extension_budget_usage WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?").get(packageHash, operationHash, input.grantRevision) as { body_cell: string } | null;
      const usage = row ? JSON.parse(cipher.open("extension_budget_usage.body_cell", row.body_cell)) as { packageId: string; operation: string; grantRevision: number; requests: number; bytes: number; tokens: number; reservedBytes: number; reservedTokens: number; limits: ExtensionBudget } : { packageId, operation: input.operation, grantRevision: input.grantRevision, requests: 0, bytes: 0, tokens: 0, reservedBytes: 0, reservedTokens: 0, limits };
      if (usage.packageId !== packageId || usage.operation !== input.operation || usage.grantRevision !== input.grantRevision) throw new Error("stored extension budget identity mismatch");
      if (JSON.stringify(usage.limits) !== JSON.stringify(limits)) throw new Error("extension grant budget changed without a revision");
      if (usage.requests + 1 > limits.requests || usage.bytes + usage.reservedBytes + input.bytes > limits.bytes || usage.tokens + usage.reservedTokens + input.tokens > limits.tokens) return false;
      usage.requests++; usage.reservedBytes += input.bytes; usage.reservedTokens += input.tokens;
      const usageCell = cipher.seal("extension_budget_usage.body_cell", JSON.stringify(usage));
      if (row) statement("UPDATE extension_budget_usage SET body_cell = ? WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?")
        .run(usageCell, packageHash, operationHash, input.grantRevision);
      else statement("INSERT INTO extension_budget_usage (package_hash, operation_hash, grant_revision, body_cell) VALUES (?, ?, ?, ?)")
        .run(packageHash, operationHash, input.grantRevision, usageCell);
      statement("INSERT INTO extension_budget_reservations (reservation_hash, package_hash, body_cell) VALUES (?, ?, ?)").run(reservationHash, packageHash, cipher.seal("extension_budget_reservations.body_cell", JSON.stringify({ ...input, packageId })));
      requireFence(fence);
      return true;
    })),
    settleBudget: async (packageId: string, reservationId: string, bytes: number, tokens: number, fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      const id = checkExtensionId(packageId); const packageHash = cipher.index(id); const reservationHash = cipher.index(`${id}\0${reservationId}`);
      const row = statement("SELECT body_cell FROM extension_budget_reservations WHERE reservation_hash = ? AND package_hash = ?").get(reservationHash, packageHash) as { body_cell: string } | null;
      if (!row) return false;
      const reservation = JSON.parse(cipher.open("extension_budget_reservations.body_cell", row.body_cell)) as ExtensionBudgetReservation;
      if (reservation.packageId !== id || reservation.id !== reservationId || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > reservation.bytes || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > reservation.tokens) throw new Error("actual extension usage exceeds its reservation");
      const operationHash = cipher.index(reservation.operation);
      const usageRow = statement("SELECT body_cell FROM extension_budget_usage WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?").get(packageHash, operationHash, reservation.grantRevision) as { body_cell: string } | null;
      if (!usageRow) throw new Error("extension budget usage is missing");
      const usage = JSON.parse(cipher.open("extension_budget_usage.body_cell", usageRow.body_cell)) as { packageId: string; operation: string; grantRevision: number; requests: number; bytes: number; tokens: number; reservedBytes: number; reservedTokens: number; limits: ExtensionBudget };
      if (usage.packageId !== id || usage.operation !== reservation.operation || usage.grantRevision !== reservation.grantRevision) throw new Error("stored extension budget identity mismatch");
      usage.bytes += bytes; usage.tokens += tokens; usage.reservedBytes -= reservation.bytes; usage.reservedTokens -= reservation.tokens;
      statement("UPDATE extension_budget_usage SET body_cell = ? WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?").run(cipher.seal("extension_budget_usage.body_cell", JSON.stringify(usage)), packageHash, operationHash, reservation.grantRevision);
      statement("DELETE FROM extension_budget_reservations WHERE reservation_hash = ?").run(reservationHash);
      requireFence(fence);
      return true;
    })),
    finalizeAbandonedBudget: async (packageId: string, fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      const id = checkExtensionId(packageId); const packageHash = cipher.index(id);
      const rows = statement("SELECT reservation_hash, body_cell FROM extension_budget_reservations WHERE package_hash = ?").all(packageHash) as { reservation_hash: string; body_cell: string }[];
      for (const row of rows) {
        const reservation = JSON.parse(cipher.open("extension_budget_reservations.body_cell", row.body_cell)) as ExtensionBudgetReservation;
        if (reservation.packageId !== id) throw new Error("stored extension reservation identity mismatch");
        const operationHash = cipher.index(reservation.operation);
        const usageRow = statement("SELECT body_cell FROM extension_budget_usage WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?").get(packageHash, operationHash, reservation.grantRevision) as { body_cell: string } | null;
        if (!usageRow) throw new Error("extension budget usage is missing");
        const usage = JSON.parse(cipher.open("extension_budget_usage.body_cell", usageRow.body_cell)) as { packageId: string; operation: string; grantRevision: number; requests: number; bytes: number; tokens: number; reservedBytes: number; reservedTokens: number; limits: ExtensionBudget };
        if (usage.packageId !== id || usage.operation !== reservation.operation || usage.grantRevision !== reservation.grantRevision) throw new Error("stored extension budget identity mismatch");
        usage.bytes += reservation.bytes; usage.tokens += reservation.tokens; usage.reservedBytes -= reservation.bytes; usage.reservedTokens -= reservation.tokens;
        statement("UPDATE extension_budget_usage SET body_cell = ? WHERE package_hash = ? AND operation_hash = ? AND grant_revision = ?").run(cipher.seal("extension_budget_usage.body_cell", JSON.stringify(usage)), packageHash, operationHash, reservation.grantRevision);
        statement("DELETE FROM extension_budget_reservations WHERE reservation_hash = ?").run(row.reservation_hash);
      }
      requireFence(fence);
      return rows.length;
    })),
    appendReceipt: async (input: EffectReceipt, fence: ExtensionRuntimeFence) => database.patiently(() => database.transaction(() => {
      requireFence(fence);
      const receipt = checkedReceipt(input); const ownerHash = cipher.index(receipt.packageId); const receiptHash = cipher.index(`${receipt.packageId}\0${receipt.id}`);
      const cell = cipher.seal("extension_receipts.body_cell", JSON.stringify(receipt));
      const previous = statement("SELECT body_cell FROM extension_receipts WHERE receipt_hash = ?").get(receiptHash) as { body_cell: string } | null;
      if (previous) {
        const prior = checkedReceipt(JSON.parse(cipher.open("extension_receipts.body_cell", previous.body_cell)) as EffectReceipt);
        const update = receiptUpdate(prior, receipt);
        if (update === "same") return;
        if (update === "update") {
          statement("UPDATE extension_receipts SET body_cell = ? WHERE receipt_hash = ?").run(cell, receiptHash);
          requireFence(fence);
          return;
        }
      }
      statement("INSERT INTO extension_receipts (package_hash, receipt_hash, body_cell) VALUES (?, ?, ?)").run(ownerHash, receiptHash, cell);
      const count = statement("SELECT COUNT(*) AS n FROM extension_receipts WHERE package_hash = ?").get(ownerHash) as { n: number };
      if (count.n > MAX_EXTENSION_RECEIPTS) statement("DELETE FROM extension_receipts WHERE seq IN (SELECT seq FROM extension_receipts WHERE package_hash = ? ORDER BY seq LIMIT ?)").run(ownerHash, count.n - MAX_EXTENSION_RECEIPTS);
      requireFence(fence);
    })),
    listReceipts: async (packageId: string, after: string | null, limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LIST) throw new Error("invalid extension receipt list limit");
      const ownerHash = cipher.index(checkExtensionId(packageId));
      const afterRow = after ? statement("SELECT seq FROM extension_receipts WHERE receipt_hash = ? AND package_hash = ?").get(cipher.index(`${packageId}\0${after}`), ownerHash) as { seq: number } | null : null;
      const rows = statement(`SELECT body_cell FROM extension_receipts WHERE package_hash = ? AND seq > ? ORDER BY seq LIMIT ?`).all(ownerHash, afterRow?.seq ?? 0, limit) as { body_cell: string }[];
      return rows.map(({ body_cell }) => {
        const receipt = checkedReceipt(JSON.parse(cipher.open("extension_receipts.body_cell", body_cell)) as EffectReceipt);
        if (receipt.packageId !== packageId) throw new Error("stored extension receipt identity mismatch");
        return receipt;
      });
    },
    appendLog: async (packageId: string, input: StoredExtensionLog, fence: ExtensionCommitContext) => database.patiently(() => database.transaction(() => {
      requireDataFence(packageId, fence);
      if (fence.operation !== "logs.write") throw new Error("extension log authority is invalid");
      const id = checkExtensionId(packageId); const log = checkedExtensionLog(input);
      const ownerHash = cipher.index(id); const logHash = cipher.index(`${id}\0${log.id}`);
      if (statement("SELECT 1 FROM extension_logs WHERE log_hash = ?").get(logHash)) throw new Error("extension log ID was reused");
      statement("INSERT INTO extension_logs (package_hash, log_hash, body_cell) VALUES (?, ?, ?)")
        .run(ownerHash, logHash, cipher.seal("extension_logs.body_cell", JSON.stringify({ packageId: id, ...log })));
      const count = statement("SELECT COUNT(*) AS n FROM extension_logs WHERE package_hash = ?").get(ownerHash) as { n: number };
      if (count.n > MAX_EXTENSION_LOGS) statement("DELETE FROM extension_logs WHERE seq IN (SELECT seq FROM extension_logs WHERE package_hash = ? ORDER BY seq LIMIT ?)").run(ownerHash, count.n - MAX_EXTENSION_LOGS);
      requireDataFence(packageId, fence);
    })),
    listLogs: async (packageId: string, after: string | null, limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LOG_PAGE_SIZE) throw new Error("invalid extension log list limit");
      const id = checkExtensionId(packageId); const ownerHash = cipher.index(id);
      const afterRow = after ? statement("SELECT seq FROM extension_logs WHERE log_hash = ? AND package_hash = ?").get(cipher.index(`${id}\0${after}`), ownerHash) as { seq: number } | null : null;
      if (after && !afterRow) throw new Error("extension log cursor is stale");
      const rows = statement("SELECT log_hash, body_cell FROM extension_logs WHERE package_hash = ? AND seq > ? ORDER BY seq LIMIT ?").all(ownerHash, afterRow?.seq ?? 0, limit + 1) as { log_hash: string; body_cell: string }[];
      const parsed = rows.map(({ log_hash, body_cell }) => {
        const body = JSON.parse(cipher.open("extension_logs.body_cell", body_cell)) as { packageId: string } & StoredExtensionLog;
        if (body.packageId !== id || cipher.index(`${id}\0${body.id}`) !== log_hash) throw new Error("stored extension log identity mismatch");
        const { packageId: _packageId, ...log } = body;
        return checkedExtensionLog(log);
      });
      const records = parsed.slice(0, limit);
      return { records, nextCursor: parsed.length > limit && records.length ? records.at(-1)!.id : null };
    },
  } satisfies ExtensionStore;
  return refuseWhileLocked(cipher, sql, database.idle);
}
