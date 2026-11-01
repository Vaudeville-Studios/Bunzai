/** Polls Kit's one extension manager for pending reviews and bounded file relays. */
import { useEffect, useRef, useState } from "react";
import type { PendingExtensionFileAction } from "../../extensions/contracts/file-actions";
import type { PendingExtensionEffect } from "../../extensions/runtime/confirmation";
import type { ExtensionGrant } from "../../extensions/contracts/grants";
import { isRecord } from "../../core/guards";
import type { TerminalExtensionRuntime } from "../extensions/owner";

export function fileWriteTicketId(ticket: PendingExtensionEffect): string | null {
  const review = ticket.review;
  if (!isRecord(review) || !isRecord(review.hostAction)) return null;
  const action = review.hostAction;
  return action.kind === "bunzai.file.write" && typeof action.ticketId === "string" ? action.ticketId : null;
}

export function useExtensionActions(extensions?: TerminalExtensionRuntime) {
  const [effect, setEffect] = useState<{ ticket: PendingExtensionEffect; grant: ExtensionGrant | null } | null>(null);
  const [files, setFiles] = useState<readonly PendingExtensionFileAction[]>([]);
  const effectReview = useRef<{ id: string; grant: ExtensionGrant | null } | null>(null);
  const running = useRef(new Set<string>());
  useEffect(() => {
    if (!extensions) { setEffect(null); setFiles([]); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (): Promise<void> => {
      try {
        const [actions, pendingFiles] = await Promise.all([extensions.pendingEffects(), extensions.pendingFileActions()]);
        if (live) {
          setFiles(pendingFiles);
          for (const ticket of pendingFiles) if (ticket.action !== "pick" && ticket.action !== "write" && !running.current.has(ticket.id)) {
            running.current.add(ticket.id);
            void extensions.processFileAction(ticket.id).finally(() => running.current.delete(ticket.id));
          }
          const ticket = actions[0];
          if (!ticket) { effectReview.current = null; setEffect(null); }
          else if (effectReview.current?.id === ticket.id) setEffect({ ticket, grant: effectReview.current.grant });
          else {
            const packages = await extensions.list();
            if (!live) return;
            const grant = packages.find((item) => item.id === ticket.packageId)?.grants.find((item) => item.operation === ticket.operation) ?? null;
            effectReview.current = { id: ticket.id, grant };
            setEffect({ ticket, grant });
          }
        }
      } catch { if (live) setEffect(null); }
      if (live) timer = setTimeout(() => { void refresh(); }, 300);
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [extensions]);
  return { effect, files, running, clearEffect: () => setEffect(null) };
}
