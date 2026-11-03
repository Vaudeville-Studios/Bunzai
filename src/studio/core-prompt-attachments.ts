/** RP-Core does not consume host preset attachments; conservatively refuse the selected setup while any remain authored. */
import { isRecord } from "../core/guards";
import { StudioConflictError } from "./errors";

export function assertNoCorePromptAttachments(body: unknown, toggles: Readonly<Record<string, boolean>> = {}): void {
  if (!isRecord(body)) return;
  const value = isRecord(body["body"]) ? body["body"] : body;
  const prompts = value["prompts"];
  if (Array.isArray(prompts) && prompts.some((prompt) => {
    if (!isRecord(prompt)) return false;
    const id = prompt["id"];
    const enabled = typeof id === "string" && typeof toggles[id] === "boolean" ? toggles[id] : prompt["enabled"] !== false;
    return enabled && Array.isArray(prompt["attachments"]) && prompt["attachments"].length > 0;
  })) {
    throw new StudioConflictError("RP-Core cannot send prompt-block attachments yet. Remove attachments from enabled blocks in the selected writing setup before using this scene.");
  }
  const phases = value["phases"];
  if (Array.isArray(phases)) for (const phase of phases) if (isRecord(phase) && phase["enabled"] !== false) assertNoCorePromptAttachments(phase["preset"]);
}
