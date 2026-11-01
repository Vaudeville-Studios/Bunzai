/** Purpose: display and answer one host-owned extension effect review in the Terminal. */
/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import type { PendingExtensionEffect } from "../../../../extensions/runtime/confirmation";
import type { ExtensionGrant } from "../../../../extensions/contracts/grants";
import { extensionOperationMetadata } from "../../../../generated/extension-operation-metadata";
import { GateButton } from "./gate-button";
import { theme } from "../../theme";
import { CHECK, CROSS } from "../../glyphs";

export function ExtensionEffectPrompt({ ticket, grant, onAnswer, writeAction = false }: { ticket: PendingExtensionEffect; grant: ExtensionGrant | null; onAnswer(approved: boolean): void; writeAction?: boolean }): ReactNode {
  useKeyboard((event: KeyEvent) => {
    if (event.name === "y") { event.preventDefault(); onAnswer(true); }
    else if (event.name === "n" || event.name === "escape") { event.preventDefault(); onAnswer(false); }
  });
  const metadata = extensionOperationMetadata.find((item) => item.id === ticket.operation);
  const review = JSON.stringify(ticket.review);
  return (
    <box flexDirection="column" border borderColor={theme.gold} backgroundColor={theme.panel} paddingLeft={1} paddingRight={1}>
      <text fg={theme.gold}>EXTENSION REQUEST: {metadata?.title ?? ticket.operation}</text>
      <text fg={theme.soft}>{metadata?.description ?? "Review this host action before it runs."}</text>
      <text fg={theme.bright}>Package: {JSON.stringify(ticket.packageName)}</text>
      <scrollbox height={8} scrollY verticalScrollbarOptions={{ visible: true }} paddingLeft={1}>
        <text fg={theme.soft}>Effect: {ticket.effect}</text>
        {ticket.resources.length ? <text fg={theme.soft}>Resources: {JSON.stringify(ticket.resources)}</text> : null}
        {ticket.fields.length ? <text fg={theme.soft}>Fields: {JSON.stringify(ticket.fields)}</text> : null}
        {ticket.methods.length ? <text fg={theme.soft}>Methods: {ticket.methods.join(", ")}</text> : null}
        {ticket.destinations.length ? <text fg={theme.soft}>Destinations: {JSON.stringify(ticket.destinations)}</text> : null}
        {grant ? <text fg={theme.soft}>Approved duration: {grant.duration}; requests: {grant.budget.requests}; bytes: {grant.budget.bytes}; tokens: {grant.budget.tokens}</text> : null}
        <text fg={theme.soft}>Full review details:</text>
        <text fg={theme.soft}>{review}</text>
      </scrollbox>
      <box height={1} />
      <box flexDirection="row">
        <GateButton glyph={CHECK} label={writeAction ? "Review and write file" : "Approve once"} tone={theme.teal} onPress={() => onAnswer(true)} focused />
        <GateButton glyph={CROSS} label="Deny" tone={theme.red} onPress={() => onAnswer(false)} />
        <text fg={theme.quiet}>y approves, n or esc denies, scroll to inspect all details</text>
      </box>
    </box>
  );
}
