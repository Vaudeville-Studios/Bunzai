/** Prompt formats stay inert while extensions preview a strict canonical update. */
import { expect, test } from "bun:test";
import { CANONICAL_SCHEMA_VERSION } from "../../../core/canonical";
import type { CanonicalPromptFormat } from "../schema";
import capability from "./templates";

test("prompt-format updates preserve source escrow and never evaluate template syntax", () => {
  const entity: CanonicalPromptFormat = { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "promptformat", id: "st", body: { name: "ST", instruct: { input_sequence: "{{user}}" }, notes: "keep" }, original: { source: { raw: { keep: true } } } };
  const result = capability.preview(entity, capability.input.parse({ target: { id: "st" }, patch: { context: { story_string: "{{char}}" } } }));
  expect(result.entity.body).toEqual({ ...entity.body, context: { story_string: "{{char}}" } });
  expect(result.entity.original).toEqual(entity.original);
  expect(result.changes).toEqual([{ path: "body.context", label: "Context template", before: null, after: { story_string: "{{char}}" } }]);
});

test("prompt-format patches reject non-scalar template values and empty changes", () => {
  expect(() => capability.input.parse({ target: { id: "st" }, patch: { instruct: { input_sequence: { nested: true } } } })).toThrow();
  expect(() => capability.input.parse({ target: { id: "st" }, patch: {} })).toThrow();
});
