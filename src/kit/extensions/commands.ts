/** Narrow Kit command adapter for the packages already installed in the opened library. */
import { decodeJsonValue, type JsonValue } from "../../extensions/contracts/value";
import type { ExtensionActivationResult, InstalledExtensionSummary } from "../../extensions/runtime/service";
import type { TerminalExtensionRuntime } from "./owner";

const jsonInput = (source: string): JsonValue => {
  if (!source) return null;
  return decodeJsonValue(JSON.parse(source) as unknown);
};
const contribution = (item: InstalledExtensionSummary, id: string) =>
  item.contributions.find((part) => part.type === "command" && part.id === id);
const displayResult = (result: ExtensionActivationResult): string => {
  if ("descriptor" in result) return "The command completed with a visual result that Kit cannot display.";
  const text = JSON.stringify(result.output).replace(/[\\`*_#\[\]<>|~]/g, "\\$&");
  return text.length <= 32_000 ? text : `${text.slice(0, 32_000)}\\… (output truncated)`;
};

export interface TerminalExtensionCommandContext {
  arg: string;
  say(text: string): void;
  extensions?: TerminalExtensionRuntime;
}

/** Parse a single safe command line; JSON input remains bounded value data. */
export async function runExtensionCommand(ctx: TerminalExtensionCommandContext): Promise<void> {
  if (!ctx.extensions) { ctx.say("The Terminal extension runtime is unavailable."); return; }
  const [action, packageId, contributionId, ...inputParts] = ctx.arg.trim().split(/\s+/);
  if (!action) {
    const packages = await ctx.extensions.list();
    const rows = packages.flatMap((item) => item.enabled
      ? item.contributions.filter((part) => part.type === "command" && item.registeredCommands.includes(part.id)).map((part) => `${item.id} ${part.id}`)
      : []);
    ctx.say(rows.length ? `Installed commands\n${rows.map((row) => `- ${row}`).join("\n")}` : "No enabled extension commands are installed.");
    return;
  }
  if (action === "prompt") {
    const rest = ctx.arg.trim().slice("prompt".length).trim();
    if (!rest) {
      const scenes = await ctx.extensions.promptScenes();
      ctx.say(scenes.length ? `Scenes available for local prompt preview\n${scenes.map((scene) => `- ${JSON.stringify(scene.title)} (${scene.id})`).join("\n")}` : "No stored scenes are available for prompt preview.");
      return;
    }
    const selected = /^(\S+)(?:\s([\s\S]*))?$/.exec(rest);
    if (!selected) { ctx.say("Use /extension prompt [scene-id] [draft text]."); return; }
    const sceneId = selected[1]!;
    if (!(await ctx.extensions.promptScenes()).some((scene) => scene.id === sceneId)) { ctx.say("That stored scene is unavailable for prompt preview."); return; }
    const result = await ctx.extensions.previewPrompts(sceneId, selected[2] ?? "");
    ctx.say(`${result.label}\nScene: ${JSON.stringify(sceneId)}\n${JSON.stringify(result.messages, null, 2)}`);
    return;
  }
  if (action !== "run" || !packageId || !contributionId) {
    ctx.say("Use /extension to list commands, /extension prompt [scene-id] [draft text], or /extension run <package-id> <command-id> [JSON input].");
    return;
  }
  const item = (await ctx.extensions.list()).find((candidate) => candidate.id === packageId && candidate.enabled);
  if (!item || !item.registeredCommands.includes(contributionId) || !contribution(item, contributionId)) { ctx.say("That enabled extension command is unavailable."); return; }
  const input = jsonInput(inputParts.join(" "));
  const result = await ctx.extensions.activate(packageId, "command", contributionId, input);
  ctx.say(`Extension ${packageId} · ${contributionId}\n${displayResult(result)}`);
}
