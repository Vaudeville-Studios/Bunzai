/** Public turn stream events shared by the scene engine and its host adapters. */
import type { JsonObject, Message } from "../stage/contracts/chat-store";
import type { ProviderRole } from "../stage/contracts/provider";
import type { DirectorActivity } from "../stage/contracts/director-types";
import type { RequestParams } from "./scene-turn-trace";
import type { RegexItem } from "./scene-turn-regex";
import type { TurnKind } from "./scene-turn-load";
import type { PromptAttachmentInfo } from "../core/media/prompt-attachment";

export type TurnEvent =
  | { type: "phase"; name: string; role: "private" | "reply" | "after" }
  | { type: "start"; turnId: string; kind: TurnKind; messageId: string | null }
  | { type: "text"; delta: string; full?: true }
  | { type: "reasoning"; delta: string; full?: true }
  | { type: "review"; turnId: string; messages: { role: ProviderRole; content: string }[]; files?: PromptAttachmentInfo[]; mediaEstimateIncomplete?: boolean; tokens: number; tools?: { name: string; description: string; parameters: JsonObject }[]; params?: RequestParams }
  | { type: "regex"; turnId: string; rules: import("../entities/regex/schema").RegexRule[]; items: RegexItem[]; macros: { user: string; char: string }; phase?: "display" }
  | { type: "finalcut"; pass: string; index: number; of: number }
  | { type: "done"; message: Message }
  | { type: "stopped"; message: Message | null }
  | { type: "failed"; category: string; code: string; message: string; draft: string }
  | { type: "conflict"; turnId: string; draft: string }
  | { type: "prefill"; text: string }
  | { type: "director"; status: "planning" | "planned" | "failed"; reason?: string; entries?: DirectorActivity[] }
  | { type: "world"; status: "recalling" | "recalled" | "skipped" | "failed"; count?: number; reason?: string };
