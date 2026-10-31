/** Purpose: prove the Terminal extension command offers only stored scenes and calls the local prompt preview. */
import { expect, test } from "bun:test";
import { runExtensionCommand } from "./commands";
import type { TerminalExtensionCommandContext } from "./commands";

test("Terminal prompt preview lists canonical scenes and sends the selected bounded draft", async () => {
  const output: string[] = [], calls: unknown[][] = [];
  const extensions = {
    promptScenes: async () => [{ id: "scene-1", title: "Night" }],
    previewPrompts: async (sceneId: string, draft: string) => { calls.push([sceneId, draft]); return { sceneId, label: "Local prompt preview; no model called; unshaped and unbudgeted." as const, messages: [{ role: "user" as const, content: draft }] }; },
  } as never;
  const run = async (arg: string) => runExtensionCommand({ arg, say: (text) => output.push(text), extensions } as TerminalExtensionCommandContext);
  await run("prompt");
  expect(output[0]).toContain('"Night" (scene-1)');
  await run("prompt scene-1 A local draft");
  expect(calls).toEqual([["scene-1", "A local draft"]]);
  expect(output[1]).toContain("Local prompt preview; no model called; unshaped and unbudgeted.");
  expect(output[1]).toContain("A local draft");
  await run("prompt other-scene draft");
  expect(output[2]).toContain("unavailable");
  expect(calls).toHaveLength(1);
});
