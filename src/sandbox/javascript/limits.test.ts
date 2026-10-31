/** Boundary checks for JavaScript source and release limits. */
import { expect, test } from "bun:test";
import { assertJavaScriptSource, RELEASE_JS_LIMITS } from "./limits";

test("source byte cap accepts exact boundary and refuses the next byte", () => {
  expect(() => assertJavaScriptSource("x".repeat(RELEASE_JS_LIMITS.sourceBytes))).not.toThrow();
  expect(() => assertJavaScriptSource("x".repeat(RELEASE_JS_LIMITS.sourceBytes + 1))).toThrow("source-size");
});

test("release ceilings retain bounded worker and VM memory budgets", () => {
  expect(RELEASE_JS_LIMITS.memoryBytes).toBe(16 * 1024 * 1024);
  expect(RELEASE_JS_LIMITS.wasmMemoryBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  expect(RELEASE_JS_LIMITS.maxPending).toBe(32);
});
