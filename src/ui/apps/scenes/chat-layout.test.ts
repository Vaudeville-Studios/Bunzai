/** What chat-layout.ts reads: a saved layout is returned, and an unset or unreadable one asks again instead of guessing. */
import { describe, expect, test } from "bun:test";
import { CHAT_LAYOUT_KEY, chatLayoutOf } from "./chat-layout";

const prefsWith = (value: unknown) => ({ get: (key: string) => (key === CHAT_LAYOUT_KEY ? value : undefined) });

describe("chatLayoutOf", () => {
  test("reads a saved layout", () => {
    expect(chatLayoutOf(prefsWith("stage"))).toBe("stage");
    expect(chatLayoutOf(prefsWith("messenger"))).toBe("messenger");
    for (const layout of ["familiar", "basic", "desktop98", "immersive"] as const) expect(chatLayoutOf(prefsWith(layout))).toBe(layout);
  });
  test("unset and unreadable values ask again instead of guessing", () => {
    expect(chatLayoutOf(prefsWith(undefined))).toBeNull();
    expect(chatLayoutOf(prefsWith("discord"))).toBeNull();
    expect(chatLayoutOf(prefsWith(1))).toBeNull();
  });
});
