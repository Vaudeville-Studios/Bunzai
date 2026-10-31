/** Purpose: accept local paths only as trusted Terminal input for opaque extension file tickets. */
/** @jsxImportSource @opentui/react */
import { useState, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import type { PendingExtensionFileAction } from "../../../../extensions/contracts/file-actions";
import { theme } from "../../theme";
import { GateButton } from "./gate-button";
import { CHECK, CROSS } from "../../glyphs";

export function ExtensionFilePrompt({ ticket, onChoose, onCancel }: {
  ticket: Extract<PendingExtensionFileAction, { action: "pick" }>;
  onChoose(path: string): void;
  onCancel(): void;
}): ReactNode {
  const [path, setPath] = useState("");
  useKeyboard((event: KeyEvent) => {
    if (event.name === "escape") { event.preventDefault(); onCancel(); }
  });
  return <box flexDirection="column" border borderColor={theme.gold} backgroundColor={theme.panel} paddingLeft={1} paddingRight={1}>
    <text fg={theme.gold}>EXTENSION FILE SELECTION</text>
    <text fg={theme.soft}>Package: {JSON.stringify(ticket.packageName)}</text>
    <text fg={theme.bright}>Choose a local file path for {ticket.mode === "read" ? "reading" : ticket.mode === "create" ? "creating" : "replacing"}. The path stays in Kit; the extension receives only an opaque handle.</text>
    {ticket.suggestedName ? <text fg={theme.soft}>Suggested name: {JSON.stringify(ticket.suggestedName)}</text> : null}
    <input focused flexGrow={1} placeholder="Type a path and press Enter" onInput={setPath} onSubmit={(value) => { if (typeof value === "string" && value.trim()) onChoose(value.trim()); }} />
    <box flexDirection="row"><GateButton glyph={CHECK} label="Use this path" tone={theme.teal} onPress={() => { if (path.trim()) onChoose(path.trim()); }} focused /><GateButton glyph={CROSS} label="Cancel" tone={theme.red} onPress={onCancel} /><text fg={theme.quiet}>enter selects, esc cancels</text></box>
  </box>;
}
