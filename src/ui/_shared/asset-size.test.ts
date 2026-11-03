/** Local-only asset size metadata is validated without reading its payload. */
import { expect, test } from "bun:test";
import { readAssetSize } from "./art-cache";

const path = `/api/asset/${"a".repeat(64)}`;
test("size lookup sends only HEAD and forwards cancellation without reading a body", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = (async (url, options) => {
      expect(url).toBe(path);
      expect(options?.method).toBe("HEAD");
      expect(options?.signal).toBe(controller.signal);
      expect(new Headers(options?.headers).has("x-bunzai-token")).toBe(false);
      return new Response(null, { headers: { "content-length": "123456" } });
    }) as typeof fetch;
    expect(await readAssetSize(path, controller.signal)).toBe(123456);
  } finally { globalThis.fetch = original; }
});

test("invalid sizes, HTTP failures, and nonlocal paths never become attachment metadata", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    for (const value of [null, "", "-1", "1.5", "9007199254740992"]) {
      globalThis.fetch = Object.assign(async () => {
        calls++;
        return new Response(null, { headers: value === null ? {} : { "content-length": value } });
      }, { preconnect: original.preconnect });
      const error = await readAssetSize(path, new AbortController().signal).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
    }
    globalThis.fetch = Object.assign(async () => { calls++; return new Response(null, { status: 404 }); }, { preconnect: original.preconnect });
    const missing = await readAssetSize(path, new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(missing).toMatchObject({ status: 404 });
    const before = calls;
    const foreign = await readAssetSize(`https://example.test${path}`, new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(foreign).toBeInstanceOf(Error);
    expect(calls).toBe(before);
  } finally { globalThis.fetch = original; }
});
