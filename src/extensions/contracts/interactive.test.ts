/** Tests strict value-only interactive descriptors and host validation. */
import { describe, expect, test } from "bun:test";
import { decodeInteractiveDescriptor, validateInteractiveDescriptor } from "./interactive";
import { decodeJsonValue } from "./value";

const valid = { version: 1, root: { type: "field", id: "query", label: "Search", command: "search", value: "" } } as const;

describe("interactive descriptor boundary", () => {
  test("accepts value-only controls with declared action references", () => {
    expect(decodeInteractiveDescriptor(valid)).toEqual(valid);
  });
  test("accepts null-prototype records produced by the strict JSON value decoder", () => {
    expect(decodeInteractiveDescriptor(decodeJsonValue({ version: 1, root: { type: "text", text: "safe" } }))).toEqual({ version: 1, root: { type: "text", text: "safe" } });
  });
  test("rejects undeclared commands and unapproved image assets before persistence", () => {
    expect(() => validateInteractiveDescriptor({ version: 1, root: { type: "button", id: "go", label: "Go", command: "other" } }, { commands: ["run"], assets: [] })).toThrow(/undeclared command/);
    expect(() => validateInteractiveDescriptor({ version: 1, root: { type: "image", asset: "a".repeat(64), alt: "Cover" } }, { commands: [], assets: [] })).toThrow(/unapproved asset/);
    expect(validateInteractiveDescriptor({ version: 1, root: { type: "button", id: "go", label: "Go", command: "run" } }, { commands: ["run"], assets: [] })).toEqual({ version: 1, root: { type: "button", id: "go", label: "Go", command: "run" } });
  });
  test("rejects controls without actions and unknown executable-looking fields", () => {
    expect(() => decodeInteractiveDescriptor({ version: 1, root: { type: "button", id: "go", label: "Go", command: "search", onClick: "alert(1)" } })).toThrow();
    expect(() => decodeInteractiveDescriptor({ version: 1, root: { type: "toggle", id: "x", label: "X", value: true } })).toThrow();
  });
  test("rejects excessive depth, node count, cycles and exotic objects before schema recursion", () => {
    let deep: Record<string, unknown> = { type: "text", text: "end" };
    for (let i = 0; i < 17; i++) deep = { type: "stack", children: [deep] };
    expect(() => decodeInteractiveDescriptor({ version: 1, root: deep })).toThrow("size limit");
    expect(() => decodeInteractiveDescriptor({ version: 1, root: { type: "list", items: Array.from({ length: 50 }, () => ({ type: "stack", children: Array.from({ length: 4 }, () => ({ type: "text", text: "x" })) })) } })).toThrow("size limit");
    const cycle: { type: string; children?: unknown[] } = { type: "stack", children: [] };
    cycle.children!.push(cycle);
    expect(() => decodeInteractiveDescriptor({ version: 1, root: cycle })).toThrow("cycle");
    expect(() => decodeInteractiveDescriptor({ version: 1, root: Object.create({ type: "text" }) })).toThrow("exotic");
  });
});
