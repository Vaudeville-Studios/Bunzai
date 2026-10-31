/**
 * What a scene keeps of its chat summary (RoleCall's `summary_prompts` settings and `user_chats.summary`): the settings that govern it, scene-wide,
 * and one text per take. The settings are sparse (a key left out means the default, which the reader owns); the text is the person's to edit and so lives here, not in a trace.
 * Split from chat-store.ts for the file-size cap; chat-store.ts re-exports.
 */
import type { Chat } from "./chat-store";
import type { MessageDeltaGuard } from "./chat-store-pages";
import type { ChatConnection } from "./chat-settings-types";

export interface SummarySettings {
  /** Automatic summaries on (RoleCall `summary_auto_generate`). */
  auto?: boolean;
  /** Rolling only: summarize after this many more messages; 0 is off. */
  interval?: number;
  /** "rolling" refreshes one block; "pair" adds a `Turn N:` line after each exchange. */
  method?: "rolling" | "pair";
  /** Rolling only: "replace" rewrites the block, "additive" extends it. */
  mode?: "replace" | "additive";
  /** The saved summary goes to the model with each reply. */
  include?: boolean;
  /** Messages the summary already covers leave the prompt (they stay in the scene). */
  hideOld?: boolean;
  /** Messages per summary (rolling); absent means the interval. */
  window?: number;
  /** Newest messages kept verbatim beside the summary when old ones are hidden. */
  keepRecent?: number;
  temperature?: number;
  maxTokens?: number;
  /** Cut each source message to 200 characters before summarizing. */
  truncate?: boolean;
  /** Low reasoning effort for the summary call. */
  reasoning?: boolean;
  /** The model that writes it; absent means the scene's own. */
  model?: ChatConnection;
  /** The person's own prompt template; absent means the built-in one. */
  prompt?: string;
}

/** A change to the settings: a key given replaces it, a key given as null goes back to the default, a key left out stays. */
export type SummarySettingsPatch = { [K in keyof SummarySettings]?: SummarySettings[K] | null };

/** What rides on the chat: the settings and the last automatic run's failure, in words for the person. The texts are read per take. */
export interface ChatSummary {
  settings?: SummarySettings;
  error?: string;
}

/** One take's summary, read from the `summary` slot (core/summary/rows.ts). `through` counts the take's live messages (the greeting too) the text covers; `at` is the latest write (epoch ms); `last` is the message the newest piece ends at. */
export interface TakeSummary {
  text: string;
  through: number;
  at: number;
  last?: string;
}

/** What a write gives: the text and how far it reaches. */
export interface TakeSummaryInput {
  text: string;
  through: number;
}

/** The ChatStore's summary methods (rule 45), declared here with their types and merged into ChatStore. */
export interface ChatStoreSummaries {
  /** Changes the scene's summary settings (rule 45): a key left out of the patch stays, null goes back to the default. Refused whole when malformed. Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  setSummarySettings(chatId: string, patch: SummarySettingsPatch): Promise<Chat | null>;
  /** Keeps the last automatic summary run's failure in words, or clears it with null (rule 45). Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  setSummaryError(chatId: string, error: string | null, extensionCommit?: import("./extension-store").ExtensionCommitContext): Promise<Chat | null>;
  /** A take's summary (rule 45), the text of the `summary` slot's rows the take shows; null when it has none, or the take is absent. */
  summaryOf(branchId: string): Promise<TakeSummary | null>;
  /**
   * The person's own summary (rule 45): replaces the take's whole text, or clears it with null, as message-level deltas on the take's newest live message (the removal of every row it replaces and one row), so the edit survives choosing
   * another version of that message and leaves with the message. The guard is `recordMessageDeltas`'s (the branch version, or the rows the caller read), refused with a StudioConflictError when the take has moved on. Null for an absent or deleted take, or one with no live message.
   */
  setSummary(branchId: string, input: TakeSummaryInput | null, guard?: MessageDeltaGuard): Promise<{ summary: TakeSummary | null } | null>;
}
