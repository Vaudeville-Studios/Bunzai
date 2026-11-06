/** The saved format as rp-core's capability fields, and what is refused on the way in. */
import { expect, test } from "bun:test";
import { messageFormatCaps, parseMessageFormat } from "./message-format";

test("each preset is the capability fields the picker says it is", () => {
  expect(messageFormatCaps({ preset: "standard" })).toEqual({ midSystem: "native", alternation: "free" });
  expect(messageFormatCaps({ preset: "strict" })).toEqual({ midSystem: "as-user", alternation: "strict" });
  expect(messageFormatCaps({ preset: "top-system" })).toEqual({ midSystem: "as-user", alternation: "free" });
  expect(messageFormatCaps({ preset: "custom", systemInChat: "fold", turnOrder: "alternate", replyStart: "omit" })).toEqual({ midSystem: "as-user", alternation: "strict", prefill: "none" });
  expect(messageFormatCaps({ preset: "custom", systemInChat: "keep", turnOrder: "any", replyStart: "send" })).toEqual({ midSystem: "native", alternation: "free" });
});

test("anything else is refused, never read as a default", () => {
  for (const bad of [null, "strict", { preset: "nope" }, { preset: "custom" }, { preset: "custom", systemInChat: "keep", turnOrder: "any", replyStart: "maybe" }]) expect(parseMessageFormat(bad)).toBeNull();
  expect(parseMessageFormat({ preset: "strict", systemInChat: "fold" })).toEqual({ preset: "strict" });
});
