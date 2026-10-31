/** Purpose: provide the typed Extensions manager HTTP client behind the authenticated API fetcher. */
import { ApiHttpError, type ApiFetchInit } from "../_shared/api-fetch";
import { extensionActivationResultSchema, extensionPromptPreviewSchema, extensionPromptScenesSchema, type ExtensionManagerApi } from "../../extensions/runtime/service";
import { pendingExtensionEffectSchema } from "../../extensions/runtime/confirmation";
import { fileActionAnswerSchema, pendingExtensionFileActionSchema, type FileActionAnswer } from "../../extensions/contracts/file-actions";
import { extensionHostActionSnapshotSchema, extensionHostActionAnswerSchema, pendingExtensionHostActionSchema } from "../../extensions/contracts/host-actions";
import { extensionErrorSchema } from "../../extensions/contracts/errors";
import { jsonValueSchemaBounded } from "../../extensions/contracts/value";
import { MAX_EXTENSION_FILE_CHUNK_BYTES, MAX_EXTENSION_FILE_TRANSFER_BYTES } from "../../extensions/contracts/limits";
import { readStreamCapped } from "../../core/stream-bytes";
import type { JsonValue } from "../../extensions/contracts/value";
import { extensionInvocationContextSchema, type ExtensionInvocationContext } from "../../extensions/contracts/invocation-context";
import { isSha256Hex } from "../../core/sha256";
import { z } from "zod";

export type ExtensionApiRequest = (path: string, init?: ApiFetchInit) => Promise<Response>;

const settingsResult = z.strictObject({ schema: jsonValueSchemaBounded.nullable(), value: jsonValueSchemaBounded.nullable(), revision: z.number().int().min(-1) });
const settingsWriteResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), revision: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal("stale") }),
]);
const uninstallResult = z.strictObject({ uninstalled: z.boolean() });
const fileWriteBeginResult = z.strictObject({ begun: z.boolean() });
const sceneOpenedResult = z.strictObject({ notified: z.literal(true) });

export function createExtensionManagerClient(request: ExtensionApiRequest): ExtensionManagerApi {
  const json = async <T,>(path: string, init?: ApiFetchInit): Promise<T> => {
    const response = await request(path, init);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = typeof body === "object" && body !== null
        ? extensionErrorSchema.safeParse((body as { error?: unknown }).error)
        : null;
      if (parsed?.success) throw new ApiHttpError(response.status, parsed.data.message, parsed.data.code);
      throw new ApiHttpError(response.status, `Extension request failed (${response.status}).`);
    }
    return body as T;
  };
  const post = <T,>(path: string, body: unknown): Promise<T> => json<T>(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return {
    list: () => json("/api/extensions/list"),
    revision: () => json<{ revision: string }>("/api/extensions/revision").then(({ revision }) => revision),
    pendingEffects: async () => {
      const values = await json<unknown>("/api/extensions/pending-effects");
      if (!Array.isArray(values) || values.length > 8) throw new Error("Invalid pending extension approvals.");
      return values.map((value) => pendingExtensionEffectSchema.parse(value));
    },
    answerEffect: async (id, approved) => { await post("/api/extensions/answer-effect", { id, approved }); return true; },
    pendingFileActions: async () => {
      const values = await json<unknown>("/api/extensions/file-actions");
      if (!Array.isArray(values) || values.length > 8) throw new Error("Invalid pending extension file actions.");
      return values.map((value) => pendingExtensionFileActionSchema.parse(value));
    },
    answerFileAction: async (id, raw: FileActionAnswer) => {
      await post("/api/extensions/answer-file-action", { id, result: fileActionAnswerSchema.parse(raw) });
      return true;
    },
    beginFileWrite: async (id) => fileWriteBeginResult.parse(await post<unknown>("/api/extensions/begin-file-write", { id })).begun,
    hostActions: async () => extensionHostActionSnapshotSchema.parse(await json<unknown>("/api/extensions/host-actions")),
    claimHostAction: async (id) => pendingExtensionHostActionSchema.parse(await post<unknown>("/api/extensions/claim-host-action", { id })),
    answerHostAction: async (id, raw) => {
      await post("/api/extensions/answer-host-action", { id, answer: extensionHostActionAnswerSchema.parse(raw) });
      return true;
    },
    completeFileReadChunk: async (id, offset, total, bytes, final) => {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      const response = await request(`/api/extensions/file-actions/${encodeURIComponent(id)}/read-chunk`, {
        method: "POST", headers: { "content-type": "application/octet-stream", "x-file-offset": String(offset), "x-file-total": String(total), "x-file-final": String(final) }, body,
      });
      if (!response.ok) throw await readError(response, "Extension file transfer failed");
      return true;
    },
    fileWriteChunk: async (id, offset) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_EXTENSION_FILE_TRANSFER_BYTES) throw new Error("Invalid extension file chunk offset.");
      const response = await request(`/api/extensions/file-actions/${encodeURIComponent(id)}/write-chunk?offset=${offset}`);
      if (!response.ok) throw await readError(response, "Extension file transfer failed");
      const totalBytes = Number(response.headers.get("x-file-total"));
      const final = response.headers.get("x-file-final") === "true";
      const digest = response.headers.get("x-file-digest") ?? "";
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > MAX_EXTENSION_FILE_TRANSFER_BYTES || !isSha256Hex(digest)) throw new Error("Invalid extension file transfer chunk.");
      const body = await readStreamCapped(response.body, MAX_EXTENSION_FILE_CHUNK_BYTES);
      if (!body.ok) {
        if (body.reason === "too-large") throw new Error("Extension file chunk exceeds the 32 KB limit.");
        if (body.reason === "failed") throw body.error;
        throw new Error("Extension file chunk read was interrupted.");
      }
      return { offset, totalBytes, bytes: body.bytes, final, digest };
    },
    preview: (input) => post("/api/extensions/preview", { input }),
    install: (challenge, grants, themeScopes, expectedRevision) => post("/api/extensions/install", { challenge, grants, themeScopes, expectedRevision }),
    previewInstalled: (id) => post("/api/extensions/preview-installed", { id }),
    setGrants: (id, challenge, grants, themeScopes, expectedRevision) => post("/api/extensions/grants", { id, challenge, grants, themeScopes, expectedRevision }),
    readSettings: async (id) => settingsResult.parse(await post<unknown>("/api/extensions/settings/read", { id })),
    writeSettings: async (id, value, expectedRevision) => settingsWriteResult.parse(await post<unknown>("/api/extensions/settings/write", { id, value, expectedRevision })),
    enable: (id, expectedRevision) => post("/api/extensions/enable", { id, expectedRevision }),
    disable: (id, expectedRevision) => post("/api/extensions/disable", { id, expectedRevision }),
    revoke: (id, expectedRevision) => post("/api/extensions/revoke", { id, expectedRevision }),
    uninstall: async (id, expectedRevision) => uninstallResult.parse(await post<unknown>("/api/extensions/uninstall", { id, expectedRevision })).uninstalled,
    activate: async (id, kind, contributionId, input: JsonValue, hostContext?: ExtensionInvocationContext) => extensionActivationResultSchema.parse(await post<unknown>("/api/extensions/activate", {
      id, kind, contributionId, input,
      ...(hostContext ? { hostContext: extensionInvocationContextSchema.parse(hostContext) } : {}),
    })),
    previewPrompts: async (sceneId, draft, signal) => extensionPromptPreviewSchema.parse(await json<unknown>("/api/extensions/prompt-preview", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneId, draft }), signal,
    })),
    promptScenes: async () => extensionPromptScenesSchema.parse(await json<unknown>("/api/extensions/prompt-scenes")),
    notifySceneOpened: async (sceneId, navigationTicketId = null) => {
      sceneOpenedResult.parse(await post<unknown>("/api/extensions/scene-opened", { sceneId, navigationTicketId }));
      return true;
    },
  } satisfies ExtensionManagerApi;
}
async function readError(response: Response, fallback: string): Promise<ApiHttpError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = typeof body === "object" && body !== null
    ? extensionErrorSchema.safeParse((body as { error?: unknown }).error)
    : null;
  return parsed?.success
    ? new ApiHttpError(response.status, parsed.data.message, parsed.data.code)
    : new ApiHttpError(response.status, `${fallback} (${response.status}).`);
}
