/** Typed Extensions API refusals stay actionable without changing shared API error semantics. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installDom, type InstalledDom } from "./_shared/test-dom";
import { ApiHttpError, apiFetchJson } from "./_shared/api-fetch";
import { createExtensionManagerClient } from "./extensions/api-client";
import { MAX_EXTENSION_FILE_CHUNK_BYTES } from "../extensions/contracts/limits";

let installed: InstalledDom;
let originalFetch: typeof fetch;
beforeAll(() => { installed = installDom('<!doctype html><html><head><meta name="vaude-session" content="fixture-token"></head><body></body></html>', { url: "http://127.0.0.1:8325/" }); originalFetch = globalThis.fetch; });
afterAll(async () => { globalThis.fetch = originalFetch; await installed.teardown(); });

test("Extensions API exposes the validated stable code and actionable server message", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "The package entry file is missing." } }), { status: 400 })) as unknown as typeof fetch;
  const { api } = await import("./api");
  const error = await api.extensions.preview({}).then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiHttpError);
  expect(error).toMatchObject({ status: 400, code: "INVALID_REQUEST", message: "The package entry file is missing." });
});

test("an unrelated API still uses its existing status-only fallback for nested error objects", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "internal detail" } }), { status: 400 })) as unknown as typeof fetch;
  await expect(apiFetchJson("/api/unrelated")).rejects.toMatchObject({ status: 400, message: "request failed (400)", code: undefined });
});

test("extension file chunk client cancels a response as soon as it exceeds the relay cap", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_EXTENSION_FILE_CHUNK_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  const client = createExtensionManagerClient(async () => new Response(body, { headers: {
    "x-file-total": String(MAX_EXTENSION_FILE_CHUNK_BYTES + 1), "x-file-final": "false", "x-file-digest": "a".repeat(64),
  } }));
  await expect(client.fileWriteChunk("ticket", 0)).rejects.toThrow("32 KB limit");
  expect(cancelled).toBe(true);
});

test("extension file chunk client joins streamed chunks exactly", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); },
  });
  const client = createExtensionManagerClient(async () => new Response(body, { headers: {
    "x-file-total": "4", "x-file-final": "true", "x-file-digest": "a".repeat(64),
  } }));
  await expect(client.fileWriteChunk("ticket", 0)).resolves.toMatchObject({ offset: 0, totalBytes: 4, bytes: new Uint8Array([1, 2, 3, 4]), final: true });
});
