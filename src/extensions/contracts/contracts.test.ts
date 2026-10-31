/** Public extension boundary schema regressions. */
import { describe, expect, test } from "bun:test";
import { extensionWireRequestSchema } from "./wire";
import { jsonValueSchemaBounded } from "./value";

const request = (args: unknown) => ({ v: 1, type: "request", id: 1, operation: "content.read", args });

describe("extension wire request", () => {
  test("accepts bounded JSON values and rejects unknown authorization fields", () => {
    expect(extensionWireRequestSchema.parse(request({ nested: [null, true, 2, "ok"] }))).toHaveProperty("id", 1);
    expect(() => extensionWireRequestSchema.parse({ ...request({}), principal: {} })).toThrow();
  });
  test("rejects cycles, excessive depth, aggregate bytes, non-finite numbers and host prototypes", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 26; i++) { deep.next = {}; deep = deep.next as Record<string, unknown>; }
    deep.value = 1;
    for (const value of [cycle, root, "é".repeat(130_000), Infinity, new Date()]) {
      expect(() => extensionWireRequestSchema.parse(request(value))).toThrow();
    }
  });
  test("rejects forbidden keys and accessors without evaluating getters", () => {
    const forbidden = JSON.parse('{"constructor":1}');
    let called = false;
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get: () => { called = true; return 1; } });
    expect(() => extensionWireRequestSchema.parse(request(forbidden))).toThrow();
    expect(() => extensionWireRequestSchema.parse(request(accessor))).toThrow();
    expect(called).toBe(false);
  });
  test("rejects non-enumerable serializers without invoking them", () => {
    let called = false;
    const value = Object.defineProperty({}, "toJSON", { value: () => { called = true; return {}; } });
    expect(() => extensionWireRequestSchema.parse(request(value))).toThrow();
    expect(called).toBe(false);
  });
  test("bounded value schema preflights accessors before Zod traverses them", () => {
    let called = false;
    const value = Object.defineProperty({}, "value", { enumerable: true, get: () => { called = true; return 1; } });
    expect(jsonValueSchemaBounded.safeParse(value).success).toBe(false);
    expect(called).toBe(false);
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(jsonValueSchemaBounded.safeParse(cycle).success).toBe(false);
  });
});
