/** One bounded in-memory Table Read scratchpad per library lifetime; accepted interview data stays on the server. */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AppContext } from "../../app-contract";
import type { TableReadField } from "../../../core/table-read/fields";
import type { TableReadSettings } from "../../../core/table-read/schema";

interface TableReadDraft {
  sessionId: string | null;
  setup: { idea: string; tempo: TableReadSettings["tempo"]; model: string };
  answer: { questionId: string; text: string } | null;
  edit: { field: TableReadField; value: string; baseline: string } | null;
}
export type TableReadDraftStore = StoreApi<TableReadDraft>;
const empty = (): TableReadDraft => ({ sessionId: null, setup: { idea: "", tempo: "deep-dive", model: "" }, answer: null, edit: null });
const owners = new WeakMap<AppContext["pieces"], { lifetime: number; store: TableReadDraftStore }>();

/** App switches reuse this owner; lock/restore replaces its lifetime and clears the previous scratchpad. */
function draftStore(pieces: AppContext["pieces"], lifetime = pieces.captureLifetime()): TableReadDraftStore {
  const held = owners.get(pieces);
  if (held?.lifetime === lifetime) return held.store;
  held?.store.setState(empty(), true);
  const store = createStore<TableReadDraft>(empty);
  owners.set(pieces, { lifetime, store });
  return store;
}

export function useLibraryLifetime(ctx: AppContext): number {
  const subscribe = useCallback((listener: () => void) => ctx.pieces.subscribeList(() => { draftStore(ctx.pieces); listener(); }), [ctx.pieces]);
  const snapshot = useCallback(() => ctx.pieces.captureLifetime(), [ctx.pieces]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useTableReadDraftStore(ctx: AppContext): TableReadDraftStore {
  const lifetime = useLibraryLifetime(ctx);
  return useMemo(() => draftStore(ctx.pieces, lifetime), [ctx.pieces, lifetime]);
}

/** Only a confirmed server session change clears scratch text, never an initial loading render. */
export function bindInterviewDraft(store: TableReadDraftStore, sessionId: string | null): void {
  if (store.getState().sessionId !== sessionId) store.setState({ ...empty(), sessionId }, true);
}

export const manualDraftDirty = (draft: TableReadDraft): boolean => draft.edit !== null && draft.edit.value !== draft.edit.baseline;
