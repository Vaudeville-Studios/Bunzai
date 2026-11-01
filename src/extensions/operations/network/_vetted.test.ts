/** Proves the host adapter fixes method headers, caps and exact-origin redirects before egress. */
import { expect, test } from "bun:test";
import { createVettedExtensionNetwork } from "./_vetted";

test("vetted extension adapter sends only fixed headers and preserves strict timeout, origin and byte bounds", async () => {
  let seen: unknown[] | undefined;
  const adapter = createVettedExtensionNetwork(async (url, options) => {
    seen = [url, options];
    options?.vetUrl?.(new URL("https://api.example/redirect"));
    return { response: new Response("ok", { status: 202, headers: { "content-type": "text/plain" } }), url: new URL(url) };
  });
  const signal = new AbortController().signal;
  await expect(adapter.request("https://api.example/post", "POST", new TextEncoder().encode("{}"), 512, signal, ["https://api.example"], async () => {})).resolves.toEqual({ status: 202, contentType: "text/plain", body: "ok" });
  const options = seen![1] as { method: string; body: Uint8Array; maxBytes: number; timeoutMs: number; signal: AbortSignal; headers: Record<string, string>; vetUrl(url: URL): void };
  expect(options.method).toBe("POST"); expect([...options.body]).toEqual([123, 125]); expect(options.maxBytes).toBe(512); expect(options.timeoutMs).toBe(15_000); expect(options.signal).toBe(signal);
  expect(options.headers).toEqual({ accept: "application/json, text/plain;q=0.9, */*;q=0.1", "content-type": "application/json" });
  expect(() => options.vetUrl(new URL("https://unapproved.example/"))).toThrow(/not approved/);
});
