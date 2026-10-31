/** Purpose: verify extension runtime route decoding, authorization and bounded file-action relays. */
import { expect, test } from "bun:test";
import type { ExtensionManagerApi } from "../extensions/runtime/service";
import type { PendingExtensionFileAction } from "../extensions/contracts/file-actions";
import type { ExtensionHostActionSnapshot, PendingExtensionHostAction } from "../extensions/contracts/host-actions";
import { handleExtensionRoutes } from "./server-extension-runtime";

test("file action routes enforce bounded binary relay and pass typed answers to the runtime", async () => {
  const pending: PendingExtensionFileAction = { id: "ticket-1", packageId: "bunzai.extension.demo", packageName: "Demo", principal: {
    storeId: "fixture", packageId: "bunzai.extension.demo", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 9,
  }, operation: "files.read", action: "read", handleId: "opaque-1", maxBytes: 100, fileName: "notes.txt", expiresAt: Date.now() + 30_000 };
  const answers: unknown[] = [], reads: unknown[] = [];
  const beginCalls: string[] = [];
  const service = {
    pendingFileActions: async () => [pending],
    beginFileWrite: async (id: string) => { beginCalls.push(id); return id === "ticket-write"; },
    answerFileAction: async (id: string, result: unknown) => { answers.push([id, result]); return true; },
    completeFileReadChunk: async (...args: unknown[]) => { reads.push(args); return true; },
    fileWriteChunk: () => ({ offset: 0, totalBytes: 3, bytes: new Uint8Array([7, 8, 9]), final: true, digest: "b".repeat(64) }),
  } as unknown as ExtensionManagerApi;
  const route = async (path: string, request: Request): Promise<Response> =>
    (await handleExtensionRoutes(request, new URL(`http://127.0.0.1${path}`), service))!;

  const list = await route("/api/extensions/file-actions", new Request("http://127.0.0.1/api/extensions/file-actions"));
  expect(await list.json()).toEqual([pending]);
  const bytes = new Uint8Array([1, 2, 3]);
  const readUrl = "http://127.0.0.1/api/extensions/file-actions/ticket-1/read-chunk";
  const read = await route("/api/extensions/file-actions/ticket-1/read-chunk", new Request(readUrl, { method: "POST", headers: {
    "content-type": "application/octet-stream", "x-file-offset": "0", "x-file-total": "3", "x-file-final": "true",
  }, body: bytes }));
  expect(read.status).toBe(204);
  expect(reads[0]).toEqual(["ticket-1", 0, 3, bytes, true]);
  const oversized = await route("/api/extensions/file-actions/ticket-1/read-chunk", new Request(readUrl, { method: "POST", headers: {
    "content-type": "application/octet-stream", "x-file-offset": "0", "x-file-total": "32769", "x-file-final": "false",
  }, body: new Uint8Array(32_769) }));
  expect(oversized.status).toBe(413);
  const write = await route("/api/extensions/file-actions/ticket-1/write-chunk?offset=0", new Request("http://127.0.0.1/api/extensions/file-actions/ticket-1/write-chunk?offset=0"));
  expect([...new Uint8Array(await write.arrayBuffer())]).toEqual([7, 8, 9]);
  expect(write.headers.get("x-file-digest")).toBe("b".repeat(64));
  const answerUrl = "http://127.0.0.1/api/extensions/answer-file-action";
  const answer = await route("/api/extensions/answer-file-action", new Request(answerUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "ticket-1", result: { status: "cancelled" } }) }));
  expect(answer.status).toBe(200);
  expect(answers).toEqual([["ticket-1", { status: "cancelled" }]]);
  const begin = await route("/api/extensions/begin-file-write", new Request("http://127.0.0.1/api/extensions/begin-file-write", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ticket-write" }),
  }));
  expect(await begin.json()).toEqual({ begun: true });
  expect(beginCalls).toEqual(["ticket-write"]);
});

test("host action routes expose a validated snapshot and forward typed answers", async () => {
  const snapshot: ExtensionHostActionSnapshot = { actions: [], panels: [], statuses: [], notices: [] };
  const ticket: PendingExtensionHostAction = { id: "ticket-1", packageId: "demo.extension", operation: "links.open", action: "links.open", url: "https://example.com/",
    principal: { storeId: "fixture", packageId: "demo.extension", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 1 }, expiresAt: Date.now() + 30_000 };
  const answers: unknown[] = [];
  const service = {
    hostActions: async () => snapshot,
    claimHostAction: async (id: string) => id === ticket.id ? ticket : null,
    answerHostAction: async (id: string, answer: unknown) => { answers.push([id, answer]); return true; },
  } as unknown as ExtensionManagerApi;
  const get = await handleExtensionRoutes(new Request("http://127.0.0.1/api/extensions/host-actions"), new URL("http://127.0.0.1/api/extensions/host-actions"), service);
  expect(await get?.json()).toEqual(snapshot);
  const claimUrl = "http://127.0.0.1/api/extensions/claim-host-action";
  const claimed = await handleExtensionRoutes(new Request(claimUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ticket.id }) }), new URL(claimUrl), service);
  expect(claimed?.status).toBe(200);
  expect(await claimed?.json()).toEqual(ticket);
  const response = await handleExtensionRoutes(new Request("http://127.0.0.1/api/extensions/answer-host-action", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ticket-1", answer: { status: "accepted" } }),
  }), new URL("http://127.0.0.1/api/extensions/answer-host-action"), service);
  expect(response?.status).toBe(200);
  expect(answers).toEqual([["ticket-1", { status: "accepted" }]]);
  const malformed = await handleExtensionRoutes(new Request("http://127.0.0.1/api/extensions/answer-host-action", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ticket-1", answer: { status: "approved" } }),
  }), new URL("http://127.0.0.1/api/extensions/answer-host-action"), service);
  expect(malformed?.status).toBe(400);
});

test("prompt preview routes pass cancellation through and expose bounded scene rows", async () => {
  let input: unknown;
  let signal: AbortSignal | undefined;
  const service = {
    promptScenes: async () => [{ id: "scene-1", title: "Scene" }],
    previewPrompts: async (sceneId: string, draft: string, requestSignal: AbortSignal) => {
      input = { sceneId, draft }; signal = requestSignal;
      return { sceneId, label: "Local prompt preview; no model called; unshaped and unbudgeted.", messages: [{ role: "user", content: draft }] };
    },
  } as unknown as ExtensionManagerApi;
  const scenesUrl = "http://127.0.0.1/api/extensions/prompt-scenes";
  const scenes = await handleExtensionRoutes(new Request(scenesUrl), new URL(scenesUrl), service);
  expect(await scenes?.json()).toEqual([{ id: "scene-1", title: "Scene" }]);
  const previewUrl = "http://127.0.0.1/api/extensions/prompt-preview";
  const request = new Request(previewUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneId: "scene-1", draft: "hello" }) });
  const response = await handleExtensionRoutes(request, new URL(previewUrl), service);
  expect(await response?.json()).toEqual({ sceneId: "scene-1", label: "Local prompt preview; no model called; unshaped and unbudgeted.", messages: [{ role: "user", content: "hello" }] });
  expect(input).toEqual({ sceneId: "scene-1", draft: "hello" });
  expect(signal).toBe(request.signal);
});

test("activation route keeps bounded host context separate from the guest value", async () => {
  let called: unknown[] | undefined;
  const service = {
    activate: async (...args: unknown[]) => { called = args; return { status: "completed", output: null }; },
  } as unknown as ExtensionManagerApi;
  const url = "http://127.0.0.1/api/extensions/activate";
  const request = (body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = { id: "demo.extension", kind: "command", contributionId: "inspect", input: { limit: 3 }, hostContext: { resources: [{ kind: "character", id: "mira" }] } };
  const response = await handleExtensionRoutes(request(payload), new URL(url), service);
  expect(response?.status).toBe(200);
  expect(called).toEqual([payload.id, payload.kind, payload.contributionId, payload.input, undefined, undefined, payload.hostContext]);
  const malformed = await handleExtensionRoutes(request({ ...payload, hostContext: { resources: payload.hostContext.resources, extra: true } }), new URL(url), service);
  expect(malformed?.status).toBe(400);
});
