/**
 * The scene routes' test rig: a Studio on the test sandbox's encrypted library, the real handler, and
 * a POST helper carrying the session token. Shared by the scene route test files.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDir } from "../studio/test-temp-dir";
import { SettingsStore } from "../studio/settings";
import { StudioStore } from "../studio/store";
import { testCharacter } from "../studio/test-character";
import { createHandler } from "./server";
import { createLibrary, type LibraryHandle } from "./library-root";
import { fakeComputer } from "../stage/crypto/fake-device-vault";
import { apiReq, filledSec } from "./server-test-rig";

const roots: string[] = [];
const libraries: LibraryHandle[] = [];
export async function cleanupChatRouteRigs(): Promise<void> {
  for (const library of libraries.splice(0)) await library.close();
  await Promise.all(roots.splice(0).map(removeTempDir));
}

export const vera = testCharacter("vera", [], {
  name: "Vera",
  firstMessage: "Hello {{user}}.",
  alternateGreetings: ["Evening."],
});

export async function chatRouteRig(options: { core?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bunzai-chats-route-"));
  roots.push(root);
  const library = createLibrary(root, { vault: fakeComputer(), sessionsDir: join(root, "sessions"), coreSceneIntegration: options.core === true });
  libraries.push(library);
  await library.open();
  const store = new StudioStore(root);
  const settings = new SettingsStore(root);
  const security = filledSec();
  const handler = createHandler(store, settings, undefined, security, undefined, undefined, undefined, undefined, undefined, undefined, undefined, library);
  const post = async (path: string, body: unknown) =>
    handler(apiReq(path, { method: "POST", token: security.token, contentType: "application/json", body: JSON.stringify(body) }));
  return { store, settings, handler, post, token: security.token, library, close: () => library.close() };
}
