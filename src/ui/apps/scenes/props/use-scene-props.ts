/**
 * The scene's Props (ChatStore rule 21): fetched as soon as a scene opens, independent of whether the
 * Props wing is open, because a switched-on prop draws on the stage itself (scene-page.tsx), not only
 * inside its wing. Writes queue one after another (LoreWing's choiceQueue pattern) so a fast second
 * click can never be overtaken by a slow first one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppContext } from "../../../app-contract";
import { toErrorMessage } from "../../../_shared/error-message";
import type { AsyncState } from "../../../_shared/async-state";

export type PropsLoad = AsyncState<{ on: string[] }>;

export function useSceneProps(ctx: AppContext, chatId: string): { load: PropsLoad; toggle(id: string, on: boolean): void; reload(): void } {
  const [load, setLoad] = useState<PropsLoad>({ state: "loading" });
  const api = useRef(ctx.api);
  api.current = ctx.api;
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const queue = useRef(Promise.resolve());
  // What the scene holds: each write is built from this, so a refused switch never rides along with the next one.
  const held = useRef<string[]>([]);

  const load2 = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const r = await api.current.getSceneProps(chatIdRef.current);
      held.current = r.on;
      if (mounted.current) setLoad({ state: "ready", on: r.on });
    } catch (e) {
      if (mounted.current) setLoad({ state: "failed", why: toErrorMessage(e, "this scene's props could not be read") });
    }
  }, []);
  useEffect(() => { void load2(); }, [chatId, load2]);

  const toggle = (id: string, on: boolean): void => {
    setLoad((cur) => {
      if (cur.state !== "ready") return cur;
      const flip = (list: readonly string[]) => on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id);
      queue.current = queue.current.then(async () => {
        try {
          const r = await api.current.setSceneProps(chatIdRef.current, flip(held.current));
          held.current = r.on;
          if (mounted.current) setLoad({ state: "ready", on: r.on });
        } catch (e) {
          // A refused switch goes back and says why; the list is still good, so it stays on screen.
          if (mounted.current) { setLoad({ state: "ready", on: held.current }); ctx.setStatus(toErrorMessage(e, "this scene's props could not be saved")); }
        }
      });
      return { state: "ready", on: flip(cur.on) };
    });
  };

  return { load, toggle, reload: () => void load2() };
}
