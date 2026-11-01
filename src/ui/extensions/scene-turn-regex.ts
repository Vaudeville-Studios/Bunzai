/** Purpose: answer extension-owned scene regex gates through the existing isolated regex worker. */
import { sceneTurnRegexAnswerSchema, type PendingExtensionHostAction, type SceneTurnRegexHostAnswer } from "../../extensions/contracts/host-actions";
import { runPromptRegex } from "../apps/scenes/scene-prompt-regex";

type Ticket = Extract<PendingExtensionHostAction, { action: "scene-turn.regex" }>;

export async function runExtensionSceneTurnRegex(ticket: Ticket, workerFactory?: () => Worker): Promise<SceneTurnRegexHostAnswer> {
  const answer = await runPromptRegex(ticket, workerFactory);
  return sceneTurnRegexAnswerSchema.parse({ status: "scene-regex-result", answer });
}
