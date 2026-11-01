/**
 * The native window, in a WORKER thread - because webview's run() is a blocking native message pump
 * that would starve the server's event loop on the main thread (verified live: window up, server
 * dead). The worker owns the window; the main thread owns the server; a close message joins them.
 *
 * Size is set at construction (Mac invisible-until-resized pitfall). Title comes from the host so
 * "Bunzai (Dev)" vs "Bunzai." matches the Start Menu tile the user clicked.
 */
import { Webview, SizeHint } from "webview-bun";
import { runWindowSession } from "./desktop-window-session";
import { nameProcessForDesktop } from "./desktop-app-id";
import { setExecutableWindowIcon } from "./desktop-window-icon";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ url: string; title?: string }>) => {
  const title = event.data.title?.trim() || "Bunzai.";
  nameProcessForDesktop(); // Linux: the app_id the dock matches to bunzai.desktop
  const wv = new Webview(false, {
    width: 1280,
    height: 820,
    hint: SizeHint.NONE,
  });
  runWindowSession(wv, { url: event.data.url, title }, () => {
    const releaseIcon = setExecutableWindowIcon(wv.unsafeWindowHandle);
    try { wv.run(); } finally { releaseIcon(); }
  }, () => self.postMessage({ closed: true }));
};
