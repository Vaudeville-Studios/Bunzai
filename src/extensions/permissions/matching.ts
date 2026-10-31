/** Pure exact-scope matching for approved extension grants. */
import type { ExtensionGrant } from "../contracts/grants";
import type { ExtensionOperationDescriptor, OperationPrincipal, ResolvedOperationAccess, ResourceRef } from "../contracts/operation";
import { isPolicyDestination } from "../contracts/destination";

const same = (left: readonly string[], right: readonly string[]): boolean => right.every((value) => left.includes(value));
const sameResource = (a: ResourceRef, b: ResourceRef): boolean => a.kind === b.kind && a.id === b.id;
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const uniqueResources = (values: readonly ResourceRef[]): boolean => values.every((value, index) => values.findIndex((candidate) => sameResource(value, candidate)) === index);

export function grantAllows(
  grant: ExtensionGrant,
  operation: ExtensionOperationDescriptor,
  access: { resources: readonly ResourceRef[]; fields: readonly string[]; methods: readonly string[]; destinations: readonly string[] },
  principal: OperationPrincipal,
): boolean {
  if (grant.operation !== operation.id) return false;
  if (principal.packageId.length === 0 || principal.packageDigest.length !== 64) return false;
  return withinScope(grant, operation, access)
    && grant.budget.requests > 0;
}

const withinScope = (grant: ExtensionGrant, operation: ExtensionOperationDescriptor, access: ResolvedOperationAccess): boolean =>
  uniqueResources(access.resources) && unique(access.fields) && unique(access.methods) && unique(access.destinations)
    && access.resources.every((resource) => operation.policy.resources.includes(resource.kind)
      && grant.resources.some((allowed) => sameResource(resource, allowed)))
    && same(operation.policy.fields, access.fields) && same(grant.fields, access.fields)
    && same(operation.policy.methods, access.methods) && same(grant.methods, access.methods)
    && access.destinations.every((destination) => isPolicyDestination(operation.policy.destinationMode, destination, operation.policy.destinations))
    && (operation.policy.destinationMode === "fixed-origins" ? same(operation.policy.destinations, access.destinations) : true)
    && same(grant.destinations, access.destinations);

/** Resolve only the exact approved target set; explicit unauthorized targets deny the entire operation. */
export function resolveGrantedAccess(
  grant: ExtensionGrant,
  operation: ExtensionOperationDescriptor,
  requested: { resources: readonly ResourceRef[]; fields: readonly string[]; methods: readonly string[]; destinations: readonly string[] },
  selectedScope: readonly ResourceRef[],
): ResolvedOperationAccess | null {
  if (grant.operation !== operation.id) return null;
  const resources = requested.resources.length || operation.policy.resources.length === 0 ? requested.resources : selectedScope;
  if (operation.policy.resources.length > 0 && resources.length === 0) return null;
  const result = { resources, fields: requested.fields, methods: requested.methods, destinations: requested.destinations };
  return withinScope(grant, operation, result) ? result : null;
}

export function policyWidened(previous: ExtensionOperationDescriptor["policy"], current: ExtensionOperationDescriptor["policy"]): boolean {
  return !same(previous.resources, current.resources)
    || !same(previous.fields, current.fields)
    || !same(previous.methods, current.methods)
    || previous.destinationMode !== current.destinationMode
    || !same(previous.destinations, current.destinations)
    || previous.budget !== current.budget
    || previous.confirmation !== current.confirmation;
}
