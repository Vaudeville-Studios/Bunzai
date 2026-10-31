/** Default lifecycle metadata for deferred, canonical-only content capabilities. */
import type { ParsedCanonicalEntity } from "../runtime-schema";
import type { CapabilityTargetInput, ContentCapability } from "../capabilities";

type CapabilitySpec<Input extends { target: CapabilityTargetInput }, Entity extends ParsedCanonicalEntity> =
  Pick<ContentCapability<Input, Entity>, "id" | "kind" | "area" | "action" | "summary" | "aliases" | "input" | "preview">
  & Partial<Pick<ContentCapability<Input, Entity>, "concurrencyKey" | "extensionExposure">>;

export function defineContentCapability<
  Input extends { target: CapabilityTargetInput },
  Entity extends ParsedCanonicalEntity,
>(spec: CapabilitySpec<Input, Entity>): ContentCapability<Input, Entity> {
  return {
    ...spec,
    platforms: "canonical",
    exposure: "deferred",
    effect: "draft",
    concurrencyKey: spec.concurrencyKey ?? ((input) => `${spec.kind}/${input.target.id}`),
  };
}
