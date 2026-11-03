/** The Table Read's typed API lifecycle: durable server state, explicit mutations and monotonic refresh. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppContext } from "../../app-contract";
import type { TableReadMutation, TableReadView } from "../../../core/table-read/schema";
import { toErrorMessage } from "../../_shared/error-message";
import { useVisibleInterval } from "../../_shared/use-visible-interval";
import { newerView } from "./ui-core";
import { useLibraryLifetime } from "./draft-store";

export type TableReadCommand<T = TableReadMutation> = T extends TableReadMutation ? Omit<T, "revision"> : never;

export function useInterview(ctx: AppContext) {
  const lifetime = useLibraryLifetime(ctx);
  const [view, setView] = useState<TableReadView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState(0);
  const current = useRef<{ pieces: AppContext["pieces"]; lifetime: number; view: TableReadView | null }>({ pieces: ctx.pieces, lifetime, view: null });
  const alive = useRef(true);
  const polling = useRef<{ lifetime: number } | null>(null);
  const valid = useCallback(() => ctx.pieces.isCurrentLifetime(lifetime) && current.current.pieces === ctx.pieces && current.current.lifetime === lifetime, [ctx.pieces, lifetime]);
  const accept = useCallback((incoming: TableReadView): boolean => {
    if (!valid()) return false;
    current.current.view = newerView(current.current.view, incoming);
    if (alive.current) setView(current.current.view);
    return true;
  }, [valid]);
  const refresh = useCallback(async (): Promise<void> => {
    if (!valid() || polling.current?.lifetime === lifetime) return;
    const flight = { lifetime };
    polling.current = flight;
    try { accept(await ctx.api.getTableRead()); }
    catch (cause) { if (alive.current && valid()) setError(toErrorMessage(cause, "Could not reopen your Table Read.")); }
    finally {
      if (polling.current === flight) polling.current = null;
      if (alive.current && valid()) setLoading(false);
    }
  }, [accept, ctx, lifetime, valid]);

  useLayoutEffect(() => {
    current.current = { pieces: ctx.pieces, lifetime, view: null };
    polling.current = null;
    setView(null); setError(null); setRequests(0); setLoading(true);
  }, [ctx.pieces, lifetime]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = (): void => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { alive.current = false; window.removeEventListener("focus", focus); };
  }, [refresh]);

  useVisibleInterval(() => { void refresh(); }, requests > 0 || view?.session?.pending ? 750 : null);

  const change = useCallback(async (command: TableReadCommand): Promise<boolean> => {
    const latest = current.current.view;
    if (!latest || !valid()) return false;
    if (alive.current) { setRequests((count) => count + 1); setError(null); }
    try {
      return accept(await ctx.api.changeTableRead({ ...command, revision: latest.revision } as TableReadMutation));
    } catch (cause) {
      if (!valid()) return false;
      const message = toErrorMessage(cause, "That change could not be kept. Your draft is still here.");
      if (alive.current) setError(message);
      else ctx.setStatus(message);
      await refresh();
      return false;
    } finally { if (alive.current && valid()) setRequests((count) => Math.max(0, count - 1)); }
  }, [accept, ctx, refresh, valid]);
  return { view: valid() ? view : null, loading, error, busy: valid() && requests > 0, change, refresh };
}
