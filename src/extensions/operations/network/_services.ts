/** Narrow desktop/terminal network port backed by the shared vetted HTTPS door. */
import type { VettedMethod } from "../../../kit/providers/egress";

export interface ExtensionNetworkResponse { status: number; contentType: string | null; body: string }
export interface ExtensionNetworkServices {
  request(url: string, method: VettedMethod, body: Uint8Array | undefined, maxBytes: number, signal: AbortSignal, allowedOrigins: readonly string[], assertCurrent: () => Promise<void>): Promise<ExtensionNetworkResponse>;
}
