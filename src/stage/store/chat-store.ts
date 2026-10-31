/** Runtime-neutral memory ChatStore composition for tests and the browser-only Stage. */
import type { ChatStore } from "../contracts/chat-store";
import type { ExtensionCommitContext } from "../contracts/extension-store";
import { castSnapshotCodec } from "./cast-snapshot-codec";
import { memoryChatStoreBackend } from "./memory/chat-store";

export function memoryChatStore(clock: () => number = Date.now, newId: () => string = () => crypto.randomUUID(), options: { authorizeExtensionCommit?: (context: ExtensionCommitContext) => void } = {}): ChatStore {
  return memoryChatStoreBackend(castSnapshotCodec, clock, newId, options);
}
