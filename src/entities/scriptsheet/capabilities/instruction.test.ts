/** Script Sheet instruction edits are inert semantic drafts. */
import { expect, test } from "bun:test";
import type { CanonicalScriptSheet } from "../schema";
import capability from "./instruction";

test("replaces only the selected Script Sheet instruction", () => {
  const entity = { schemaVersion: "1", kind: "scriptsheet", id: "sheet", body: { name: "Sheet", content: "Old", description: "Keep" }, original: { rolecall: { raw: { keep: true } } } } as CanonicalScriptSheet;
  const result = capability.preview(entity, capability.input.parse({ target: { id: "sheet" }, content: "New" }));
  expect(result.entity.body).toEqual({ ...entity.body, content: "New" });
  expect(result.entity.original).toEqual(entity.original);
  expect(result.changes).toEqual([{ path: "body.content", label: "Script Sheet instruction", before: "Old", after: "New" }]);
});
