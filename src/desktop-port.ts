/** Desktop listen-port selection and claim policy. */
import { runningBunzaiAt } from "./ui/port-owner";

export const DEFAULT_DESKTOP_PORT = 8321;
const DEFAULT_PORT_TRIES = 10;

/** Parse the opt-in desktop port before any library or server startup effects. */
export function desktopPortOverride(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[0-9]{1,5}$/.test(value)) throw new Error("BUNZAI_PORT must be a decimal port from 1024 to 65535");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("BUNZAI_PORT must be a decimal port from 1024 to 65535");
  }
  return port;
}

/** An override is an exact, isolated claim; only the default mode may reuse another Bunzai. */
export async function claimDesktopPort<T extends { instanceId: string; url: string; stop: () => void; close?: () => Promise<void> }>(
  override: number | null,
  start: (port: number) => T,
  isBunzaiRunning: (port: number, instanceId?: string) => Promise<string | null> = (port, instanceId) => runningBunzaiAt(port, undefined, instanceId),
): Promise<{ server: T; ours: true } | { server: { url: string; stop: () => void; close: () => Promise<void> }; ours: false }> {
  if (override !== null) {
    if (await isBunzaiRunning(override)) throw new Error(`Bunzai is already running on requested port ${override}`);
    const server = start(override);
    if (server.url !== `http://127.0.0.1:${override}` || !(server.instanceId && await isBunzaiRunning(override, server.instanceId))) {
      server.stop();
      await server.close?.();
      throw new Error(`desktop server did not claim requested port ${override}`);
    }
    return { server, ours: true };
  }

  for (let port = DEFAULT_DESKTOP_PORT; port < DEFAULT_DESKTOP_PORT + DEFAULT_PORT_TRIES; port += 1) {
    try {
      const server = start(port);
      if (server.instanceId && await isBunzaiRunning(port, server.instanceId)) return { server, ours: true };
      server.stop();
      await server.close?.();
    } catch {}
    const existing = await isBunzaiRunning(port);
    if (existing) return { server: { url: existing, stop: () => {}, close: async () => {} }, ours: false };
  }
  throw new Error(`no free port between ${DEFAULT_DESKTOP_PORT} and ${DEFAULT_DESKTOP_PORT + DEFAULT_PORT_TRIES - 1}`);
}
