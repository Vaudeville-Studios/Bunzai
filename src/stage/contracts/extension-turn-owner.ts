/** Strict persisted identity for extension state staged on one turn checkpoint. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../core/sha256";

export const extensionTurnOwnerSchema = z.strictObject({
  owner: z.string().min(1).max(120),
  epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  packageId: z.string().min(1).max(120),
  packageDigest: z.string().regex(SHA256_HEX_PATTERN),
  policyFingerprint: z.string().regex(SHA256_HEX_PATTERN),
  grantRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type ExtensionTurnOwner = z.infer<typeof extensionTurnOwnerSchema>;
