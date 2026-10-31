/** Wraps one narrow connector so every follow-on provider send uses the turn's shared review and budget guard. */
import type { ProviderRequestGuard } from "../rp-core";
import type { ChatConnection } from "../stage/contracts/chat-store";
import type { Connected } from "./scene-turn";

export function guardedProviderConnect(
  connect: (connection: ChatConnection) => Promise<Connected | null>,
  guard?: ProviderRequestGuard,
): (connection: ChatConnection) => Promise<Connected | null> {
  if (!guard) return connect;
  return async (connection) => {
    const connected = await connect(connection);
    if (!connected) return null;
    const provider = connected.provider;
    return { ...connected, provider: { ...provider, send: (request, io) => guard(connection, request, io, (next) => provider.send(next, io), connected) } };
  };
}
