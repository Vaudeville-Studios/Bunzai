/** Verify kind discovery stays mechanically aligned with the canonical Studio kind inventory. */
import { expect, test } from "bun:test";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { contentKindOperations } from "./kinds";

test("content.kinds returns the canonical Studio kind inventory", async () => {
  const operation = contentKindOperations[0]!;
  const result = await operation.execute({}, {} as never, {} as never);
  expect(result).toEqual({ kinds: [...STUDIO_ENTITY_KINDS] });
  expect(operation.metadata.output.parse(result)).toEqual(result);
});
