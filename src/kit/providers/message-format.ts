/**
 * How an OpenAI-compatible connection wants its messages laid out, chosen in Settings > Models. Servers differ: most take a system
 * message anywhere, many local chat templates refuse one mid-chat or refuse two turns in a row from one side. rp-core shapes every
 * request to what its capability record says, so the choice is that record's three fields, and only those.
 */
export type MessageFormatPreset = "standard" | "strict" | "top-system" | "custom";
export interface MessageFormat {
  preset: MessageFormatPreset;
  /** Custom only: a system message in the chat stays one, or folds into the next user message. */
  systemInChat?: "keep" | "fold";
  /** Custom only: any order, or always alternating user and assistant. */
  turnOrder?: "any" | "alternate";
  /** Custom only: Start Reply With goes as the last assistant message, or is not sent. */
  replyStart?: "send" | "omit";
}

const PRESETS: readonly MessageFormatPreset[] = ["standard", "strict", "top-system", "custom"];

/** A saved or posted value as a format; null when it is not one. Unknown rule values are refused, not dropped. */
export function parseMessageFormat(raw: unknown): MessageFormat | null {
  if (!raw || typeof raw !== "object") return null;
  const { preset, systemInChat, turnOrder, replyStart } = raw as Record<string, unknown>;
  if (!PRESETS.includes(preset as MessageFormatPreset)) return null;
  if (preset !== "custom") return { preset: preset as MessageFormatPreset };
  if (systemInChat !== "keep" && systemInChat !== "fold") return null;
  if (turnOrder !== "any" && turnOrder !== "alternate") return null;
  if (replyStart !== "send" && replyStart !== "omit") return null;
  return { preset: "custom", systemInChat, turnOrder, replyStart };
}

export interface MessageFormatCaps { midSystem: "native" | "as-user"; alternation: "free" | "strict"; prefill?: "none" }

/** The capability fields a format sets. A format that says nothing of the prefill leaves what the model is known to take. */
export function messageFormatCaps(format: MessageFormat): MessageFormatCaps {
  switch (format.preset) {
    case "standard": return { midSystem: "native", alternation: "free" };
    case "strict": return { midSystem: "as-user", alternation: "strict" };
    case "top-system": return { midSystem: "as-user", alternation: "free" };
    case "custom": return {
      midSystem: format.systemInChat === "fold" ? "as-user" : "native",
      alternation: format.turnOrder === "alternate" ? "strict" : "free",
      ...(format.replyStart === "omit" ? { prefill: "none" as const } : {}),
    };
  }
}
