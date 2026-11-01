#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
/**
 * Kit's entry: bind to the studio, bring up the alt-screen renderer, mount the chrome.
 * `bun run kit` from a source checkout lands here. This is the imperative shell; pure logic stays
 * in the engine, loop, and tools. Runtime plugin support also keeps a future compiled Kit entrypoint
 * possible, but current GitHub release artifacts do not ship one.
 */
import "@opentui/react/runtime-plugin-support";
import { basename } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createBridge } from "./bridge";
import { openLibrary } from "../ui/library-root";
import { COLLECTION_KIND } from "../studio/collections-shape";
import { createSession } from "./session";
import type { RailSnapshot } from "./tools/tool";
import { discoverCommands } from "./commands/discover";
import { App } from "./render/app";
import { theme } from "./render/theme";
import { restoreTerminalBackground, setTerminalBackground } from "./terminal-surface";
import { discoverDoctorChecks } from "./doctor/discover";
import { runDoctor } from "./doctor/run";
import { activeBackendId } from "./keystore/keystore";
import { readVault } from "./providers/vault";
import { APP_VERSION } from "../version";
import { scheduleFsWatch, watchStudio, type StudioWatchSource } from "./watch/watcher";
import { LAUNCH_USAGE, parseLaunchArgs } from "./launch-args";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm, type TerminalExtensionRuntime } from "./extensions/owner";
import { toErrorMessage } from "../error-message";

async function main(): Promise<void> {
  // BEFORE ANY OF THE STUDIO IS READ. --help must answer instantly rather than after a walk of
  // somebody's whole folder, and a bad argument should be said now, not behind a splash screen.
  const args = parseLaunchArgs(Bun.argv.slice(2));
  if (args.help) {
    console.log(LAUNCH_USAGE);
    return;
  }
  if (args.unknown.length > 0) {
    console.error(`kit: unrecognised ${args.unknown.join(" ")}`);
    console.error(LAUNCH_USAGE);
    process.exitCode = 2;
    return;
  }
  const bridge = createBridge();
  // The encrypted library opens first; a locked one is said plainly instead of failing on the first read.
  const library = await openLibrary(bridge.studioDir);
  if (library?.state === "locked") {
    console.error("kit: your library is locked. Open it in Bunzai first, then start Kit again.");
    process.exitCode = 1;
    return;
  }
  const decks = await bridge.deckCounts();
  const pieces = await bridge.list();
  const total = decks.reduce((sum, deck) => sum + deck.count, 0);
  /**
   * The person's own groupings, offered to `@` as rows of their own.
   *
   * KEPT OUT OF `pieces` DELIBERATELY. A collection is not a piece: counted there it would inflate
   * the deck totals, and the empty-composer suggestion reads the first piece by name, so a group
   * called The Cast would have the terminal opening with "try: inspect The Cast for gaps" about a
   * thing that is not inspectable. It travels as its own list and is merged only where mentions are
   * matched. See the same split in the desktop window's use-mentions.ts.
   */
  const groups = (await bridge.collections?.())?.collections ?? [];
  const studioName = basename(bridge.studioDir) || "Bunzai Studio";
  /**
   * A live handle to the rail, filled in by the shell once it mounts.
   *
   * The session is built before any React state exists, so it cannot be handed the rail directly -
   * and it must not be handed a VALUE either, because the rail changes throughout a conversation.
   * One mutable cell, written by the shell and read per turn, keeps the direction of dependency
   * right: the session never imports render.
   */
  const railCell: { read: () => RailSnapshot | null } = { read: () => null };
  let extensionRuntime: TerminalExtensionRuntime | undefined;
  if (library?.state === "unlocked") {
    try {
      if (!library.stateStore) throw new Error("the opened library has no state store");
      extensionRuntime = await createTerminalExtensionRuntime({
        store: library.extensionStore, content: library.content, stateStore: library.stateStore, chats: library.chats, storeId: bridge.studioDir,
        wasmBinary: await readTerminalQuickJsWasm(),
      });
    } catch (error) {
      console.error(`kit: extension runtime unavailable: ${toErrorMessage(error)}`);
    }
  }
  const session = await createSession(bridge, () => railCell.read(), undefined, extensionRuntime);
  const commands = await discoverCommands();
  const doctorChecks = await discoverDoctorChecks();
  const diagnose = (): ReturnType<typeof runDoctor> =>
    runDoctor(doctorChecks, {
      pieces: () => bridge.list(),
      provider: (signal) => session.providerProbe?.(signal) ?? Promise.resolve(null),
      async vault() {
        const [vault, backend] = await Promise.all([readVault(), activeBackendId()]);
        return {
          backend,
          providers: vault.providers.length,
          active: vault.activeId !== null,
          ...(vault.notice ? { notice: vault.notice } : {}),
        };
      },
      version: APP_VERSION,
      runtime: Bun.version,
    });
  const studioWatcher: StudioWatchSource = (onChange) =>
    watchStudio({
      initial: pieces,
      list: () => bridge.list(),
      onChange,
      // A change on disk polls once, rather than every 1.2s whether or not anything moved
      //.
      schedule: scheduleFsWatch(bridge.studioDir),
    });

  setTerminalBackground(process.stdout, theme.well);
  try {
    const renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      exitOnCtrlC: true,
      useMouse: true,
      backgroundColor: theme.well,
      /**
       * Opt into the Kitty keyboard protocol where the terminal supports it, falling back to the raw
       * parser where it does not. This was absent, and the raw parser is why whole families of keys
       * behaved as if nothing was bound to them:
       *
       * - `disambiguate` fixes ESC timing and ALT+KEY AMBIGUITY. Without it a terminal reports alt+v
       *   as an ESC followed by "v", indistinguishable from someone pressing Escape and then typing,
       *   so no alt chord can be recognised reliably. That is alt+V for image paste, and every other
       *   alt binding.
       * - `alternateKeys` reports the shifted and base-layout key alongside the resolved one, which is
       *   what makes a chord survive a non-US layout instead of silently not matching.
       *
       * Opting in is a request, not a requirement: a terminal that does not answer leaves us exactly
       * where we already were, so this cannot make a working setup worse.
       */
      useKittyKeyboard: { disambiguate: true, alternateKeys: true },
    });
    const root = createRoot(renderer);
    let quitting = false;
    const quit = (): void => {
      if (quitting) return;
      quitting = true;
      root.unmount();
      renderer.destroy();
      restoreTerminalBackground(process.stdout);
      void (async () => {
        await extensionRuntime?.close();
        await library?.close();
        process.exit(0);
      })();
    };

    root.render(
      <App
        studioName={studioName}
        totalPieces={total}
        decks={decks}
        pieces={pieces}
        groups={groups.map((c) => ({ kind: COLLECTION_KIND, id: c.id, name: c.name }))}
        session={session}
        commands={commands}
        runDoctor={diagnose}
        watchStudio={studioWatcher}
        onRail={(read) => { railCell.read = read; }}
        {...(args.resume === null ? {} : { resume: args.resume })}
        onQuit={quit}
      />,
    );

    if (process.env.KIT_SMOKE) {
      console.error(`kit-smoke: mounted; studio=${studioName} pieces=${total}`);
      setTimeout(quit, 500);
    }
  } catch (error) {
    await extensionRuntime?.close();
    await library?.close();
    restoreTerminalBackground(process.stdout);
    throw error;
  }
}

void main().catch((error) => {
  console.error("kit: failed to start", toErrorMessage(error));
  process.exit(1);
});
