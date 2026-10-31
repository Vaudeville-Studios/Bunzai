/** Validates package grants and derives the single persisted policy fingerprint. */
import type { ExtensionGrant } from "../contracts/grants";
import { EXTENSION_BUDGET_PRESETS, type ExtensionOperationDescriptor, type HostFeature } from "../contracts/operation";
import type { ExtensionPackageInput } from "../contracts/package";
import { isPolicyDestination } from "../contracts/destination";
import { operationPolicyFingerprint } from "../permissions/fingerprint";
import { digestJson } from "../contracts/value";
import { THEME_BASE_SCOPES, THEME_SCOPES, type ThemeScope } from "../theme-appearance";
import { serviceError } from "./service-errors";

export function createExtensionPackagePolicy(host: HostFeature, operations: ReadonlyMap<string, ExtensionOperationDescriptor>) {
  return {
    async fingerprint(grants: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[]): Promise<string> {
      const fingerprints = await Promise.all(grants.map(async (grant) => {
        const operation = operations.get(grant.operation);
        if (!operation) return serviceError("UNSUPPORTED_HOST", "The granted operation is unavailable on this host.");
        if (!operation.hosts.includes(host)) serviceError("UNSUPPORTED_HOST", "The granted operation is unavailable on this host.");
        if (!grant.resources.every((resource) => operation.policy.resources.includes(resource.kind))
          || !grant.fields.every((field) => operation.policy.fields.includes(field))
          || !grant.methods.every((method) => operation.policy.methods.includes(method))
          || !grant.destinations.every((destination) => isPolicyDestination(operation.policy.destinationMode, destination, operation.policy.destinations))) serviceError("PERMISSION_DENIED", "Grant scope exceeds the reviewed operation policy.");
        const ceiling = EXTENSION_BUDGET_PRESETS[operation.policy.budget];
        if (grant.budget.requests > ceiling.requests || grant.budget.bytes > ceiling.bytes || grant.budget.tokens > ceiling.tokens) serviceError("PERMISSION_DENIED", "Grant budget exceeds the host limit for this operation class.");
        return [grant.operation, await operationPolicyFingerprint(operation)];
      }));
      if (new Set(grants.map((grant) => grant.operation)).size !== grants.length) throw new Error("duplicate operation grant");
      return digestJson({ operations: fingerprints.sort(([a], [b]) => String(a).localeCompare(String(b))), themeScopes: [...themeScopes].sort() });
    },
    validateGrants(pkg: ExtensionPackageInput, grants: readonly ExtensionGrant[]): void {
      const requested = new Map(pkg.manifest.requirements.map((requirement) => [requirement.operation, requirement]));
      if (grants.some((grant) => {
        const requirement = requested.get(grant.operation);
        return !requirement || !grant.resources.every((resource) => requirement.resources.includes(resource.kind))
          || !grant.fields.every((field) => requirement.fields.includes(field))
          || !grant.methods.every((method) => requirement.methods.includes(method))
          || !grant.destinations.every((destination) => requirement.destinations.includes(destination));
      })) serviceError("PERMISSION_DENIED", "Grant scope exceeds the package request.");
      const granted = new Set(grants.map((grant) => grant.operation));
      if (pkg.manifest.requirements.some((requirement) => requirement.required && !granted.has(requirement.operation))) serviceError("DECLINED", "Required operation access was not approved.");
    },
    validateThemeScopes(pkg: ExtensionPackageInput, scopes: readonly ThemeScope[]): void {
      const requested = pkg.manifest.theme?.requests ?? [];
      if (scopes.some((scope) => !THEME_SCOPES.includes(scope) || !requested.includes(scope)) || new Set(scopes).size !== scopes.length) serviceError("PERMISSION_DENIED", "Appearance scopes exceed the package request.");
      if (pkg.manifest.theme && THEME_BASE_SCOPES.some((scope) => !scopes.includes(scope))) serviceError("DECLINED", "Appearance themes require approval for their base palette, type, shape, surfaces and accent.");
      const theme = pkg.manifest.theme;
      if (theme && scopes.includes("appearance.styles") && !scopes.includes("appearance.fonts") && theme.fonts?.length) serviceError("PERMISSION_DENIED", "Appearance styles require approval for the package fonts they may reference.");
      if (theme && scopes.includes("appearance.styles") && !scopes.includes("appearance.assets") && theme.assets.length) serviceError("PERMISSION_DENIED", "Appearance styles require approval for the package assets they may reference.");
      if (theme && scopes.includes("ui.slots") && !scopes.includes("appearance.assets") && theme.slots && JSON.stringify(theme.slots).includes('"kind":"image"')) serviceError("PERMISSION_DENIED", "Image slots require approval for appearance assets.");
      if (theme && scopes.includes("ui.slots") && !scopes.includes("appearance.styles") && theme.slots && JSON.stringify(theme.slots).includes('"class"')) serviceError("PERMISSION_DENIED", "Styled slots require approval for appearance styles.");
    },
  };
}
