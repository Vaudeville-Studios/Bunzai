/** Authenticated local routes for the fenced extension service. */
import { z } from "zod";
import { ExtensionServiceError, type ExtensionManagerApi } from "../extensions/runtime/service";
import { decodeJsonValue } from "../extensions/contracts/value";
import { extensionGrantSchema } from "../extensions/contracts/grants";
import { fileActionAnswerSchema } from "../extensions/contracts/file-actions";
import { extensionPromptPreviewSchema } from "../extensions/runtime/service-api";
import { extensionInvocationContextSchema } from "../extensions/contracts/invocation-context";
import { extensionHostActionAnswerSchema, pendingExtensionHostActionSchema } from "../extensions/contracts/host-actions";
import { extensionErrorCodeSchema, type ExtensionErrorCode } from "../extensions/contracts/errors";
import { MAX_EXTENSION_FILE_CHUNK_BYTES } from "../extensions/contracts/limits";
import { THEME_SCOPES } from "../extensions/theme-appearance";
import { err, json, readBodyCapped, readJsonObject } from "./server-extension-http";

const BODY_LIMIT = 8_000_000;
const id = z.string().min(1).max(120);
const revision = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
const envelope = z.object({ input: z.unknown() }).strict();
const themeScopes = z.array(z.enum(THEME_SCOPES)).max(THEME_SCOPES.length);
const install = z.object({ challenge: z.string().min(1).max(100), grants: z.array(z.unknown()).max(256), themeScopes, expectedRevision: revision }).strict();
const grants = z.object({ id, challenge: z.string().min(1).max(100), grants: z.array(z.unknown()).max(256), themeScopes, expectedRevision: revision }).strict();
const mutation = z.object({ id, expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const activated = z.object({ id, kind: z.literal("command"), contributionId: z.string().min(1).max(80), input: z.unknown(), hostContext: extensionInvocationContextSchema.optional() }).strict();
const promptPreview = z.strictObject({ sceneId: z.string().min(1).max(120), draft: z.string().max(256_000) });
const oneId = z.object({ id }).strict();
const settingsWrite = z.object({ id, value: z.unknown(), expectedRevision: revision }).strict();
const effectAnswer = z.object({ id: z.string().min(1).max(200), approved: z.boolean() }).strict();
const grantList = (values: readonly unknown[]) => values.map((value) => extensionGrantSchema.parse(value));
const fileAnswer = z.object({ id: z.string().min(1).max(120), result: fileActionAnswerSchema }).strict();
const hostActionAnswer = z.object({ id: z.string().min(1).max(120), answer: extensionHostActionAnswerSchema }).strict();
const sceneOpened = z.strictObject({ sceneId: id, navigationTicketId: id.nullable().optional() });
const MAX_FILE_CHUNK = MAX_EXTENSION_FILE_CHUNK_BYTES;
const headerInteger = (request: Request, name: string): number | null => {
  const value = request.headers.get(name);
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
function routeFailure(error: unknown, path: string): Response {
  let code: ExtensionErrorCode = "INTERNAL_ERROR";
  if (error instanceof ExtensionServiceError) code = error.code;
  else if (error instanceof z.ZodError) code = "INVALID_REQUEST";
  else if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]!;
    const parsed = extensionErrorCodeSchema.safeParse(prefix);
    if (parsed.success) code = parsed.data;
    else console.error("Extension runtime route failed", { path, error: error.name });
  } else console.error("Extension runtime route failed", { path, error: "non-error exception" });
  const messages: Record<ExtensionErrorCode, string> = {
    INVALID_REQUEST: "Extension request was invalid.", UNKNOWN_OPERATION: "The requested operation is unavailable.", UNSUPPORTED_HOST: "This operation is unavailable on this host.",
    PERMISSION_DENIED: "The extension does not have the required approval.", STALE_PRINCIPAL: "Extension access changed. Restart the extension.",
    LIMIT_EXCEEDED: "The extension operation exceeded a host limit.", CANCELLED: "The extension operation was cancelled.", OPERATION_FAILED: "The extension operation failed.",
    PACKAGE_CHANGED: "The extension package changed. Review it again.", CONFLICT: "Extension state changed. Review it again.", DECLINED: "Required access was not approved.",
    RUNTIME_UNAVAILABLE: "The extension runtime is unavailable.", RECOVERY_REQUIRED: "The extension needs access review before activation.", INTERNAL_ERROR: "The extension runtime failed. Check host logs.",
  };
  const status = code === "CONFLICT" || code === "PACKAGE_CHANGED" || code === "CANCELLED" ? 409
    : code === "PERMISSION_DENIED" ? 403 : code === "LIMIT_EXCEEDED" ? 413
      : code === "RUNTIME_UNAVAILABLE" ? 503 : code === "INTERNAL_ERROR" ? 500 : 400;
  return json({ error: { code, message: messages[code] } }, status);
}

/** Returns null for unrelated paths; only the local trusted server should call this owner. */
export async function handleExtensionRoutes(req: Request, url: URL, service: ExtensionManagerApi | null): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/extensions/")) return null;
  if (!service) return err("Extension runtime is unavailable while the library is locked or closed.", 503);
  if (req.method === "GET" && url.pathname === "/api/extensions/list") {
    try { return json(await service.list()); } catch { return err("Could not read installed extensions.", 503); }
  }
  if (req.method === "GET" && url.pathname === "/api/extensions/revision") {
    try { return json({ revision: await service.revision() }); } catch { return err("Could not read extension revision.", 503); }
  }
  if (req.method === "GET" && url.pathname === "/api/extensions/prompt-scenes") {
    try { return json(await service.promptScenes()); } catch { return err("Could not read scenes for prompt preview.", 503); }
  }
  if (req.method === "GET" && url.pathname === "/api/extensions/pending-effects") {
    try { return json(await service.pendingEffects()); } catch { return err("Could not read pending extension approvals.", 503); }
  }
  if (req.method === "GET" && url.pathname === "/api/extensions/file-actions") {
    try { return json(await service.pendingFileActions()); } catch { return err("Could not read pending extension file actions.", 503); }
  }
  if (req.method === "GET" && url.pathname === "/api/extensions/host-actions") {
    try { return json(await service.hostActions()); } catch { return err("Could not read extension host actions.", 503); }
  }
  const readChunk = /^\/api\/extensions\/file-actions\/([^/]+)\/read-chunk$/.exec(url.pathname);
  if (req.method === "POST" && readChunk) {
    const offset = headerInteger(req, "x-file-offset"), total = headerInteger(req, "x-file-total"), finalHeader = req.headers.get("x-file-final");
    if (req.headers.get("content-type") !== "application/octet-stream" || offset === null || total === null || !["true", "false"].includes(finalHeader ?? "")) return err("Invalid file chunk headers.", 400);
    const bounded = await readBodyCapped(req, MAX_FILE_CHUNK);
    if (!bounded.ok) return bounded.response;
    const bytes = bounded.bytes;
    let id: string;
    try { id = decodeURIComponent(readChunk[1]!); } catch { return err("Invalid file action ID.", 400); }
    try {
      if (!await service.completeFileReadChunk(id, offset, total, bytes, finalHeader === "true")) return err("File chunk was rejected.", 409);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch { return err("File action is unavailable.", 503); }
  }
  const writeChunk = /^\/api\/extensions\/file-actions\/([^/]+)\/write-chunk$/.exec(url.pathname);
  if (req.method === "GET" && writeChunk) {
    const rawOffset = url.searchParams.get("offset");
    const offset = rawOffset && /^(0|[1-9]\d*)$/.test(rawOffset) ? Number(rawOffset) : NaN;
    let id: string;
    try { id = decodeURIComponent(writeChunk[1]!); } catch { return err("Invalid file action ID.", 400); }
    if (!Number.isSafeInteger(offset) || offset < 0) return err("Invalid file chunk offset.", 400);
    const chunk = await service.fileWriteChunk(id, offset);
    if (!chunk) return err("File chunk is unavailable.", 404);
    const bytes = new ArrayBuffer(chunk.bytes.byteLength); new Uint8Array(bytes).set(chunk.bytes);
    return new Response(bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-file-total": String(chunk.totalBytes), "x-file-final": String(chunk.final), "x-file-digest": chunk.digest } });
  }
  if (req.method !== "POST") return err("Method not allowed.", 405);
  const body = await readJsonObject(req, BODY_LIMIT);
  if (!body.ok) return body.response;
  try {
    const value = body.value;
    if (url.pathname === "/api/extensions/scene-opened") {
      const parsed = sceneOpened.parse(value);
      const notified = await service.notifySceneOpened(parsed.sceneId, parsed.navigationTicketId ?? null);
      return notified ? json({ notified: true }) : err("Scene navigation is no longer active.", 409);
    }
    if (url.pathname === "/api/extensions/answer-effect") {
      const parsed = effectAnswer.parse(value);
      if (!await service.answerEffect(parsed.id, parsed.approved)) return err("Approval request expired or was already answered.", 409);
      return json({ answered: true });
    }
    if (url.pathname === "/api/extensions/answer-file-action") {
      const parsed = fileAnswer.parse(value);
      if (!await service.answerFileAction(parsed.id, parsed.result)) return err("File action expired or no longer matches its host review.", 409);
      return json({ answered: true });
    }
    if (url.pathname === "/api/extensions/begin-file-write") {
      const parsed = oneId.parse(value);
      return json({ begun: await service.beginFileWrite(parsed.id) });
    }
    if (url.pathname === "/api/extensions/answer-host-action") {
      const parsed = hostActionAnswer.parse(value);
      if (!await service.answerHostAction(parsed.id, parsed.answer)) return err("Host action expired or no longer matches its extension run.", 409);
      return json({ answered: true });
    }
    if (url.pathname === "/api/extensions/claim-host-action") {
      const parsed = oneId.parse(value);
      const ticket = await service.claimHostAction(parsed.id);
      return ticket ? json(pendingExtensionHostActionSchema.parse(ticket)) : err("Host action expired or no longer matches its extension run.", 409);
    }
    if (url.pathname === "/api/extensions/preview") {
      const parsed = envelope.parse(value);
      return json(await service.preview(parsed.input));
    }
    if (url.pathname === "/api/extensions/install") {
      const parsed = install.parse(value);
      return json(await service.install(parsed.challenge, grantList(parsed.grants), parsed.themeScopes, parsed.expectedRevision));
    }
    if (url.pathname === "/api/extensions/preview-installed") return json(await service.previewInstalled(oneId.parse(value).id));
    if (url.pathname === "/api/extensions/settings/read") return json(await service.readSettings(oneId.parse(value).id));
    if (url.pathname === "/api/extensions/settings/write") {
      const parsed = settingsWrite.parse(value);
      return json(await service.writeSettings(parsed.id, decodeJsonValue(parsed.value), parsed.expectedRevision));
    }
    if (url.pathname === "/api/extensions/grants") {
      const parsed = grants.parse(value);
      return json(await service.setGrants(parsed.id, parsed.challenge, grantList(parsed.grants), parsed.themeScopes, parsed.expectedRevision));
    }
    if (["enable", "disable", "revoke"].some((action) => url.pathname === `/api/extensions/${action}`)) {
      const parsed = mutation.parse(value);
      if (url.pathname === "/api/extensions/enable") return json(await service.enable(parsed.id, parsed.expectedRevision));
      if (url.pathname === "/api/extensions/disable") return json(await service.disable(parsed.id, parsed.expectedRevision));
      return json(await service.revoke(parsed.id, parsed.expectedRevision));
    }
    if (url.pathname === "/api/extensions/uninstall") {
      const parsed = mutation.parse(value);
      return json({ uninstalled: await service.uninstall(parsed.id, parsed.expectedRevision) });
    }
    if (url.pathname === "/api/extensions/activate") {
      const parsed = activated.parse(value);
      return json(await service.activate(parsed.id, parsed.kind, parsed.contributionId, decodeJsonValue(parsed.input), undefined, undefined, parsed.hostContext));
    }
    if (url.pathname === "/api/extensions/prompt-preview") {
      const parsed = promptPreview.parse(value);
      return json(extensionPromptPreviewSchema.parse(await service.previewPrompts(parsed.sceneId, parsed.draft, req.signal)));
    }
    return err("Unknown extension operation.", 404);
  } catch (error) {
    return routeFailure(error, url.pathname);
  }
}
