/** Pure validation and lookup for trusted extension operation descriptors. */
import { z } from "zod";
import type {
  ExtensionActivationOrigin,
  ExtensionOperationDescriptor,
  ExtensionOperationPolicy,
  HostFeature,
} from "../contracts/operation";
import { EXTENSION_HTTP_METHODS, isPublicHttpsOrigin } from "../contracts/destination";
import { canonicalSchemaJson, MAX_OPERATION_PAGE_BYTES, operationSchemaJson } from "../contracts/operation-metadata";
import { operationIdSchema } from "../contracts/operation-id";
import { isRecord } from "../../core/guards";

export interface OperationMetadata {
  id: string;
  version: number;
  inputVersion: number;
  outputVersion: number;
  projectionVersion: number;
  title: string;
  description: string;
  effect: string;
  sensitivity: string;
  delegates?: readonly string[];
  activationOrigins?: readonly ExtensionActivationOrigin[];
  hosts: readonly HostFeature[];
  policy: ExtensionOperationPolicy;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface OperationCatalog {
  all(): readonly ExtensionOperationDescriptor[];
  get(id: string): ExtensionOperationDescriptor | undefined;
  metadata(): readonly OperationMetadata[];
}

export function estimateOperationBudget(
  operation: ExtensionOperationDescriptor,
  args: unknown,
): { bytes: number; tokens: number } {
  const estimate = operation.estimateBudget(operation.input.parse(args));
  if (!Number.isSafeInteger(estimate?.bytes) || estimate.bytes < 0
    || !Number.isSafeInteger(estimate?.tokens) || estimate.tokens < 0) {
    throw new Error(`${operation.id}: invalid budget estimate`);
  }
  return estimate;
}

const FEATURES = new Set<HostFeature>(["desktop", "browser", "terminal"]);
const EFFECTS = new Set(["read", "write", "external", "control"]);
const SENSITIVITIES = new Set(["public", "private", "secret"]);
const BUDGETS = new Set(["metadata", "read-small", "read-large", "write", "external"]);
const CONFIRMATIONS = new Set(["none", "effect", "sensitive-send"]);
const DESTINATION_POLICIES = new Set(["none", "approved-public-https", "host-selected-connection", "fixed-origins"]);
const HTTP_METHODS = new Set<string>(EXTENSION_HTTP_METHODS);
const ACTIVATION_ORIGINS = new Set<ExtensionActivationOrigin>(["command", "event", "prompt", "background", "host"]);
const nonEmptyUnique = (values: readonly string[]): boolean =>
  values.every((value) => typeof value === "string" && value.trim() !== "")
  && new Set(values).size === values.length;
const isZodSchema = (value: unknown): value is z.ZodType => isRecord(value)
  && "_zod" in value && typeof (value as { safeParse?: unknown }).safeParse === "function"
  && typeof (value as { meta?: unknown }).meta === "function";

function metadataOf(operation: ExtensionOperationDescriptor): OperationMetadata {
  return {
    id: operation.id,
    version: operation.version,
    inputVersion: operation.inputVersion,
    outputVersion: operation.outputVersion,
    projectionVersion: operation.projectionVersion,
    title: operation.title,
    description: operation.description,
    effect: operation.effect,
    sensitivity: operation.sensitivity,
    ...(operation.delegates ? { delegates: [...operation.delegates] } : {}),
    ...(operation.activationOrigins ? { activationOrigins: [...operation.activationOrigins] } : {}),
    hosts: [...operation.hosts],
    policy: {
      resources: [...operation.policy.resources],
      fields: [...operation.policy.fields],
      methods: [...operation.policy.methods],
      destinations: [...operation.policy.destinations],
      destinationMode: operation.policy.destinationMode,
      budget: operation.policy.budget,
      confirmation: operation.policy.confirmation,
    },
    input: operationSchemaJson(operation.input),
    output: operationSchemaJson(operation.output),
  };
}

function assertPublicMetadataBound(metadata: OperationMetadata): void {
  const { input, output, ...details } = metadata;
  const row = { ...details, inputSchema: canonicalSchemaJson(input), outputSchema: canonicalSchemaJson(output), granted: false };
  if (new TextEncoder().encode(JSON.stringify(row)).byteLength > MAX_OPERATION_PAGE_BYTES) {
    throw new Error(`${metadata.id}: public operation metadata exceeds the page byte limit`);
  }
}

function hasOpenObject(schema: z.ZodType, seen = new Set<object>()): boolean {
  if (typeof schema.meta === "function"
    && (schema.meta() as { extensionJsonValue?: unknown } | undefined)?.extensionJsonValue === true) return false;
  if (seen.has(schema)) return false;
  seen.add(schema);
  const def = schema._zod.def as { type?: string; shape?: Record<string, z.ZodType>; catchall?: z.ZodType };
  if (def.type === "object" && def.catchall?._zod.def.type !== "never") return true;
  return Object.values(def.shape ?? {}).some((child) => hasOpenObject(child, seen))
    || Object.values(def).some((value) => {
      if (isZodSchema(value)) return hasOpenObject(value, seen);
      if (Array.isArray(value)) return value.some((child) => isZodSchema(child) && hasOpenObject(child, seen));
      return false;
    });
}

/** Reject malformed or ambiguous descriptors before any runtime can expose them. */
export function createOperationCatalog(
  input: readonly ExtensionOperationDescriptor[],
): OperationCatalog {
  const ordered = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  const metadata = ordered.map((operation) => {
    if (!isRecord(operation) || !operationIdSchema.safeParse(operation.id).success) {
      throw new Error("invalid extension operation id");
    }
    if (ids.has(operation.id)) throw new Error(`duplicate extension operation id "${operation.id}"`);
    ids.add(operation.id);
    if (!Number.isSafeInteger(operation.version) || operation.version < 1) {
      throw new Error(`${operation.id}: version must be a positive integer`);
    }
    for (const key of ["inputVersion", "outputVersion", "projectionVersion"] as const) {
      if (!Number.isSafeInteger(operation[key]) || operation[key] < 1) {
        throw new Error(`${operation.id}: ${key} must be a positive integer`);
      }
    }
    for (const key of ["title", "description"] as const) {
      if (typeof operation[key] !== "string" || !operation[key].trim()) {
        throw new Error(`${operation.id}: ${key} must be non-empty`);
      }
    }
    if (!EFFECTS.has(operation.effect) || !SENSITIVITIES.has(operation.sensitivity)) {
      throw new Error(`${operation.id}: invalid effect or sensitivity`);
    }
    if (!Array.isArray(operation.hosts) || !nonEmptyUnique(operation.hosts)
      || operation.hosts.some((feature) => !FEATURES.has(feature))) {
      throw new Error(`${operation.id}: invalid host availability`);
    }
    const policy = operation.policy;
    if (!policy || !nonEmptyUnique(policy.resources) || !nonEmptyUnique(policy.fields) || !nonEmptyUnique(policy.methods)
      || !nonEmptyUnique(policy.destinations) || !BUDGETS.has(policy.budget)
      || !CONFIRMATIONS.has(policy.confirmation) || !DESTINATION_POLICIES.has(policy.destinationMode)) {
      throw new Error(`${operation.id}: invalid extension policy`);
    }
    if ((policy.destinationMode === "none" || policy.destinationMode === "approved-public-https" || policy.destinationMode === "host-selected-connection") && policy.destinations.length !== 0) {
      throw new Error(`${operation.id}: only fixed-origins may list destinations`);
    }
    if (policy.methods.some((method) => !HTTP_METHODS.has(method))
      || policy.destinationMode === "none" && policy.methods.length > 0) {
      throw new Error(`${operation.id}: invalid method policy for destination mode`);
    }
    if (policy.destinationMode === "fixed-origins" && (!policy.destinations.length || policy.destinations.some((origin) => !isPublicHttpsOrigin(origin)))) {
      throw new Error(`${operation.id}: fixed-origins requires exact public HTTPS origins`);
    }
    const hasDelegates = Array.isArray(operation.delegates) && nonEmptyUnique(operation.delegates)
      && operation.delegates.length > 0 && operation.delegates.length <= 16;
    if (operation.effect === "write" && policy.confirmation === "none" && !hasDelegates) {
      throw new Error(`${operation.id}: an unreviewed write must declare delegated operations`);
    }
    if (operation.delegates !== undefined && (!hasDelegates || operation.effect !== "write" || policy.confirmation !== "none")) {
      throw new Error(`${operation.id}: invalid delegated operation contract`);
    }
    if (operation.activationOrigins !== undefined && (!nonEmptyUnique(operation.activationOrigins)
      || operation.activationOrigins.some((origin) => !ACTIVATION_ORIGINS.has(origin)))) {
      throw new Error(`${operation.id}: invalid activation origin policy`);
    }
    const validPair = operation.effect === "read"
      ? ["metadata", "read-small", "read-large"].includes(policy.budget) && policy.confirmation === "none"
      : operation.effect === "control"
      ? policy.budget === "metadata" && (policy.confirmation === "none" || policy.confirmation === "effect")
      : operation.effect === "external"
      ? policy.budget === "external" && policy.confirmation === "sensitive-send"
      : policy.budget === "write" && (policy.confirmation === "effect" || hasDelegates);
    if (!validPair) throw new Error(`${operation.id}: effect does not match its budget and confirmation policy`);
    if (typeof operation.estimateBudget !== "function" || typeof operation.measureTokens !== "function") {
      throw new Error(`${operation.id}: missing budget accounting`);
    }
    if (typeof operation.input?.safeParse !== "function"
      || typeof operation.output?.safeParse !== "function"
      || typeof operation.resolveAccess !== "function"
      || typeof operation.project !== "function"
      || typeof operation.execute !== "function") {
      throw new Error(`${operation.id}: incomplete operation contract`);
    }
    const metadata = metadataOf(operation);
    assertPublicMetadataBound(metadata);
    if (hasOpenObject(operation.input) || hasOpenObject(operation.output)) {
      throw new Error(`${operation.id}: object schemas must reject unknown keys`);
    }
    const inputObject = metadata.input;
    const outputObject = metadata.output;
    if (inputObject.type === "object" && inputObject.additionalProperties !== false) {
      throw new Error(`${operation.id}: input object schema must reject unknown keys`);
    }
    if (outputObject.type === "object" && outputObject.additionalProperties !== false) {
      throw new Error(`${operation.id}: output object schema must reject unknown keys`);
    }
    return metadata;
  });
  const byId = new Map(ordered.map((operation) => [operation.id, operation]));
  for (const operation of ordered) {
    for (const childId of operation.delegates ?? []) {
      const child = byId.get(childId);
      if (!child || child === operation || child.effect !== "write" || child.policy.confirmation === "none"
        || operation.hosts.some((host) => !child.hosts.includes(host))) {
        throw new Error(`${operation.id}: delegated target must be a reviewed write available on every wrapper host`);
      }
    }
  }
  const visitDelegates = (id: string, path: readonly string[]): void => {
    if (path.includes(id)) throw new Error(`${id}: delegated operation cycle detected`);
    const operation = byId.get(id);
    if (!operation?.delegates?.length) return;
    if (path.length >= 4) throw new Error(`${id}: delegated operation depth exceeds the broker limit`);
    for (const childId of operation.delegates) visitDelegates(childId, [...path, id]);
  };
  for (const operation of ordered) visitDelegates(operation.id, []);
  return {
    all: () => ordered,
    get: (id) => ordered.find((operation) => operation.id === id),
    metadata: () => metadata,
  };
}
