/** Keeps operation ID grammar shared across guest protocol and durable budget keys. */
import { expect, test } from "bun:test";
import { isOperationId, operationIdSchema } from "./operation-id";

test("operation IDs accept reviewed mixed-case names and reject malformed segments", () => {
  expect(operationIdSchema.parse("logs.readOwn")).toBe("logs.readOwn");
  expect(isOperationId("content.draft.character.identity.update")).toBe(true);
  for (const value of ["Logs.readOwn", "logs.ReadOwn", "logs.read_own", "logs..read", "logs", " logs.read", "logs.read."]) {
    expect(isOperationId(value)).toBe(false);
  }
});
