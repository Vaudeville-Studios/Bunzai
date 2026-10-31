/** Owns scene fetch generations and reports a navigation only after the stored scene loaded. */
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Message } from "../../../stage/contracts/chat-store";
import type { OpenScene } from "../../../studio/scenes";
import { apiStatusIs } from "../../_shared/api-fetch";
import { completeSceneHandoff, reportSceneOpened } from "../../_shared/scene-handoff";
import { toErrorMessage } from "../../_shared/error-message";

export type SceneLoadProblem = { message: string; castGone: boolean };
export function useScenePageLoad(input: {
  api: { openScene(chatId: string): Promise<OpenScene> };
  chatId: string;
  navigationTicketId: string | null;
  loadId: string | null;
  notifySceneOpened?: (sceneId: string, ticketId: string | null) => Promise<boolean>;
  onBack(): void;
  setStatus(text: string): void;
  setScene: Dispatch<SetStateAction<OpenScene | null>>;
  setProblem: Dispatch<SetStateAction<SceneLoadProblem | null>>;
  setMacroMessages: Dispatch<SetStateAction<Map<number, { role: Message["role"]; content: string }>>>;
  following: MutableRefObject<boolean>;
}): { generation: MutableRefObject<number>; load(): void } {
  const { api, chatId, navigationTicketId, loadId, notifySceneOpened, onBack, setStatus, setScene, setProblem, setMacroMessages, following } = input;
  const generation = useRef(0);
  const leave = useRef({ onBack, setStatus });
  leave.current = { onBack, setStatus };
  const load = useCallback(() => {
    const current = ++generation.current;
    setMacroMessages(new Map());
    setProblem(null);
    api.openScene(chatId).then((scene) => {
      if (current !== generation.current) return;
      generation.current++;
      setMacroMessages(new Map());
      following.current = true;
      setScene(scene);
      reportSceneOpened(chatId, navigationTicketId, loadId, notifySceneOpened);
    }, (error: unknown) => {
      if (current !== generation.current) return;
      if (loadId) completeSceneHandoff(loadId, false);
      if (navigationTicketId && navigationTicketId !== loadId) completeSceneHandoff(navigationTicketId, false);
      if (apiStatusIs(error, 404)) {
        leave.current.setStatus("That scene is not in this library.");
        leave.current.onBack();
      } else setProblem({ message: toErrorMessage(error), castGone: (error as { code?: unknown }).code === "cast_missing" });
    });
  }, [api, chatId, following, loadId, navigationTicketId, notifySceneOpened, setMacroMessages, setProblem, setScene]);
  return { generation, load };
}
