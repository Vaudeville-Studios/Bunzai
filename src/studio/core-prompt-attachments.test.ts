/** Core bridge refusal tests for selected prompt-block attachments. */
import { expect, test } from "bun:test";
import { assertNoCorePromptAttachments } from "./core-prompt-attachments";

const file = { name: "notes.txt", ref: "data:text/plain;base64,eA==" };
const block = (enabled: boolean) => ({ id: "notes", enabled, attachments: [file] });

test("Core refuses attachments only when their prompt block is selected", () => {
  expect(() => assertNoCorePromptAttachments({ prompts: [block(true)] })).toThrow("enabled blocks");
  expect(() => assertNoCorePromptAttachments({ prompts: [block(true)] }, { notes: false })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ prompts: [block(false)] })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ prompts: [block(false)] }, { notes: true })).toThrow("enabled blocks");
  expect(() => assertNoCorePromptAttachments({ phases: [{ enabled: false, preset: { prompts: [block(true)] } }] })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ phases: [{ enabled: true, preset: { prompts: [block(true)] } }] })).toThrow("enabled blocks");
  expect(() => assertNoCorePromptAttachments({ schemaVersion: "1", kind: "preset", id: "p", body: { prompts: [block(true)] } })).toThrow("enabled blocks");
});
