/** Checks an admitted package commit inside the same SQLite transaction as its domain mutation. */
import type { CellCipher } from "../../crypto/cell-cipher";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { checkedControl, checkedFence, checkExtensionId } from "../extension-store-rules";
import type { StageDatabase } from "./database";
import { requireCommitAccessWithinGrant } from "../extension-commit-access";

export function requireExtensionCommit(database: StageDatabase, cipher: CellCipher, context: ExtensionCommitContext, expectedPackageId = context.packageId): void {
  if (context.signal?.aborted) throw new Error("extension invocation was cancelled before commit");
  const fence = checkedFence(context);
  const now = context.now();
  if (!Number.isSafeInteger(now)) throw new Error("invalid extension commit clock");
  const lease = database.statement("SELECT epoch, owner_cell, expires_at, last_now FROM extension_runtime_lease WHERE singleton = 1").get() as
    { epoch: number; owner_cell: string | null; expires_at: number; last_now: number } | null;
  if (!lease?.owner_cell || lease.epoch !== fence.epoch || cipher.open("extension_runtime_lease.owner_cell", lease.owner_cell) !== fence.owner
    || now < lease.last_now || now >= lease.expires_at) throw new Error("extension runtime fence is stale at commit");
  const packageId = checkExtensionId(expectedPackageId);
  if (context.packageId !== packageId || !context.operation) throw new Error("extension commit identity mismatch");
  const row = database.statement("SELECT id_hash, body_cell FROM extension_controls WHERE id_hash = ?").get(cipher.index(packageId)) as { id_hash: string; body_cell: string } | null;
  if (!row) throw new Error("extension is not installed at commit");
  const control = checkedControl(JSON.parse(cipher.open("extension_controls.body_cell", row.body_cell)) as unknown);
  const grant = control.grants.find((item) => item.operation === context.operation);
  if (row.id_hash !== cipher.index(control.id) || control.id !== packageId || !control.enabled || control.recoveryRequired
    || control.packageDigest !== context.packageDigest || control.policyFingerprint !== context.policyFingerprint
    || control.grantRevision !== context.grantRevision || !grant) {
    throw new Error("extension authority changed before commit");
  }
  requireCommitAccessWithinGrant(context, grant);
}
