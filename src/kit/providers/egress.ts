/**
 * The egress gate: fail-closed. Kit sends nothing until a provider is set up with what it needs, and
 * then only to that provider's host. Every adapter is handed the guardedFetch below, so it is the one
 * choke point where a request leaves the machine, the place to lock the destination and redact logs. A link a person
 * typed has no fixed host, so it has its own door below, guardedFetchVetted, which vets the address instead.
 */
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { ProviderConfig } from "./config";
import type { ProviderSpoke } from "./spoke";

/** Thrown when Kit would send before setup, or anywhere it must not. Fails closed, loudly. */
export class EgressBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlocked";
  }
}

/** Fail closed: the config must point at a known provider that has what it needs to send. */
export function assertReady(
  config: ProviderConfig,
  spoke: ProviderSpoke | undefined,
): asserts spoke is ProviderSpoke {
  if (!spoke) {
    throw new EgressBlocked(`unknown provider "${config.kind}".`);
  }
  if (!spoke.keyless && !config.apiKey) {
    throw new EgressBlocked(`${config.name ?? spoke.label} needs an API key before it can send.`);
  }
}

/** The one host this config may reach: the spoke's fixed host, else the user's base URL host. */
export function allowedHost(config: ProviderConfig, spoke: ProviderSpoke): string {
  const url = spoke.host ? `https://${spoke.host}` : config.baseURL || spoke.defaultBaseURL;
  if (!url) {
    throw new EgressBlocked("a custom endpoint needs a base URL.");
  }
  return new URL(url).host;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function assertDestination(url: URL, host: string, previous?: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EgressBlocked(`refused ${url.protocol} provider URL.`);
  }
  if (url.host !== host) {
    throw new EgressBlocked(`refused to reach ${url.host}; Kit only talks to ${host}.`);
  }
  if (previous?.protocol === "https:" && url.protocol !== "https:") {
    throw new EgressBlocked("refused to downgrade a provider redirect from HTTPS.");
  }
}

function redirectedRequest(request: Request, url: URL, status: number): Request {
  const becomesGet =
    (status === 303 && request.method !== "HEAD") ||
    ((status === 301 || status === 302) && request.method === "POST");
  if (!becomesGet) return new Request(url, request);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  return new Request(url, { method: "GET", headers, signal: request.signal });
}

/** A fetch that validates the configured host before every network hop. */
export function guardedFetch(host: string, fetchImpl: FetchLike = globalThis.fetch, assertCurrent?: () => Promise<void>): FetchFunction {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let request = new Request(input, init);
    let previous: URL | undefined;
    for (let redirects = 0; ; redirects += 1) {
      const target = new URL(request.url);
      assertDestination(target, host, previous);
      await assertCurrent?.();
      const response = await fetchImpl(request.clone(), { redirect: "manual" });
      if (!REDIRECTS.has(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects >= MAX_REDIRECTS) {
        throw new EgressBlocked(`refused more than ${MAX_REDIRECTS} provider redirects.`);
      }
      const next = new URL(location, target);
      assertDestination(next, host, target);
      request = redirectedRequest(request, next, response.status);
      previous = target;
    }
  };
  // Bun's `typeof fetch` requires a `preconnect` method the AI SDK request path never calls.
  return wrapped as unknown as FetchFunction;
}

// ---- The vetted-URL door: a link the person typed, whose host cannot be known in advance. ----

/** True for an address that is not a public host (loopback, private, link-local, CGNAT, multicast, reserved, unparseable). */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff") || lower.startsWith("2001:db8");
  }
  return true;
}

/** A typed link, vetted: https, no credentials, the default port. Throws EgressBlocked with words for the person. */
export function vetUserUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new EgressBlocked("That is not a link."); }
  if (url.protocol !== "https:") throw new EgressBlocked("Only https links can be added.");
  if (url.username || url.password) throw new EgressBlocked("A link with a login in it cannot be added.");
  if (url.port && url.port !== "443") throw new EgressBlocked("Only links on the usual https port can be added.");
  return url;
}

export const VETTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type VettedMethod = (typeof VETTED_METHODS)[number];
/** One request to a vetted address: connect to `address`, keep `url`'s name for the Host header and certificate check. */
export interface VettedRequest { url: URL; address: string; headers: Record<string, string>; signal: AbortSignal; method?: VettedMethod; body?: Uint8Array }
export interface VettedDeps {
  resolve(host: string): Promise<string[]>;
  send(req: VettedRequest): Promise<Response>;
}
export interface VettedOptions {
  signal?: AbortSignal;
  /** Recheck the caller's live capability principal after DNS validation and before each socket request. */
  assertCurrent?: () => Promise<void>;
  headers?: Record<string, string>;
  method?: VettedMethod;
  body?: Uint8Array;
  /** Extra check on the first URL and every redirect hop; throws EgressBlocked to refuse. */
  vetUrl?: (url: URL) => void;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

const NO_BODY = new Set([101, 204, 205, 304]);
const MAX_VETTED_REQUEST_BYTES = 1_048_576;

/** The real transport: node:https with the lookup pinned, so the connection cannot resolve the name a second time. */
export const pinnedSender = (request: typeof httpsRequest = httpsRequest) => ({ url, address, headers, signal, method = "GET", body }: VettedRequest): Promise<Response> =>
  new Promise((resolve, reject) => {
    const family = isIP(address);
    const req = request(
      {
        hostname: url.hostname, port: 443, path: url.pathname + url.search, method, signal,
        headers: { ...headers, "accept-encoding": "identity" },
        lookup: (_host, options, done) => (options.all ? (done as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]) : done(null, address, family)),
      },
      (res) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, item);
        const status = res.statusCode ?? 502;
        resolve(new Response(NO_BODY.has(status) ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status, headers: out }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });

const realVetted: VettedDeps = {
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  send: pinnedSender(),
};

function capped(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > maxBytes) throw new EgressBlocked("That file is too large to fetch.");
      controller.enqueue(chunk);
    },
  }));
}

/**
 * The one door for a URL a person typed. Resolves the name once, refuses unless every answer is public, connects to that
 * vetted address with the original name for Host and TLS (no second lookup, so DNS rebinding has no gap), re-vets every
 * redirect hop the same way, and caps time and bytes. Returns the final response and URL.
 */
export async function guardedFetchVetted(raw: string, opts: VettedOptions = {}, deps: VettedDeps = realVetted): Promise<{ response: Response; url: URL }> {
  const signal = AbortSignal.any([opts.signal ?? new AbortController().signal, AbortSignal.timeout(opts.timeoutMs ?? 30_000)]);
  const maxRedirects = opts.maxRedirects ?? 3;
  const method = opts.method ?? "GET";
  if (!VETTED_METHODS.includes(method)) throw new EgressBlocked("That request method is not supported.");
  if (opts.body && method === "GET") throw new EgressBlocked("A GET request cannot include a body.");
  if ((opts.body?.byteLength ?? 0) > MAX_VETTED_REQUEST_BYTES) throw new EgressBlocked("That request body is too large.");
  let url = vetUserUrl(raw);
  opts.vetUrl?.(url);
  for (let hop = 0; ; hop++) {
    const addresses = isIP(url.hostname) ? [url.hostname.replace(/^\[|\]$/g, "")] : await deps.resolve(url.hostname);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new EgressBlocked("That link points at a private or local address, so it was not fetched.");
    signal.throwIfAborted();
    await opts.assertCurrent?.();
    signal.throwIfAborted();
    const response = await deps.send({ url, address: addresses[0]!, headers: opts.headers ?? {}, signal, method, body: opts.body });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      // Replaying a mutating request on a redirect can duplicate an irreversible remote effect.
      if (method !== "GET") throw new EgressBlocked("That request was not redirected because replay could repeat its effect.");
      if (!next || hop >= maxRedirects) throw new EgressBlocked("That link redirected too many times.");
      url = vetUserUrl(new URL(next, url).href);
      opts.vetUrl?.(url);
      continue;
    }
    const responseBody = response.body ? capped(response.body, opts.maxBytes ?? 256 * 1024 * 1024) : null;
    return { response: new Response(responseBody, response), url };
  }
}
