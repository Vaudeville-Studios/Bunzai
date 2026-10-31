/** Purpose: bind library's staged pieces to the shared host-owned extension command menu. */
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import type { JSX } from "react";
import { HostCommandMenu } from "../../extensions/host-command-menu";

export function LibraryExtensionCommandMenu({ ctx, pieces }: { ctx: AppContext; pieces: readonly StudioEntitySummary[] }): JSX.Element {
  const resources = pieces.map(({ kind, id }) => ({ kind, id }));
  return <HostCommandMenu
    api={ctx.api.extensions}
    resources={resources}
    onActivate={(packageId, commandId, input, selected) => ctx.api.extensions.activate(packageId, "command", commandId, input, { resources: [...selected] })}
  />;
}
