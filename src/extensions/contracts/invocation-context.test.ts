/** Purpose: keep host-selected invocation resources unique and bounded at the activation boundary. */
import { expect, test } from "bun:test";
import { extensionInvocationContextSchema, snapshotInvocationResources } from "./invocation-context";

test("accepts a copied bounded context and rejects duplicate, malformed, and oversized refs", () => {
  const source = [{ kind: "character", id: "vera" }];
  const context = snapshotInvocationResources(source);
  source[0]!.id = "changed";
  expect(context).toEqual([{ kind: "character", id: "vera" }]);
  expect(Object.isFrozen(context)).toBe(true);
  expect(Object.isFrozen(context[0])).toBe(true);
  expect(extensionInvocationContextSchema.safeParse({ resources: [{ kind: "character", id: "a" }, { kind: "character", id: "a" }] }).success).toBe(false);
  expect(extensionInvocationContextSchema.safeParse({ resources: [{ kind: "", id: "a" }] }).success).toBe(false);
  expect(extensionInvocationContextSchema.safeParse({ resources: [{ kind: "host-connection", id: "saved-model" }] }).success).toBe(true);
  expect(extensionInvocationContextSchema.safeParse({ resources: Array.from({ length: 17 }, (_, index) => ({ kind: "character", id: `card-${index}` })) }).success).toBe(false);
});
