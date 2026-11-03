/**
 * The assembler with a preset (RoleCall's prompt-assembly.ts sections 9 to 10.7 at the pin): the
 * history expanded where the preset puts it, in-chat blocks woven into it by depth, append blocks
 * glued onto messages, and pins at the very ends. The recorded fixtures prove the same end to end.
 */
import { describe, expect, test } from "bun:test";
import type { CharacterBody } from "../../entities/character/schema";
import type { PresetBody, PresetPrompt } from "../../entities/preset/schema";
import { makePresetPrompt } from "../preset/test-fixtures";
import { assemble } from "./assemble";
import { PresetPlanError } from "./preset";
import type { AssemblyInput, HistoryMessage } from "./types";

const card = { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } as CharacterBody;
const msg = (id: string, role: HistoryMessage["role"], content: string): HistoryMessage => ({ id, role, content });
const block = (id: string, content: string, over: Partial<PresetPrompt> = {}): PresetPrompt =>
  makePresetPrompt({ id, name: id, content, systemPrompt: true, ...over });
/** Main carries every slot's macro, so presetPlan adds nothing and the test reads only its own blocks. */
const main = block("main", "Be {{char}}.{{persona}}{{lore}}{{summary}}");
const preset = (...prompts: PresetPrompt[]): PresetBody => ({ name: "Test", prompts: [main, ...prompts] });
const input = (over: Partial<AssemblyInput> = {}): AssemblyInput => ({
  character: card,
  history: [msg("g", "assistant", "Evening."), msg("u1", "user", "Hi"), msg("a1", "assistant", "Hello.")],
  current: msg("u2", "user", "Any storms?"),
  localVariables: new Map(),
  globalVariables: new Map(),
  now: Date.UTC(2026, 8, 28),
  randomSeed: 1,
  ...over,
});
const lines = (over: Partial<AssemblyInput>) => assemble(input(over)).messages.map((m) => `${m.role}:${m.content}`);

describe("a preset's history", () => {
});

describe("append blocks and pins", () => {
});

describe("the preset's switches", () => {
  test("a block the assembler cannot place stops the assembly with its name", () => {
    expect(() => assemble(input({ preset: preset(block("odd", "x", { placement: "sideways" })) }))).toThrow(PresetPlanError);
  });
});

describe("the preset's own switches, as macros see them", () => {
  test("{{enabled::id}} answers with each block's effective switch, the scene's toggles included (RoleCall's promptInfo)", () => {
    const out = lines({
      preset: preset(
        block("h", "{{message_history}}"),
        block("ask", "style={{enabled::style}} dark={{enabled::dark}}"),
        block("style", "Style.", { enabled: false }),
        block("dark", "Dark.", { enabled: true }),
      ),
      promptToggles: { style: true, dark: false },
    });
    expect(out).toContain("system:style=true dark=false");
  });
});

test("an enabled attachment-only block survives assembly", () => {
  const file = { name: "notes.txt", ref: "\u0000b:u:text/plain:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
  const attachmentOnly = { ...block("file", "", { role: "user" }), attachments: [file] } as PresetPrompt;
  const result = assemble(input({ preset: preset(attachmentOnly) }));
  expect(result.messages).toContainEqual(expect.objectContaining({ role: "user", attachments: [file] }));
});
