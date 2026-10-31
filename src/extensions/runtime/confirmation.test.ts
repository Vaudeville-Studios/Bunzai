/** Tests bounded host confirmation tickets, one-time answers and expiry behavior. */
import { describe, expect, test } from "bun:test";
import { createExtensionConfirmations } from "./confirmation";

describe("host extension effect confirmation", () => {
  test("answers one host ticket and rejects repeats", async () => {
    let now = 10;
    const queue = createExtensionConfirmations({ now: () => now, id: () => "ticket" });
    const controller = new AbortController();
    const result = queue.request("pkg", "Package", { operation: "content.write", effect: "write", resources: [{ kind: "character", id: "c1" }], fields: [], methods: [], destinations: [], review: { before: "old", after: "new" } }, controller.signal);
    expect(queue.list()).toMatchObject([{ id: "ticket", packageId: "pkg", operation: "content.write" }]);
    expect(queue.answer("ticket", true)).toBe(true);
    expect(await result).toBe(true);
    expect(queue.answer("ticket", true)).toBe(false);
  });

  test("abort, expiry and capacity all fail closed", async () => {
    let now = 10;
    let id = 0;
    const queue = createExtensionConfirmations({ now: () => now, id: () => `t${++id}`, maxPending: 1, ttlMs: 5 });
    const controller = new AbortController();
    const first = queue.request("pkg", "Package", { operation: "test.confirmation", effect: "write", resources: [], fields: [], methods: [], destinations: [], review: null }, controller.signal);
    expect(await queue.request("pkg", "Package", { operation: "test.confirmation", effect: "write", resources: [], fields: [], methods: [], destinations: [], review: null }, new AbortController().signal)).toBe(false);
    controller.abort();
    expect(await first).toBe(false);
    const second = queue.request("pkg", "Package", { operation: "test.confirmation", effect: "write", resources: [], fields: [], methods: [], destinations: [], review: null }, new AbortController().signal);
    now = 20;
    expect(queue.list()).toEqual([]);
    expect(await second).toBe(false);
  });
});
