/** A Promptbook phase's attachments stay refused on a Core scene; a preset block's own go in the request. */
import { expect, test } from "bun:test";
import { assertNoCorePromptAttachments } from "./core-prompt-attachments";

const file = { name: "notes.txt", ref: "data:text/plain;base64,eA==" };
const block = (enabled: boolean) => ({ id: "notes", enabled, attachments: [file] });

test("Core refuses attachments only in an enabled Promptbook phase's enabled blocks", () => {
  expect(() => assertNoCorePromptAttachments({ prompts: [block(true)] })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ phases: [{ enabled: false, preset: { prompts: [block(true)] } }] })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ phases: [{ enabled: true, preset: { prompts: [block(false)] } }] })).not.toThrow();
  expect(() => assertNoCorePromptAttachments({ phases: [{ enabled: true, preset: { prompts: [block(true)] } }] })).toThrow("Promptbook");
  expect(() => assertNoCorePromptAttachments({ schemaVersion: "1", kind: "promptbook", id: "p", body: { phases: [{ enabled: true, preset: { body: { prompts: [block(true)] } } }] } })).toThrow("Promptbook");
});
