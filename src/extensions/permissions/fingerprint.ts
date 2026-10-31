/** Stable policy fingerprints bind grants to the effective reviewed descriptor. */
import type { ExtensionOperationDescriptor } from "../contracts/operation";
import { canonicalJsonBytes } from "../contracts/value";
import { canonicalSchemaJson, operationSchemaJson } from "../contracts/operation-metadata";
import { sha256HexBytes } from "../../core/sha256";

export async function operationPolicyFingerprint(operation: Pick<ExtensionOperationDescriptor, "id" | "version" | "inputVersion" | "outputVersion" | "projectionVersion" | "input" | "output" | "effect" | "sensitivity" | "hosts" | "activationOrigins" | "policy">): Promise<string> {
  const bytes = canonicalJsonBytes({ id: operation.id, version: operation.version, inputVersion: operation.inputVersion, outputVersion: operation.outputVersion, projectionVersion: operation.projectionVersion,
    inputSchema: canonicalSchemaJson(operationSchemaJson(operation.input)), outputSchema: canonicalSchemaJson(operationSchemaJson(operation.output)),
    effect: operation.effect, sensitivity: operation.sensitivity, hosts: [...operation.hosts].sort(), activationOrigins: operation.activationOrigins ?? null, policy: operation.policy });
  return sha256HexBytes(bytes);
}
