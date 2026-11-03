/** Strict attachment references on the shared PresetPrompt contract. */
import { expect, test } from "bun:test";
import { emptyPresetBody } from "./schema";
import { presetBodySchema } from "./runtime-schema";

const ref = "\u0000b:u:application/pdf:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const prompt = { id: "p", name: "File", content: "", role: "user", enabled: true, systemPrompt: false, marker: false, placement: "relative", injectionDepth: 0, injectionOrder: 0, forbidOverrides: false };

test("attachment-free presets remain valid and a prompt may carry a sealed file reference", () => {
  expect(presetBodySchema.safeParse(emptyPresetBody("P")).success).toBe(true);
  expect(presetBodySchema.safeParse({ name: "P", prompts: [{ ...prompt, attachments: [{ name: "guide.pdf", ref }] }] }).success).toBe(true);
});

test("prompt attachments reject paths, URLs, unsupported media and unknown metadata", () => {
  const body = (attachment: unknown) => ({ name: "P", prompts: [{ ...prompt, attachments: [attachment] }] });
  expect(presetBodySchema.safeParse(body({ name: "../guide.pdf", ref })).success).toBe(false);
  expect(presetBodySchema.safeParse(body({ name: "guide.pdf", ref: "https://example.invalid/guide.pdf" })).success).toBe(false);
  expect(presetBodySchema.safeParse(body({ name: "guide.pdf", ref: "\u0000b:u:image/svg+xml:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" })).success).toBe(false);
  expect(presetBodySchema.safeParse(body({ name: "guide.pdf", ref, path: "ignored" })).success).toBe(false);
});
