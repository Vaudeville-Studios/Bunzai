/**
 * The scene's own lorebook choice (ChatStore rule 20), read and written in one place for the World wing
 * and the Control Booth. Switching, adding or removing a book saves at once, one write after another so a
 * fast second click can never be overtaken by a slow first one. Each change builds on the choice the
 * previous click asked for, not on what is still showing while writes are in flight, so a second click
 * cannot undo the first. Nothing is written until the books have loaded, a change that matches the
 * current choice is not sent, and a failed write reads the books again. The store answers the
 * recomputed books, and that answer is what is shown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppContext } from "../../app-contract";
import type { SceneLoreBook, SceneLoreChoice, SceneLoreFired } from "../../app-contract-scenes";
import type { AsyncState } from "../../_shared/async-state";
import { toErrorMessage } from "../../_shared/error-message";
import { addBook, choiceFromBooks, removeBook, sameChoice, toggleBook } from "./lore-core";

export type LoreState = AsyncState<{ books: SceneLoreBook[]; lastTurn: { fired: SceneLoreFired[]; totalTokens: number } | null }>;

export interface SceneLore {
  lore: LoreState;
  reload(): Promise<void>;
  toggle(book: SceneLoreBook): void;
  remove(book: SceneLoreBook): void;
  add(bookId: string): void;
}

/** `onLoaded` runs after each (re)load, not after the writes: the World wing picks its first book there. */
export function useSceneLore(ctx: AppContext, chatId: string, onLoaded?: (books: SceneLoreBook[]) => void): SceneLore {
  const [lore, setLore] = useState<LoreState>({ state: "loading" });
  const api = useRef(ctx.api);
  api.current = ctx.api;
  const setStatus = useRef(ctx.setStatus);
  setStatus.current = ctx.setStatus;
  const id = useRef(chatId);
  id.current = chatId;
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const held = useRef(lore);
  held.current = lore;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const queue = useRef(Promise.resolve());
  /** The choice the latest click asked for; ahead of the shown books while writes are in flight. */
  const intended = useRef<SceneLoreChoice | null>(null);
  const inFlight = useRef(0);

  const reload = useCallback(async () => {
    setLore({ state: "loading" });
    try {
      const result = await api.current.getSceneLore(id.current);
      if (!mounted.current) return;
      if (inFlight.current === 0) intended.current = choiceFromBooks(result.books);
      setLore({ state: "ready", books: result.books, lastTurn: result.lastTurn });
      loaded.current?.(result.books);
    } catch (e) {
      if (!mounted.current) return;
      setLore({ state: "failed", why: toErrorMessage(e, "the scene's lorebooks could not be read") });
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const change = (edit: (choice: SceneLoreChoice) => SceneLoreChoice): void => {
    const shown = held.current;
    if (shown.state !== "ready") {
      setStatus.current(shown.state === "failed"
        ? "the scene's lorebooks could not be read; reload them before changing them"
        : "the scene's lorebooks are still loading; try again in a moment");
      return;
    }
    const base = intended.current ?? choiceFromBooks(shown.books);
    const next = edit(base);
    if (sameChoice(next, base)) return;
    intended.current = next;
    inFlight.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const result = await api.current.setSceneLore(id.current, next);
        if (inFlight.current === 1) intended.current = choiceFromBooks(result.books);
        if (mounted.current) setLore({ state: "ready", books: result.books, lastTurn: result.lastTurn });
      } catch (e) {
        intended.current = null;
        if (mounted.current) {
          setStatus.current(`could not change this scene's lorebooks: ${toErrorMessage(e, "the library refused it")}`);
          void reload();
        }
      } finally {
        inFlight.current -= 1;
      }
    });
  };
  return {
    lore,
    reload,
    toggle: (b) => change((choice) => toggleBook(choice, b.id, choice.off.includes(b.id))),
    remove: (b) => change((choice) => removeBook(choice, b.id)),
    add: (bookId) => change((choice) => addBook(choice, bookId)),
  };
}
