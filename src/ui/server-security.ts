/**
 * UI server security: session token, Host/Origin gates, body caps, HTML CSP injection.
 * Extracted from server.ts (behavior-preserving).
 */
import { isColdReadLimit } from "../stage/contracts/content-store";
import { createHash, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { toErrorMessage } from "../error-message";

import { pumpStream } from "../core/stream-bytes";
import { fileSink } from "./server-body";
import { STALE_SESSION } from "./_shared/session-marker";

/** Re-exported so callers that already import from this module keep one import. */
export { STALE_SESSION } from "./_shared/session-marker";
import { ADAPTER_INPUT_MAX_BYTES } from "../core/adapter-input";
import { hasErrorName } from "../core/guards";
import { isLibraryLocked, isStudioNotFoundError, isSceneCastMissingError, isStudioBusyError, isStudioReadError, STUDIO_BUSY_CODE, isStudioValidationError, isStudioConflictError, isStudioWriteError } from "../studio/errors";
import { err, json, refusal, refuseDeclaredLength } from "./server-extension-http";
export { err, json, readBodyCapped, readJsonObject } from "./server-extension-http";


/** Inspect upload ceiling (bytes): the same file ceiling every other door uses, so a file the studio
 *  accepts is never one Kit's importer refuses. JSON routes use a lower cap. */
export const INSPECT_BODY_MAX = ADAPTER_INPUT_MAX_BYTES;

export interface UiSecurityContext {
  /** Public per-server ownership identity, independent of the session bearer. */
  instanceId: string;
  /** Per-launch bearer; never log or persist. */
  token: string;
  /** Exact Host header expected (e.g. 127.0.0.1:8321). Filled after bind. */
  expectedHost: string;
  /** Exact Origin expected (e.g. http://127.0.0.1:8321). Filled after bind. */
  expectedOrigin: string;
}

export function createSecurityContext(): UiSecurityContext {
  return {
    token: randomBytes(32).toString("base64url"),
    instanceId: randomUUID(),
    expectedHost: "",
    expectedOrigin: "",
  };
}

/** The shape of an id in a body or query: letters, digits, underscores and hyphens. */
export const ROUTE_ID = /^[\w-]+$/;

/** Retryable refusal: 503, a stable code the client recognises, and how soon to ask again. */
const busy = (message: string): Response => {
  const res = json({ error: message, code: STUDIO_BUSY_CODE }, 503);
  res.headers.set("retry-after", "1");
  return res;
};
export const textResponse = (body: string, type: string, extraHeaders?: Record<string, string>): Response =>
  new Response(body, { headers: { "content-type": type, ...extraHeaders } });

/** The interchangeable spellings of the loopback host we bind. The Host/Origin gate exists to
 * stop DNS-rebinding from ATTACKER hostnames; rejecting `localhost` only paper-cuts a user with a
 * localhost bookmark while protecting nothing - all three resolve to the same loopback interface
 * the server is bound to. */
const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

/** True when `host` is a loopback-equivalent spelling of the expected `host:port`. */
export function hostAllowed(host: string, expectedHost: string): boolean {
  if (host === expectedHost) return true;
  const port = expectedHost.split(":").pop() ?? "";
  return LOOPBACK_NAMES.some((n) => host === `${n}:${port}`);
}

/** True when `origin` is a loopback-equivalent spelling of the expected `http://host:port`. */
export function originAllowed(origin: string | null, expectedOrigin: string): boolean {
  if (origin === null) return false;
  if (origin === expectedOrigin) return true;
  const port = expectedOrigin.split(":").pop() ?? "";
  return LOOPBACK_NAMES.some((n) => origin === `http://${n}:${port}`);
}

const HTML_SECURITY_HEADERS_BASE: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/**
 * The sha256 CSP source for every inline <script> in the served HTML. Computed from the real
 * markup, never hand-baked: a pinned hash rots the moment the import map changes, and a rotted
 * hash does not degrade - it takes the whole app down (the import map is how React resolves).
 */
export function inlineScriptHashes(html: string): string {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const digest = createHash("sha256").update(m[1]!, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes.join(" ");
}

/** Build HTML CSP; when sandboxOrigin is set, worker-src may load the distinct-origin module worker. */
export function htmlSecurityHeaders(sandboxOrigin = "", scriptHashes = ""): Record<string, string> {
  const workerExtra =
    sandboxOrigin && sandboxOrigin.startsWith("http://127.0.0.1:") ? ` ${sandboxOrigin}` : "";
  const inline = scriptHashes ? ` ${scriptHashes}` : "";
  return {
    ...HTML_SECURITY_HEADERS_BASE,
    "content-security-policy":
      // Inline scripts stay blocked except the exact hashes of what we serve (the import map).
      `default-src 'self'; script-src 'self'${inline}; style-src 'self' 'unsafe-inline'; ` +
      "img-src 'self' data: blob:; connect-src 'self'; " +
      `worker-src 'self' blob:${workerExtra}; ` +
      "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
}

/** Inject per-launch session meta into served HTML. Escapes content attribute. */
export function injectSessionMeta(html: string, token: string): string {
  const safe = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const tag = `<meta name="vaude-session" content="${safe}">`;
  if (html.includes('name="vaude-session"')) {
    return html.replace(/<meta\s+name="vaude-session"[^>]*>/i, tag);
  }
  if (html.includes("</head>")) return html.replace("</head>", `${tag}\n</head>`);
  return tag + html;
}

/**
 * Inject sandbox origin meta (public, not a secret). Never confuses this with the session token.
 * Empty origin removes any stale tag so the UI falls back to same-origin worker.
 */
export function injectSandboxOriginMeta(html: string, sandboxOrigin: string): string {
  const re = /<meta\s+name="vaude-sandbox-origin"[^>]*>\s*/gi;
  let out = html.replace(re, "");
  const origin = sandboxOrigin.trim();
  if (!origin) return out;
  if (!origin.startsWith("http://127.0.0.1:")) {
    throw new Error("server: sandbox origin must be http://127.0.0.1:<port>");
  }
  const safe = origin.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const tag = `<meta name="vaude-sandbox-origin" content="${safe}">`;
  if (out.includes("</head>")) return out.replace("</head>", `${tag}\n</head>`);
  return tag + out;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Stream a request body straight to a file with the same cap contract as readBodyCapped, holding one chunk at a
 * time: a `.lvbak` can be multi-gigabyte by design. The caller owns `destPath`'s lifecycle (its directory, and
 * removing non-exclusive files whether this succeeds or fails). Exclusive sinks remove their own
 * incomplete file; a declared-length refusal never opens or removes the destination.
 */
export async function streamBodyToFile(
  req: Request,
  destPath: string,
  limit: number,
  file: { mode?: number; flags?: "w" | "wx" } = {},
): Promise<{ ok: true; bytes: number } | { ok: false; response: Response }> {
  if (req.signal.aborted) {
    void req.body?.cancel().catch(() => undefined);
    return { ok: false, response: refusal("aborted") };
  }
  const refused = refuseDeclaredLength(req, limit);
  if (refused) return { ok: false, response: refused };
  const result = await pumpStream(req.body, await fileSink(destPath, file.mode, file.flags), { limit, signal: req.signal });
  return result.ok ? result : { ok: false, response: refusal(result.reason) };
}

/**
 * The "require a JSON object body" sequence nearly every mutating route repeated by hand: a
 * content-type check, a capped read, and an object-shape check. 415 on the wrong content type, the
 * readJsonCapped failure response unchanged on a body or parse problem, 400 when the parsed JSON is
 * not an object (an array, a string, a number, or null) - the check some call sites skipped,
 * casting straight into a typed shape instead.
 */
/** A required, non-empty string field from a parsed JSON object, or a 400 naming it. */
export function requireStringField(obj: Record<string, unknown>, key: string): string | Response {
  const v = obj[key];
  return typeof v === "string" && v ? v : err(`expected { ${key} }`, 400);
}

/**
 * Refuses a foreign-page GET/HEAD; shared by every /api/* gate below. A mutating method cannot demand
 * the token on GET (an <img src> sends no headers), so any page the person has open, including one on
 * another 127.0.0.1 port (same-site, not cross-site), could fire blind requests at the Studio while it is
 * unlocked: image-load and timing oracles for what exists (there are no CORS headers, so the body itself
 * is not readable). Sec-Fetch-Site is browser-set and unforgeable from a page, so only "same-origin"
 * (the app's own fetches) and "none" (the address bar) pass, exactly as browsers spell them; any other value, known or not, is refused.
 * The sandbox origin gets no exception: it never calls /api (ADR-009). A header-less request is a CLI or
 * test client and passes, except on the trusted loopback listener, where a request with a Mozilla
 * User-Agent and no Sec-Fetch-Site is refused: the desktop webview and every current browser send it on
 * 127.0.0.1. LAN pages are plain http on a non-loopback IP, where browsers send no Sec-Fetch headers at
 * all, so `browsersMustDeclareSite` stays off there.
 */
function refuseForeignRead(req: Request, browsersMustDeclareSite = false): Response | null {
  const site = req.headers.get("sec-fetch-site") ?? "";
  if (site !== "" && site !== "same-origin" && site !== "none") return err("forbidden", 403);
  if (browsersMustDeclareSite && site === "" && (req.headers.get("user-agent") ?? "").startsWith("Mozilla/")) {
    return err("forbidden", 403);
  }
  return null;
}

/** Requires the per-launch session token on a state-changing method; shared by the gates that have
 *  no richer story to tell about a wrong token (checkApiRequest's own is deliberately richer). */
function checkToken(req: Request, expected: string): Response | null {
  const token = req.headers.get("x-bunzai-token") ?? "";
  if (!tokensEqual(token, expected)) return err("forbidden", 403);
  return null;
}

/** Host / Origin / token gate for /api/* routes. */
export function checkApiRequest(
  req: Request,
  sec: UiSecurityContext,
): Response | null {
  if (!sec.expectedHost || !sec.expectedOrigin || !sec.token) {
    return err("server not ready", 503);
  }
  const host = req.headers.get("host") ?? "";
  if (!hostAllowed(host, sec.expectedHost)) return err("forbidden", 403);

  if (req.method === "GET" || req.method === "HEAD") return refuseForeignRead(req, true);

  if (req.method === "POST" || req.method === "PATCH") {
    const origin = req.headers.get("origin");
    // Same-origin mutations from the app should send Origin. Missing Origin fails closed.
    if (!originAllowed(origin, sec.expectedOrigin)) return err("forbidden", 403);
    const token = req.headers.get("x-bunzai-token") ?? "";
    /**
     * A PRESENTED-BUT-WRONG TOKEN IS ALMOST ALWAYS A RESTARTED SERVER, and saying so is the whole
     * fix for a trap that cost a full evening. The token is minted per launch and baked into the
     * page; restarting replaces the process WITHOUT reloading the page, so the tab goes on
     * presenting a token from a process that no longer exists. Every send then failed with a bare
     * "forbidden", which reads as a network fault - so the obvious response was to press Restart
     * again, which minted another token and stranded the tab further. Nine times, in the field.
     *
     * NAMED, NOT WIDENED. This still refuses, with the same status; it only distinguishes "your page
     * is older than this server" from "you may not do this at all", so the client can reload itself
     * instead of retrying forever. Somebody presenting NO token learns nothing new - an empty token
     * was never going to be right - and the remote and LAN paths below are deliberately left alone.
     */
    if (!tokensEqual(token, sec.token)) {
      return err(token ? STALE_SESSION : "forbidden", 403);
    }
    return null;
  }
  return err("method not allowed", 405);
}

/**
 * Gate for the UNTRUSTED remote listener (the sidecar's data plane). Auth is the shared secret the
 * sidecar stamps on every request it forwards, and only the sidecar, which has already gated the caller
 * down to the studio owner, knows it, plus the session token on state-changing methods (CSRF). There is
 * no Host/Origin check here: the Host is the .ts.net name, and an unforgeable per-boot secret is a
 * stronger gate than a loopback host name would be. A local process hitting this port directly, or a
 * DNS-rebinding page, has no secret, so it fails closed.
 */
export function checkRemoteApiRequest(
  req: Request,
  sec: UiSecurityContext,
  secret: string,
): Response | null {
  if (!sec.token || !secret) return err("server not ready", 503);
  const presented = req.headers.get("x-bunzai-sidecar-secret") ?? "";
  if (!tokensEqual(presented, secret)) return err("forbidden", 403);

  if (req.method === "GET" || req.method === "HEAD") return refuseForeignRead(req);
  if (req.method === "POST" || req.method === "PATCH") return checkToken(req, sec.token);
  return err("method not allowed", 405);
}

/**
 * Gate for the LAN listener's app requests, used ONLY after the LanHost has verified the connect code
 * AND the host approved the device (that flow is the LAN auth). Here we add only CSRF, the token on
 * state-changing methods, plus the cross-site block. No Host/Origin check: the Host is the LAN IP.
 */
export function checkLanApiRequest(req: Request, sec: UiSecurityContext): Response | null {
  if (!sec.token) return err("server not ready", 503);
  if (req.method === "GET" || req.method === "HEAD") return refuseForeignRead(req);
  if (req.method === "POST" || req.method === "PATCH") return checkToken(req, sec.token);
  return err("method not allowed", 405);
}

export function contentTypeIs(req: Request, expected: string): boolean {
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  return ct === expected;
}

/** Map storage failures to status codes without leaking paths. */
export const studioErr = (e: unknown): Response => {
  // Locked first: the shell shows the stage door on 423.
  if (isLibraryLocked(e)) return err("the library is locked", 423);
  if (isStudioValidationError(e)) return err(e.message, 400);
  if (isSceneCastMissingError(e)) return json({ error: e.message, code: e.code }, 410);
  if (isStudioNotFoundError(e)) return err(e.message, 404);
  if (isStudioBusyError(e)) return busy(e.message);
  if (isStudioReadError(e)) return err(e.message, 409);
  if (isStudioConflictError(e)) return err(e.message, 409);
  if (isStudioWriteError(e)) return err(e.message, 500);
  // A piece of many pictures is too big to open whole: say so (413), not a technical 500.
  if (isColdReadLimit(e)) return err("This piece is too large to open all at once. Its pictures can still be edited, copied, printed and exported one at a time.", 413);
  const msg = toErrorMessage(e, "internal error");
  // never echo absolute paths from unexpected errors
  const safe = /[A-Za-z]:\\|\/(?:Users|home|tmp|var)\//.test(msg) ? "internal error" : msg;
  // By name (D18): the library is busy in another window, or otherwise cannot be written right now.
  if (e instanceof Error && hasErrorName(e, "StageDatabaseError")) return err(safe, 503);
  return err(safe, 500);
};

/**
 * Hand a validated http(s) URL to the OS default browser. Spawns with an argv ARRAY (never a shell
 * string) so a crafted URL cannot inject a command; the caller has already scheme-validated via
 * safeExternalUrl. The launcher itself is not a boundary (it would open file:// too) - the allowlist
 * that ran before this is. Fire-and-forget; a failed launch is not worth crashing the request.
 */
export const openInBrowser = (href: string): void => {
  const argv =
    process.platform === "win32"
      ? ["rundll32", "url.dll,FileProtocolHandler", href]
      : process.platform === "darwin"
        ? ["open", href]
        : ["xdg-open", href];
  try {
    Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore", windowsHide: true });
  } catch {
    // a missing launcher on an exotic OS is a degraded experience, not a server fault
  }
};

/**
 * Open a local folder/file in the OS file manager (argv array, never a shell string; fire-and-forget).
 * Used to hand a downloaded, checksum-verified build to the user. The caller passes an absolute local
 * path it produced, never untrusted input, so there is no allowlist here (unlike openInBrowser's URLs).
 */
export const openPath = (path: string): void => {
  const argv =
    process.platform === "win32"
      ? ["explorer", path]
      : process.platform === "darwin"
        ? ["open", path]
        : ["xdg-open", path];
  try {
    Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore", windowsHide: true });
  } catch {
    // a missing file manager is a degraded experience, not a server fault
  }
};
