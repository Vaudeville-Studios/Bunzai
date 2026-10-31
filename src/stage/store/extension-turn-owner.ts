/** Opens and strictly validates the encrypted extension identity bound to an in-flight turn. */
import { DamagedDataError } from "../damaged-data-error";
import type { CellCipher } from "../crypto/cell-cipher";
import { extensionTurnOwnerSchema, type ExtensionTurnOwner } from "../contracts/extension-turn-owner";
import type { ExtensionCommitContext } from "../contracts/extension-store";

export function extensionTurnOwnerOf(context: ExtensionCommitContext): ExtensionTurnOwner {
  return { owner: context.owner, epoch: context.epoch, packageId: context.packageId, packageDigest: context.packageDigest, policyFingerprint: context.policyFingerprint, grantRevision: context.grantRevision };
}

export function sameExtensionTurnOwner(left: ExtensionTurnOwner | undefined, right: ExtensionCommitContext): boolean {
  return !!left && left.owner === right.owner && left.epoch === right.epoch && left.packageId === right.packageId
    && left.packageDigest === right.packageDigest && left.policyFingerprint === right.policyFingerprint && left.grantRevision === right.grantRevision;
}

export function openExtensionTurnOwner(cipher: CellCipher, cell: string): ExtensionTurnOwner {
  const where = "turn_checkpoints.extension_owner_json";
  const text = cipher.open(where, cell);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new DamagedDataError(where, "the owner binding is not valid JSON"); }
  const result = extensionTurnOwnerSchema.safeParse(value);
  if (!result.success) throw new DamagedDataError(where, "the owner binding has an invalid shape");
  return result.data;
}
