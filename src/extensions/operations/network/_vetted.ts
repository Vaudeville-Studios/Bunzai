/** Adapt the existing DNS-pinned egress door to the extension's deliberately small request contract. */
import { guardedFetchVetted, type VettedMethod } from "../../../kit/providers/egress";
import type { ExtensionNetworkServices } from "./_services";

export function createVettedExtensionNetwork(fetchVetted: typeof guardedFetchVetted = guardedFetchVetted): ExtensionNetworkServices {
  return {
    async request(url, method, body, maxBytes, signal, allowedOrigins, assertCurrent) {
      const { response } = await fetchVetted(url, {
        method: method as VettedMethod, body, signal, maxBytes, timeoutMs: 15_000, assertCurrent,
        headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1", ...(body ? { "content-type": "application/json" } : {}) },
        vetUrl: (next) => { if (!allowedOrigins.includes(next.origin)) throw new Error("The redirect destination is not approved."); },
      });
      const text = await response.text();
      return { status: response.status, contentType: response.headers.get("content-type")?.slice(0, 200) ?? null, body: text };
    },
  };
}
