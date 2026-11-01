/**
 * Hand-offs between apps: one app leaves a value, another reads it on mount and on the event. Kept in
 * session storage so a reload lands in the same place. Two today: which scene the Scenes app opens
 * next (the Library's Start Scene), and opening the Library on its Trash (the Scenes page's Trash).
 */
import { webStorage } from "./web-storage";

export const SCENES_APP = "scenes";
export const LIBRARY_APP = "library";

function handoff(key: string) {
  const event = `bunzai:handoff:${key}`;
  return {
    give(value: string | null): void {
      try {
        if (value) webStorage("session")?.setItem(key, value);
        else webStorage("session")?.removeItem(key);
      } catch {
        // A blocked store only means the app opens where it was.
      }
      window.dispatchEvent(new window.CustomEvent(event));
    },
    taken(): string | null {
      try {
        return webStorage("session")?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    on(listener: () => void): () => void {
      window.addEventListener(event, listener);
      return () => window.removeEventListener(event, listener);
    },
  };
}

const scene = handoff("bunzai.scenes.open");
const sceneTicket = handoff("bunzai.scenes.navigation-ticket");
const sceneLoad = handoff("bunzai.scenes.load-id");
const sceneOpenedEvent = "bunzai:scene:opened";
const sceneWaiters = new Map<string, (opened: boolean) => void>();
export function handOffScene(sceneId: string | null, navigationTicketId: string | null = null, loadId: string | null = null): void {
  sceneTicket.give(navigationTicketId);
  sceneLoad.give(loadId);
  scene.give(sceneId);
}
export const handedScene = scene.taken;
export const handedSceneTicket = sceneTicket.taken;
export const handedSceneLoadId = sceneLoad.taken;
export const onSceneHandoff = scene.on;

/** Waits for the mounted ScenePage to confirm load; failure/timeout never claims navigation succeeded. */
export function waitForSceneHandoff(ticketId: string, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (opened: boolean): void => {
      clearTimeout(timer);
      window.removeEventListener(sceneOpenedEvent, onOpened);
      sceneWaiters.delete(ticketId);
      resolve(opened);
    };
    const onOpened = (event: Event): void => {
      if ((event as CustomEvent<{ ticketId: string; opened: boolean }>).detail?.ticketId === ticketId) finish((event as CustomEvent<{ opened: boolean }>).detail.opened);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sceneWaiters.set(ticketId, finish);
    window.addEventListener(sceneOpenedEvent, onOpened);
  });
}

export function completeSceneHandoff(ticketId: string, opened: boolean): void {
  sceneWaiters.get(ticketId)?.(opened);
  window.dispatchEvent(new window.CustomEvent(sceneOpenedEvent, { detail: { ticketId, opened } }));
}

/** Reports only a loaded ScenePage; a stale server ticket is a failed handoff, not a successful open. */
export function reportSceneOpened(sceneId: string, navigationTicketId: string | null, loadId: string | null,
  notify?: (sceneId: string, ticketId: string | null) => Promise<boolean>): void {
  const report = notify ? notify(sceneId, navigationTicketId).then((accepted) => { if (!accepted) throw new Error("The scene navigation ticket is stale."); }) : Promise.resolve();
  void report.then(() => {
    if (loadId) completeSceneHandoff(loadId, true);
    if (navigationTicketId && navigationTicketId !== loadId) completeSceneHandoff(navigationTicketId, true);
  }, () => {
    if (loadId) completeSceneHandoff(loadId, false);
    if (navigationTicketId && navigationTicketId !== loadId) completeSceneHandoff(navigationTicketId, false);
  });
}

/** The Library opens on its Trash when this is set; it clears it once shown. */
export const libraryTrash = handoff("bunzai.library.trash");
