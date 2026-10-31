/** Promptbook edits remain canonical data until an explicitly applied draft is confirmed. */
import { expect, test } from "bun:test";
import { emptyPromptbookBody } from "../../../core/promptbook";
import type { CanonicalPromptbook } from "../schema";
import capability from "./phase-preset";

test("updates one phase block and leaves the source recipe untouched", () => {
  const entity = { schemaVersion: "1", kind: "promptbook", id: "book", body: emptyPromptbookBody("Book") } as CanonicalPromptbook;
  const blockId = entity.body.phases[0]!.preset.prompts[0]!.id;
  const result = capability.preview(entity, capability.input.parse({ target: { id: "book" }, phaseId: "write", blockId, content: "A revised instruction." }));
  expect(result.entity.body.phases[0]!.preset.prompts[0]!.content).toBe("A revised instruction.");
  expect(entity.body.phases[0]!.preset.prompts[0]!.content).toBe("Write the next part of the scene.");
  expect(result.changes).toEqual([{ path: "body.phases.prompt-content", label: "Write phase instruction", before: "Write the next part of the scene.", after: "A revised instruction." }]);
  expect(capability.extensionExposure?.fields).toEqual([{ input: "content", path: "body.phases.prompt-content" }]);
});

test("does not create a draft for an unknown phase or prompt block", () => {
  const entity = { schemaVersion: "1", kind: "promptbook", id: "book", body: emptyPromptbookBody("Book") } as CanonicalPromptbook;
  expect(() => capability.preview(entity, capability.input.parse({ target: { id: "book" }, phaseId: "missing", blockId: "block", content: "text" }))).toThrow("Promptbook phase is missing");
  expect(() => capability.preview(entity, capability.input.parse({ target: { id: "book" }, phaseId: "write", blockId: "missing", content: "text" }))).toThrow("Promptbook phase block is missing");
});
