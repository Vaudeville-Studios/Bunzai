/**
 * Settings > Appearance > Chat layout: the shared presentation choice for every chat, the same key the first-open chooser saves
 * (scenes/chat-layout.ts). Unset shows Full Chat, the chooser's preselection, without saving it.
 */
import { useState, type JSX } from "react";
import { CHAT_LAYOUT_KEY, chatLayoutOf, type ChatLayout } from "../../scenes/chat-layout";
import { LAYOUT_OPTIONS } from "../../scenes/layout-options";
import { SegControl, SettingsRow } from "../section-contract";

export function ChatLayoutRow({ prefs }: { prefs: { get(key: string): unknown; set(key: string, value: unknown): void } }): JSX.Element {
  const [layout, setLayout] = useState<ChatLayout>(() => chatLayoutOf(prefs) ?? "stage");
  return (
    <SettingsRow label="Chat layout" hint="How every chat is laid out.">
      <SegControl<ChatLayout>
        options={LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.title }))}
        current={layout}
        onPick={(value) => { prefs.set(CHAT_LAYOUT_KEY, value); setLayout(value); }}
      />
    </SettingsRow>
  );
}
