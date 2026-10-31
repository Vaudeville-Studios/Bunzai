/** Tool definition edits keep the stored action data separate from invocation authority. */
import { expect, test } from "bun:test";
import type { CanonicalTool } from "../schema";
import capability from "./definition";

test("validates and previews one inert tool definition without changing escrow", () => {
  const entity = { schemaVersion: "1", kind: "tool", id: "dice-tool", body: { name: "Roll", description: "Roll dice", fields: [], action: { kind: "record" as const } }, original: { rolecall: { raw: { keep: true } } } } as CanonicalTool;
  const result = capability.preview(entity, capability.input.parse({ target: { id: "dice-tool" }, body: { name: "Roll check", description: "Record a check", fields: [], action: { kind: "record" } } }));
  expect(result.entity.body).toEqual({ name: "Roll check", description: "Record a check", fields: [], action: { kind: "record" } });
  expect(result.entity.original).toEqual(entity.original);
  expect(result.changes[0]?.path).toBe("body");
});

test("rejects tool bodies that fail the canonical action/field invariant", () => {
  const entity = { schemaVersion: "1", kind: "tool", id: "dice-tool", body: { name: "Roll", description: "", fields: [], action: { kind: "record" as const } } } as CanonicalTool;
  expect(() => capability.input.parse({ target: { id: "dice-tool" }, body: { name: "Roll", description: "", fields: [], action: { kind: "roll", field: "missing" } } })).toThrow();
  expect(() => capability.input.parse({ target: { id: "dice-tool" }, body: { name: "", description: "", fields: [], action: { kind: "record" } } })).toThrow();
});
