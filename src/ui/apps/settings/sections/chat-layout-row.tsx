/**
 * Settings > Appearance > Chat layout: the shared presentation choice for every chat, the same key the first-open chooser saves
 * (scenes/chat-layout.ts). Unset shows Full Chat, the chooser's preselection, without saving it. Each layout is a choice card
 * with its lead line, in a grid that reflows with the pane, so none is hidden behind a scrolling strip.
 */
import { useState, type JSX } from "react";
import { CHAT_LAYOUT_KEY, chatLayoutOf, type ChatLayout } from "../../scenes/chat-layout";
import { LAYOUT_OPTIONS } from "../../scenes/layout-options";
import { Card } from "../../../components/button";
import { SettingsRow } from "../section-contract";
import styles from "./chat-layout-row.module.css";

export function ChatLayoutRow({ prefs }: { prefs: { get(key: string): unknown; set(key: string, value: unknown): void } }): JSX.Element {
  const [layout, setLayout] = useState<ChatLayout>(() => chatLayoutOf(prefs) ?? "stage");
  return (
    <SettingsRow label="Chat layout" hint="How every chat is laid out.">
      <div className={styles.grid} role="group" aria-label="Chat layout">
        {/* bounded-ok: the fixed chat layout catalog. */}
        {LAYOUT_OPTIONS.map((o) => (
          <Card key={o.value} kind="choice" heading={o.title} subtitle={o.lead} selected={layout === o.value} aria-pressed={layout === o.value}
            onClick={() => { prefs.set(CHAT_LAYOUT_KEY, o.value); setLayout(o.value); }} />
        ))}
      </div>
    </SettingsRow>
  );
}
