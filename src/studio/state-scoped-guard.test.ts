/** The loop's write exception stays with its two owners: only the trackers' update tool and the skills' open and close tools declare `stateScoped`, and the write door is handed to them alone. */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const sources = [...new Glob("src/**/*.{ts,tsx}").scanSync(ROOT)].map((p) => p.replaceAll("\\", "/")).filter((f) => !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));

describe("the write exception", () => {
  test("only library-trackers.ts and library-skills.ts set stateScoped (the loop only reads it)", () => {
    const setters = sources.filter(({ text }) => /\bstateScoped\s*:\s*true\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))).map((s) => s.file);
    expect(setters.sort()).toEqual(["src/studio/library-skills.ts", "src/studio/library-trackers.ts"]);
  });

  test("the write door (TurnWrites) is not in every tool's context: only the tracker and skill tools are given it", () => {
    const tools = sources.find((s) => s.file === "src/studio/scene-turn-tools.ts")!.text;
    expect(tools).not.toMatch(/interface ToolsContext[^}]*writes/);
    // the forecast makes the tools the way a send does, with a door that is never opened, to count their definitions; a Core turn holds the door as the old turn does
    const users = sources.filter(({ file, text }) => /\b(?:Turn|Tool)Writes\b|\bturnWrites\b/.test(text) && !["src/studio/scene-turn-writes.ts"].includes(file)).map((s) => s.file).sort();
    expect(users).toEqual(["src/studio/book-phase.ts", "src/studio/core-turn-plan.ts", "src/studio/library-skills.ts", "src/studio/library-trackers.ts", "src/studio/scene-forecast.ts", "src/studio/scene-turn-tools.ts", "src/studio/scene-turn.ts"]);
  });
});
