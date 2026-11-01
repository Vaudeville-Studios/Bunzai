/** In-memory ExtensionStore with the same revision, quota and lease semantics as SQLite. */
import type { ExtensionStore, ExtensionRuntimeFence, ExtensionCommitContext, ExtensionWriteFence, StoredExtensionControl, StoredExtensionData, StoredExtensionPackage, ExtensionBudget, ExtensionBudgetReservation, StoredExtensionLog } from "../../contracts/extension-store";
import type { EffectReceipt } from "../../../extensions/contracts/grants";
import { MAX_EXTENSION_LOG_PAGE_SIZE } from "../../../extensions/contracts/limits";
import { isOperationId } from "../../../extensions/contracts/operation-id";
import { checkedControl, checkedFence, checkedPackage, checkedReceipt, receiptUpdate, checkedExtensionLog, checkedValue, checkExtensionId, checkExtensionKey, MAX_EXTENSION_BUDGET_RESERVATIONS, MAX_EXTENSION_CONTROLS, MAX_EXTENSION_DATA_BYTES, MAX_EXTENSION_DATA_KEYS, MAX_EXTENSION_DATA_TOTAL_BYTES, MAX_EXTENSION_LIST, MAX_EXTENSION_PACKAGE_TOTAL_BYTES, MAX_EXTENSION_RECEIPTS, MAX_EXTENSION_LOGS } from "../extension-store-rules";
import { requireCommitAccessWithinGrant } from "../extension-commit-access";

export interface MemoryExtensionStore extends ExtensionStore { assertCommitContext(context: ExtensionCommitContext): void }

export function memoryExtensionStore(clock: () => number = Date.now): MemoryExtensionStore {
  const packages = new Map<string, StoredExtensionPackage>();
  const controls = new Map<string, StoredExtensionControl>();
  const data = new Map<string, Map<string, StoredExtensionData>>();
  const receipts = new Map<string, EffectReceipt[]>();
  const logs = new Map<string, StoredExtensionLog[]>();
  const usage = new Map<string, { requests: number; bytes: number; tokens: number; reservedBytes: number; reservedTokens: number; limits: ExtensionBudget }>();
  const reservations = new Map<string, ExtensionBudgetReservation>();
  let epoch = 0;
  let lease: { owner: string; epoch: number; expiresAt: number; lastNow: number } | null = null;
  const owns = (fence: ExtensionRuntimeFence, now = clock()): boolean => !!lease && fence.owner === lease.owner && fence.epoch === lease.epoch && now >= lease.lastNow && now < lease.expiresAt;
  const requireFence = (fence: ExtensionRuntimeFence): void => { checkedFence(fence); if (!owns(fence)) throw new Error("extension runtime fence is stale"); };
  const assertCommitContext = (context: ExtensionCommitContext): void => {
    checkedFence(context);
    const now = context.now();
    if (!Number.isSafeInteger(now) || !owns(context, now)) throw new Error("extension runtime fence is stale at commit");
    const control = controls.get(checkExtensionId(context.packageId));
    const grant = control?.grants.find((item) => item.operation === context.operation);
    if (!control || !control.enabled || control.recoveryRequired || control.packageDigest !== context.packageDigest
      || control.policyFingerprint !== context.policyFingerprint || control.grantRevision !== context.grantRevision
      || !grant) throw new Error("extension authority changed before commit");
    requireCommitAccessWithinGrant(context, grant);
  };
  const requireWriteFence = (fence: ExtensionWriteFence, packageId: string): void => {
    if ("packageId" in fence) {
      assertCommitContext(fence);
      if (fence.packageId !== packageId) throw new Error("extension commit package mismatch");
    } else requireFence(fence);
  };
  const result: ExtensionStore = {
    async acquireRuntimeFence(owner, now, ttlMs) {
      if (!/^[a-f0-9-]{36}$/.test(owner) || ttlMs !== 30_000 || !Number.isSafeInteger(now)) throw new Error("invalid extension lease request");
      if (lease && (now < lease.lastNow || now < lease.expiresAt)) return null;
      const recoveryRequired = lease !== null;
      epoch++;
      lease = { owner, epoch, expiresAt: now + ttlMs, lastNow: now };
      return { owner, epoch, recoveryRequired };
    },
    async renewRuntimeFence(fence, now, ttlMs) {
      if (ttlMs !== 30_000 || !Number.isSafeInteger(now) || !owns(fence, now)) return null;
      lease = { owner: fence.owner, epoch: fence.epoch, expiresAt: now + ttlMs, lastNow: now };
      return { ...fence };
    },
    async releaseRuntimeFence(fence) {
      if (!owns(fence)) return false;
      lease = null;
      return true;
    },
    async savePackage(input, fence) {
      requireFence(fence);
      const pkg = await checkedPackage(input);
      requireFence(fence);
      const existing = packages.get(pkg.digest);
      if (existing && (existing.bytes.byteLength !== pkg.bytes.byteLength || existing.bytes.some((byte, index) => byte !== pkg.bytes[index]))) throw new Error("package digest collision");
      const total = [...packages.values()].reduce((sum, item) => sum + item.bytes.byteLength, 0);
      if (!existing && total + pkg.bytes.byteLength > MAX_EXTENSION_PACKAGE_TOTAL_BYTES) throw new Error("extension package storage limit reached");
      packages.set(pkg.digest, pkg);
    },
    async readPackage(digest) { const pkg = packages.get(digest); return pkg ? { ...pkg, bytes: pkg.bytes.slice() } : null; },
    async listControls() { return [...controls.values()].map((control) => structuredClone(control)); },
    async readControl(id) { const control = controls.get(checkExtensionId(id)); return control ? structuredClone(control) : null; },
    async compareAndSaveControl(input, expectedRevision, fence) {
      requireFence(fence);
      const control = checkedControl(input); const current = controls.get(control.id);
      if ("packageId" in fence) {
        assertCommitContext(fence);
        if (!current || fence.packageId !== control.id) throw new Error("extension authority changed before control commit");
      }
      if ((current?.revision ?? -1) !== expectedRevision || control.revision !== expectedRevision + 1) return "stale";
      if (!current && controls.size >= MAX_EXTENSION_CONTROLS) throw new Error("extension count limit reached");
      controls.set(control.id, control); return "saved";
    },
    async removeInstalled(packageId, expectedRevision, fence) {
      requireFence(fence);
      const id = checkExtensionId(packageId); const control = controls.get(id);
      if (!control || control.revision !== expectedRevision) return "stale";
      if (control.hostTrusted) throw new Error("host-trusted extensions cannot be uninstalled");
      controls.delete(id); data.delete(id); receipts.delete(id); logs.delete(id);
      for (const key of usage.keys()) if (key.startsWith(`${id}\0`)) usage.delete(key);
      for (const [key, reservation] of reservations) if (reservation.packageId === id) reservations.delete(key);
      if (![...controls.values()].some((item) => item.packageDigest === control.packageDigest)) packages.delete(control.packageDigest);
      requireFence(fence);
      return "saved";
    },
    async readData(packageId, key) { return structuredClone(data.get(checkExtensionId(packageId))?.get(checkExtensionKey(key)) ?? null); },
    async listDataKeys(packageId, limit) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LIST) throw new Error("invalid extension data list limit");
      return [...(data.get(checkExtensionId(packageId))?.keys() ?? [])].sort().slice(0, limit);
    },
    async compareAndSaveData(packageId, key, input, expectedRevision, fence) {
      const id = checkExtensionId(packageId); const name = checkExtensionKey(key); const value = checkedValue(input);
      requireWriteFence(fence, id);
      const bucket = data.get(id) ?? new Map<string, StoredExtensionData>(); const current = bucket.get(name);
      if ((current?.revision ?? -1) !== expectedRevision) return "stale";
      if (!current && bucket.size >= MAX_EXTENSION_DATA_KEYS) throw new Error("extension data key limit reached");
      const totalBytes = [...bucket.entries()].reduce((sum, [otherKey, stored]) => sum + (otherKey === name ? 0 : new TextEncoder().encode(JSON.stringify(stored.value)).byteLength), 0);
      const valueBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (valueBytes > MAX_EXTENSION_DATA_BYTES || totalBytes + valueBytes > MAX_EXTENSION_DATA_TOTAL_BYTES) throw new Error("extension data storage limit reached");
      bucket.set(name, { value, revision: expectedRevision + 1 }); data.set(id, bucket); return "saved";
    },
    async deleteData(packageId, key, expectedRevision, fence) {
      const id = checkExtensionId(packageId); const name = checkExtensionKey(key); const bucket = data.get(id); const current = bucket?.get(name);
      requireWriteFence(fence, id);
      if ((current?.revision ?? -1) !== expectedRevision) return "stale";
      bucket?.delete(name); return "saved";
    },
    async reserveBudget(input, limits, fence) {
      requireFence(fence);
      const packageId = checkExtensionId(input.packageId);
      if (!isOperationId(input.operation) || !Number.isSafeInteger(input.grantRevision) || input.grantRevision < 0
        || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || !Number.isSafeInteger(input.tokens) || input.tokens < 0) throw new Error("invalid extension budget reservation");
      for (const amount of Object.values(limits)) if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid extension budget limit");
      const key = `${packageId}\0${input.operation}\0${input.grantRevision}`;
      const bucket = usage.get(key) ?? { requests: 0, bytes: 0, tokens: 0, reservedBytes: 0, reservedTokens: 0, limits: structuredClone(limits) };
      const reservationKey = `${packageId}\0${input.id}`;
      const pending = [...reservations.values()].filter((item) => item.packageId === packageId).length;
      if (reservations.has(reservationKey) || pending >= MAX_EXTENSION_BUDGET_RESERVATIONS || bucket.requests + 1 > limits.requests || bucket.bytes + bucket.reservedBytes + input.bytes > limits.bytes || bucket.tokens + bucket.reservedTokens + input.tokens > limits.tokens) return false;
      bucket.requests++; bucket.reservedBytes += input.bytes; bucket.reservedTokens += input.tokens;
      usage.set(key, bucket); reservations.set(reservationKey, { ...input, packageId }); return true;
    },
    async settleBudget(packageId, reservationId, bytes, tokens, fence) {
      requireFence(fence);
      const id = checkExtensionId(packageId); const reservationKey = `${id}\0${reservationId}`; const reservation = reservations.get(reservationKey);
      if (!reservation) return false;
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > reservation.bytes || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > reservation.tokens) throw new Error("actual extension usage exceeds its reservation");
      const key = `${id}\0${reservation.operation}\0${reservation.grantRevision}`; const bucket = usage.get(key)!;
      bucket.bytes += bytes; bucket.tokens += tokens; bucket.reservedBytes -= reservation.bytes; bucket.reservedTokens -= reservation.tokens;
      reservations.delete(reservationKey); return true;
    },
    async finalizeAbandonedBudget(packageId, fence) {
      requireFence(fence);
      const id = checkExtensionId(packageId); let settled = 0;
      for (const [reservationKey, reservation] of reservations) {
        if (reservation.packageId !== id) continue;
        const key = `${id}\0${reservation.operation}\0${reservation.grantRevision}`; const bucket = usage.get(key)!;
        bucket.bytes += reservation.bytes; bucket.tokens += reservation.tokens;
        bucket.reservedBytes -= reservation.bytes; bucket.reservedTokens -= reservation.tokens;
        reservations.delete(reservationKey); settled++;
      }
      return settled;
    },
    async appendReceipt(input, fence) {
      requireFence(fence);
      const receipt = checkedReceipt(input); const list = receipts.get(receipt.packageId) ?? [];
      const index = list.findIndex((item) => item.id === receipt.id);
      const update = receiptUpdate(index >= 0 ? list[index]! : null, receipt);
      if (update === "update") list[index] = receipt;
      else if (update === "same") return;
      else { list.push(receipt); if (list.length > MAX_EXTENSION_RECEIPTS) list.splice(0, list.length - MAX_EXTENSION_RECEIPTS); }
      receipts.set(receipt.packageId, list);
    },
    async listReceipts(packageId, after, limit) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LIST) throw new Error("invalid extension receipt list limit");
      const list = receipts.get(checkExtensionId(packageId)) ?? []; const start = after ? Math.max(0, list.findIndex((receipt) => receipt.id === after) + 1) : 0;
      return structuredClone(list.slice(start, start + limit));
    },
    async appendLog(packageId, input, fence) {
      const id = checkExtensionId(packageId); requireWriteFence(fence, id);
      if (!("packageId" in fence) || fence.operation !== "logs.write") throw new Error("extension log authority is invalid");
      const log = checkedExtensionLog(input); const list = logs.get(id) ?? [];
      if (list.some((row) => row.id === log.id)) throw new Error("extension log ID was reused");
      list.push(log); if (list.length > MAX_EXTENSION_LOGS) list.splice(0, list.length - MAX_EXTENSION_LOGS);
      logs.set(id, list);
    },
    async listLogs(packageId, after, limit) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_EXTENSION_LOG_PAGE_SIZE) throw new Error("invalid extension log list limit");
      const list = logs.get(checkExtensionId(packageId)) ?? [];
      const cursorIndex = after ? list.findIndex((row) => row.id === after) : -1;
      if (after && cursorIndex < 0) throw new Error("extension log cursor is stale");
      const start = cursorIndex + 1;
      const records = structuredClone(list.slice(start, start + limit));
      const nextCursor = start + records.length < list.length && records.length ? records.at(-1)!.id : null;
      return { records, nextCursor };
    },
  };
  return { ...result, assertCommitContext };
}
