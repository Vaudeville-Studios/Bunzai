/** Persisted, host-controlled authority and runtime identity contracts. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../core/sha256";
import type { EffectClass } from "./operation";
import { EXTENSION_HTTP_METHODS, isHostConnection, isPublicHttpsOrigin } from "./destination";
import { operationIdSchema } from "./operation-id";

const destinationSchema = z.string().min(1).max(260).refine((value) => isPublicHttpsOrigin(value) || isHostConnection(value));

export const extensionGrantSchema = z.object({
  operation: operationIdSchema,
  resources: z.array(z.object({ kind: z.string().min(1).max(80), id: z.string().min(1).max(160) }).strict()).max(256),
  fields: z.array(z.string().min(1).max(120)).max(128),
  methods: z.array(z.enum(EXTENSION_HTTP_METHODS)).max(EXTENSION_HTTP_METHODS.length),
  destinations: z.array(destinationSchema).max(64),
  duration: z.enum(["session", "persistent"]),
  budget: z.object({ requests: z.number().int().nonnegative().max(100_000), bytes: z.number().int().nonnegative().max(1_073_741_824), tokens: z.number().int().nonnegative().max(10_000_000) }).strict(),
}).strict();

export const extensionGrantSetSchema = z.object({
  packageId: z.string().min(1).max(120),
  packageDigest: z.string().regex(SHA256_HEX_PATTERN),
  policyFingerprint: z.string().regex(SHA256_HEX_PATTERN),
  revision: z.number().int().nonnegative(),
  grants: z.array(extensionGrantSchema).max(256),
}).strict();

export const extensionPrincipalSchema = z.object({
  storeId: z.string().min(1).max(160),
  packageId: z.string().min(1).max(120),
  packageDigest: z.string().regex(SHA256_HEX_PATTERN),
  apiMajor: z.number().int().positive(),
  policyFingerprint: z.string().regex(SHA256_HEX_PATTERN),
  grantRevision: z.number().int().nonnegative(),
  runEpoch: z.number().int().positive(),
}).strict();

export const effectReceiptSchema = z.object({
  id: z.string().min(1).max(100),
  packageId: z.string().min(1).max(120),
  operation: operationIdSchema,
  effect: z.enum(["read", "write", "external", "control"]),
  status: z.enum(["admitted", "committed", "completed", "conflicted", "denied", "cancelled", "ambiguous"]),
  createdAt: z.number().int().nonnegative(),
  resourceCount: z.number().int().nonnegative().max(256),
}).strict();
export type EffectReceipt = z.infer<typeof effectReceiptSchema>;

export type ExtensionGrant = z.infer<typeof extensionGrantSchema>;
export type ExtensionGrantSet = z.infer<typeof extensionGrantSetSchema>;
