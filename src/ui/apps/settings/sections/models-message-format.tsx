/** The Message format picker of an OpenAI-compatible connection (approved wireframe): the presets, and under Custom its three rules. */
import type { JSX } from "react";
import type { MessageFormat, MessageFormatPreset } from "../../../../kit/providers/message-format";
import styles from "./models.module.css";

const PRESET_LABELS: readonly (readonly [MessageFormatPreset, string])[] = [
  ["standard", "OpenAI standard"],
  ["strict", "Strict turns (many local models)"],
  ["top-system", "System prompt at the top only"],
  ["custom", "Custom"],
];
const HINTS: Readonly<Record<Exclude<MessageFormatPreset, "custom">, string>> = {
  standard: "Notes and guides go in as system messages wherever the scene puts them.",
  strict: "Notes and guides fold into the next user message, and turns always alternate.",
  "top-system": "Notes and guides fold into the next user message; turns can come in any order.",
};
/** What Custom starts from when it is first chosen: the standard rules. */
const CUSTOM_START: MessageFormat = { preset: "custom", systemInChat: "keep", turnOrder: "any", replyStart: "send" };

export function MessageFormatField({ value, onChange }: { value: MessageFormat; onChange(next: MessageFormat): void }): JSX.Element {
  const pick = (preset: MessageFormatPreset) => onChange(preset === "custom" ? CUSTOM_START : { preset });
  return (
    <>
      <label>
        {"Message format"}
        <select value={value.preset} onChange={(e) => { pick(e.target.value as MessageFormatPreset); }}>
          {PRESET_LABELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {value.preset !== "custom" && <span className={styles.hint}>{HINTS[value.preset]}</span>}
      </label>
      {value.preset === "custom" && (
        <div className={styles.rules}>
          <label>
            {"System messages in the chat"}
            <select value={value.systemInChat ?? "keep"} onChange={(e) => { onChange({ ...value, systemInChat: e.target.value as "keep" | "fold" }); }}>
              <option value="keep">{"Keep them as system messages"}</option>
              <option value="fold">{"Fold into the next user message"}</option>
            </select>
          </label>
          <label>
            {"Turn order"}
            <select value={value.turnOrder ?? "any"} onChange={(e) => { onChange({ ...value, turnOrder: e.target.value as "any" | "alternate" }); }}>
              <option value="any">{"Any order"}</option>
              <option value="alternate">{"Always alternate user and assistant"}</option>
            </select>
          </label>
          <label>
            {"Start of the reply"}
            <select value={value.replyStart ?? "send"} onChange={(e) => { onChange({ ...value, replyStart: e.target.value as "send" | "omit" }); }}>
              <option value="send">{"Send it as the last assistant message"}</option>
              <option value="omit">{"Don't send it"}</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
