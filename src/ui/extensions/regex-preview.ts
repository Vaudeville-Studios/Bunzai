/** Purpose: run extension regex previews only through the existing terminable sandbox worker. */
import type { PendingExtensionHostAction } from "../../extensions/contracts/host-actions";
import { MAX_EXTENSION_REGEX_PREVIEW_BYTES } from "../../extensions/contracts/limits";
import { runRegexSandboxed } from "../apps/workbench/regex/run-in-worker";

type Ticket = Extract<PendingExtensionHostAction, { action: "regex.preview" }>;

export async function runExtensionRegexPreview(ticket: Ticket, signal?: AbortSignal): Promise<{
  status: "regex-result"; ok: boolean; text: string; error: string | null;
}> {
  const result = await runRegexSandboxed(ticket.text, ticket.rules, { phase: ticket.phase, timeoutMs: 250, maxMatches: 250, signal });
  if (!result.ok) return { status: "regex-result", ok: false, text: "", error: result.error.slice(0, 500) };
  if (new TextEncoder().encode(result.result.text).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) {
    return { status: "regex-result", ok: false, text: "", error: "Preview output exceeds the 64 KiB limit." };
  }
  return { status: "regex-result", ok: true, text: result.result.text, error: null };
}
