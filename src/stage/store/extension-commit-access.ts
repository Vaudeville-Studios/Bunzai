/** Validates a broker-resolved access snapshot at native mutation doors. */
import type { ExtensionCommitAccess, ExtensionCommitContext } from "../contracts/extension-store";

const unique = <T>(values: readonly T[], key: (value: T) => string): boolean => new Set(values.map(key)).size === values.length;
const resourceKey = (resource: { kind: string; id: string }): string => `${resource.kind}\0${resource.id}`;

export function requireCommitAccessWithinGrant(context: ExtensionCommitContext, grant: {
  resources: readonly { kind: string; id: string }[];
  fields: readonly string[];
  methods: readonly string[];
  destinations: readonly string[];
}): ExtensionCommitAccess {
  if (context.signal?.aborted) throw new Error("extension invocation was cancelled before commit");
  const access = context.access;
  if (!access || !Array.isArray(access.resources) || !Array.isArray(access.fields)
    || !Array.isArray(access.methods) || !Array.isArray(access.destinations)
    || !unique(access.resources, resourceKey) || !unique(access.fields, (value) => value)
    || !unique(access.methods, (value) => value) || !unique(access.destinations, (value) => value)
    || access.resources.some((item) => !item || typeof item.kind !== "string" || typeof item.id !== "string"
      || !grant.resources.some((allowed) => allowed.kind === item.kind && allowed.id === item.id))
    || access.fields.some((field) => !grant.fields.includes(field))
    || access.methods.some((method) => !grant.methods.includes(method))
    || access.destinations.some((destination) => !grant.destinations.includes(destination))) {
    throw new Error("extension commit access is missing or exceeds the live grant");
  }
  return access;
}

export function requireCommitResource(context: ExtensionCommitContext, resource: { kind: string; id: string }, fields: readonly string[] = []): void {
  if (context.signal?.aborted) throw new Error("extension invocation was cancelled before commit");
  const access = context.access;
  if (!access || !access.resources.some((item) => item.kind === resource.kind && item.id === resource.id)
    || fields.some((field) => !access.fields.includes(field))) {
    throw new Error("extension commit is outside its broker-resolved resource or field scope");
  }
}

/** Copies and freezes the exact access snapshot retained by a tracked background job. */
export function snapshotExtensionCommit(context: ExtensionCommitContext): ExtensionCommitContext {
  return {
    ...context,
    access: Object.freeze({
      resources: Object.freeze(context.access.resources.map((resource) => Object.freeze({ ...resource }))),
      fields: Object.freeze([...context.access.fields]),
      methods: Object.freeze([...context.access.methods]),
      destinations: Object.freeze([...context.access.destinations]),
    }),
  };
}
