/**
 * Pure semantic capability contracts shared by Kit, the Workbench, and future engine consumers.
 * Capabilities preview canonical changes; they never perform I/O.
 */
import type { z } from "zod";
import type { canonicalEntitySchema, ParsedCanonicalEntity } from "../runtime-schema";

/** Strict extension projection approved by a capability owner; absence keeps it internal. */
export const CONTENT_DRAFT_HOSTS = ["desktop", "browser", "terminal"] as const;
export interface CapabilityExtensionExposure {
  operationId: string;
  fields: readonly { input: string; path: string }[];
  hosts: readonly (typeof CONTENT_DRAFT_HOSTS)[number][];
  budget: "write";
  confirmation: "effect";
}

export type ContentKind = z.infer<typeof canonicalEntitySchema>["kind"];
export type CapabilityEffect = "read" | "draft";
export type CapabilityExposure = "direct" | "deferred" | "hidden";

export interface CapabilityTargetInput {
  id: string;
}

export interface CapabilityChange {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface CapabilityPlatformImpact {
  platform: string;
  disposition: "carried" | "changed" | "not-representable";
  detail: string;
}

export interface CapabilityPreview<Entity extends ParsedCanonicalEntity = ParsedCanonicalEntity> {
  entity: Entity;
  changes: readonly CapabilityChange[];
  warnings: readonly string[];
  platformImpact: readonly CapabilityPlatformImpact[];
  /** Read-effect capabilities may return deterministic structured analysis here. */
  observation?: unknown;
}

export interface ContentCapability<
  Input = unknown,
  Entity extends ParsedCanonicalEntity = ParsedCanonicalEntity,
> {
  id: `${ContentKind}.${string}`;
  kind: ContentKind;
  area: string;
  action: string;
  summary: string;
  aliases: readonly string[];
  platforms: readonly string[] | "canonical";
  exposure: CapabilityExposure;
  effect: CapabilityEffect;
  /** Absent by default; only reviewed source owners opt into extension adapters. */
  extensionExposure?: CapabilityExtensionExposure;
  input: z.ZodType<Input>;
  concurrencyKey(input: Input): string;
  preview(entity: Entity, input: Input): CapabilityPreview<Entity>;
}
