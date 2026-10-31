/** Digest-bound, expiring review challenges for package install and grant changes. */
import { decodeExtensionPackageInput } from "../contracts/package-validation";
import type { ExtensionPackageInput } from "../contracts/package";
import type { ExtensionOperationDescriptor, HostFeature } from "../contracts/operation";
import type { ExtensionStore, StoredExtensionControl } from "../../stage/contracts/extension-store";
import type { ExtensionPackagePreview } from "./service-api";
import { ExtensionServiceError, serviceError } from "./service-errors";
import { isRecord } from "../../core/guards";
import type { ExtensionRuntimeFence } from "../../stage/contracts/extension-store";

export interface ExtensionPackageChallenge {
  storeId: string;
  packageId: string;
  expectedRevision: number;
  priorPolicy: string | null;
  digest: string;
  package: ExtensionPackageInput;
  hostTrusted: boolean;
  expiresAt: number;
}

export function createExtensionPackageReviews(input: {
  store: ExtensionStore;
  storeId: string;
  host: HostFeature;
  operations: ReadonlyMap<string, ExtensionOperationDescriptor>;
  builtinPackages: readonly ExtensionPackageInput[];
  now(): number;
  id(): string;
  requireFence(): Promise<ExtensionRuntimeFence>;
}) {
  const challenges = new Map<string, ExtensionPackageChallenge>();
  async function createPreview(pkg: ExtensionPackageInput, digest: string, prior: StoredExtensionControl | null, hostTrusted: boolean): Promise<ExtensionPackagePreview> {
    const unsupported = pkg.manifest.requirements.filter((requirement) => {
      const operation = input.operations.get(requirement.operation);
      return !operation || !operation.hosts.includes(input.host);
    }).map((requirement) => requirement.operation);
    if (pkg.manifest.requirements.some((requirement) => requirement.required && unsupported.includes(requirement.operation))) serviceError("UNSUPPORTED_HOST", "Package requires operations unsupported on this host.");
    const expectedRevision = prior?.revision ?? -1;
    const now = input.now();
    for (const [key, item] of challenges) if (item.expiresAt <= now) challenges.delete(key);
    if (challenges.size >= 4) serviceError("LIMIT_EXCEEDED", "Too many pending extension reviews; finish or reopen a review.");
    const challenge = input.id();
    if (challenges.has(challenge)) throw new Error("duplicate review challenge id");
    const expiresAt = now + 120_000;
    challenges.set(challenge, { storeId: input.storeId, packageId: pkg.manifest.id, expectedRevision, priorPolicy: prior?.policyFingerprint ?? null, digest, package: structuredClone(pkg), hostTrusted, expiresAt });
    if (new TextEncoder().encode(JSON.stringify([...challenges.values()].map((item) => item.package))).byteLength > 16_000_000) {
      challenges.delete(challenge);
      throw new Error("pending review storage limit reached");
    }
    return { challenge, expiresAt, expectedRevision, digest, package: structuredClone(pkg), requestedOperations: pkg.manifest.requirements.map((item) => item.operation), unsupported };
  }
  async function preview(raw: unknown): Promise<ExtensionPackagePreview> {
    await input.requireFence();
    const candidate = isRecord(raw) ? raw : null;
    const source = candidate && Object.hasOwn(candidate, "schemaVersion") && candidate.package !== undefined ? candidate.package : raw;
    const manifest = isRecord(source) ? source.manifest : null;
    const sourceId = isRecord(manifest) ? manifest.id : null;
    if (typeof sourceId === "string" && sourceId.startsWith("bunzai.host.theme.")) serviceError("PERMISSION_DENIED", "Built-in appearance package IDs are reserved by the host.");
    const inspected = await decodeExtensionPackageInput(raw).catch(() => null);
    if (!inspected) return serviceError("INVALID_REQUEST", "The package failed validation.");
    if (inspected.package.manifest.id.startsWith("bunzai.host.theme.") || input.builtinPackages.some((pkg) => pkg.manifest.id === inspected.package.manifest.id)) {
      serviceError("PERMISSION_DENIED", "Built-in appearance package IDs are reserved by the host.");
    }
    return createPreview(inspected.package, inspected.digest, await input.store.readControl(inspected.package.manifest.id), false);
  }
  async function takeChallenge(challenge: string, expectedRevision: number): Promise<ExtensionPackageChallenge> {
    const item = challenges.get(challenge);
    challenges.delete(challenge);
    if (!item || item.storeId !== input.storeId || item.expiresAt <= input.now() || item.expectedRevision !== expectedRevision) {
      throw new ExtensionServiceError("PACKAGE_CHANGED", "Review expired or extension state changed; inspect it again.");
    }
    return item;
  }
  return { preview, createPreview, takeChallenge, challenges };
}
