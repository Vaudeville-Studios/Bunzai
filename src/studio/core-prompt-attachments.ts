/** A Promptbook's phases are the one writing setup rp-core has no form for, so one with attachments in a phase stays refused; a preset block's files go in the request (core-library.ts). */
import { isRecord } from "../core/guards";
import { StudioConflictError } from "./errors";

export function assertNoCorePromptAttachments(body: unknown, toggles: Readonly<Record<string, boolean>> = {}): void {
  if (!isRecord(body)) return;
  const value = isRecord(body["body"]) ? body["body"] : body;
  const carries = (prompts: unknown): boolean => Array.isArray(prompts) && prompts.some((prompt) => {
    if (!isRecord(prompt)) return false;
    const id = prompt["id"];
    const enabled = typeof id === "string" && typeof toggles[id] === "boolean" ? toggles[id] : prompt["enabled"] !== false;
    return enabled && Array.isArray(prompt["attachments"]) && prompt["attachments"].length > 0;
  });
  const phases = value["phases"];
  if (Array.isArray(phases)) for (const phase of phases) {
    if (!isRecord(phase) || phase["enabled"] === false) continue;
    const preset = isRecord(phase["preset"]) ? phase["preset"] : {};
    if (carries((isRecord(preset["body"]) ? preset["body"] : preset)["prompts"])) throw new StudioConflictError("RP-Core cannot send a Promptbook phase's attachments yet. Remove them from enabled blocks in the selected writing setup before using this scene.");
  }
}
