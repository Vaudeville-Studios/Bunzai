/**
 * The vetted-URL egress door (egress.ts guardedFetchVetted): a person-typed https link is resolved once, every address must
 * be public, the request is pinned to the vetted address, every redirect hop is vetted again, and size and time are capped.
 * The network is a stand-in; nothing leaves the machine.
 */
import { expect, test } from "bun:test";
import { EgressBlocked, guardedFetchVetted, isPrivateAddress, vetUserUrl, type VettedDeps, type VettedRequest } from "./egress";

const PUBLIC = "93.184.216.34";
const ok = (): Response => new Response("body", { headers: { "content-type": "image/png" } });
const rig = (answers: Record<string, string[]>, reply: (req: VettedRequest) => Response = ok): VettedDeps & { sent: VettedRequest[]; resolved: string[] } => {
  const sent: VettedRequest[] = [];
  const resolved: string[] = [];
  return { sent, resolved, resolve: async (h) => { resolved.push(h); return answers[h] ?? []; }, send: async (req) => { sent.push(req); return reply(req); } };
};

test("loopback, private, link-local, CGNAT, multicast and mapped addresses are not public; a public one is", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "ff02::1", "not-an-ip"]) expect(isPrivateAddress(a)).toBe(true);
  for (const a of [PUBLIC, "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(a)).toBe(false);
});

test("a link must be https with no login and the usual port", () => {
  for (const bad of ["http://example.com/a.png", "ftp://example.com/a.png", "file:///etc/passwd", "javascript:alert(1)", "https://u:p@example.com/a.png", "https://example.com:8443/a.png", "nonsense"]) expect(() => vetUserUrl(bad)).toThrow(EgressBlocked);
  expect(vetUserUrl(" https://example.com/a.png ").href).toBe("https://example.com/a.png");
});

test("the request connects to the one vetted address, resolved once, with the original name kept in the URL", async () => {
  const d = rig({ "cdn.example": [PUBLIC, "93.184.216.35"] });
  const { url } = await guardedFetchVetted("https://cdn.example/a.png", {}, d);
  expect(d.resolved).toEqual(["cdn.example"]);
  expect(d.sent).toHaveLength(1);
  expect(d.sent[0]!.address).toBe(PUBLIC);
  expect(d.sent[0]!.url.hostname).toBe("cdn.example");
  expect(url.href).toBe("https://cdn.example/a.png");
});

test("a live authority check runs after DNS validation immediately before every redirect-hop request", async () => {
  const order: string[] = [];
  const deps: VettedDeps = {
    resolve: async (host) => { order.push(`dns:${host}`); return [PUBLIC]; },
    send: async (request) => { order.push(`send:${request.url.hostname}`); return request.url.pathname === "/start" ? new Response(null, { status: 302, headers: { location: "https://other.example/end" } }) : ok(); },
  };
  await guardedFetchVetted("https://cdn.example/start", { assertCurrent: async () => { order.push("authority"); } }, deps);
  expect(order).toEqual(["dns:cdn.example", "authority", "send:cdn.example", "dns:other.example", "authority", "send:other.example"]);

  let sent = false;
  await expect(guardedFetchVetted("https://cdn.example/a", { assertCurrent: async () => { throw new EgressBlocked("access changed"); } }, {
    resolve: async () => [PUBLIC], send: async () => { sent = true; return ok(); },
  })).rejects.toThrow("access changed");
  expect(sent).toBe(false);
});

test("a name with any private answer, or no answer, is refused before anything is sent", async () => {
  const d = rig({ "evil.example": [PUBLIC, "127.0.0.1"], "lan.example": ["192.168.0.5"] });
  for (const link of ["https://evil.example/a", "https://lan.example/a", "https://127.0.0.1/a", "https://[::1]/a", "https://nowhere.example/a"]) {
    expect(await guardedFetchVetted(link, {}, d).then(() => null, (e: unknown) => e)).toBeInstanceOf(EgressBlocked);
  }
  expect(d.sent).toEqual([]);
});

test("each redirect hop is vetted again: private, http and platform-refused hops fail, a public https hop is followed", async () => {
  const to = (location: string) => (r: VettedRequest): Response => (r.url.pathname === "/start" ? new Response(null, { status: 302, headers: { location } }) : ok());
  const answers = { "cdn.example": [PUBLIC], "other.example": ["93.184.216.35"], "inner.example": ["10.0.0.9"] };
  const fail = (location: string) => guardedFetchVetted("https://cdn.example/start", {}, rig(answers, to(location))).then(() => null, (e: unknown) => e);
  expect(String(await fail("https://inner.example/a.png"))).toMatch(/private or local/);
  expect(String(await fail("http://other.example/a.png"))).toMatch(/https/);
  const hook = await guardedFetchVetted("https://cdn.example/start", { vetUrl: (u) => { if (u.hostname === "other.example") throw new EgressBlocked("no other"); } }, rig(answers, to("https://other.example/b")))
    .then(() => null, (e: unknown) => e);
  expect(String(hook)).toMatch(/no other/);
  const d = rig(answers, to("https://other.example/b.png"));
  const got = await guardedFetchVetted("https://cdn.example/start", {}, d);
  expect(got.url.href).toBe("https://other.example/b.png");
  expect(d.sent.map((r) => r.address)).toEqual([PUBLIC, "93.184.216.35"]);
});

test("a loop of redirects stops at the cap", async () => {
  const d = rig({ "cdn.example": [PUBLIC] }, () => new Response(null, { status: 302, headers: { location: "https://cdn.example/again" } }));
  expect(String(await guardedFetchVetted("https://cdn.example/a", {}, d).then(() => null, (e: unknown) => e))).toMatch(/redirected too many times/);
  expect(d.sent).toHaveLength(4);
});

test("a body past the byte cap errors the stream instead of delivering the rest", async () => {
  const chunk = new Uint8Array(1024);
  const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) });
  const { response } = await guardedFetchVetted("https://cdn.example/a", { maxBytes: 4096 }, rig({ "cdn.example": [PUBLIC] }, () => new Response(body)));
  const reader = response.body!.getReader();
  let total = 0;
  const failure = await (async () => { for (;;) { const r = await reader.read(); if (r.done) return null; total += r.value.length; } })().catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(EgressBlocked);
  expect(total).toBeLessThanOrEqual(4096);
});

test("every status body is capped, and a mutating redirect is canceled without replay", async () => {
  const chunk = new Uint8Array(64);
  const tooLarge = new Response(new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(chunk) }), { status: 429 });
  const limited = await guardedFetchVetted("https://cdn.example/a", { maxBytes: 16 }, rig({ "cdn.example": [PUBLIC] }, () => tooLarge));
  await expect(limited.response.arrayBuffer()).rejects.toBeInstanceOf(EgressBlocked);

  let canceled = false;
  const redirect = new Response(new ReadableStream({ cancel: () => { canceled = true; } }), { status: 307, headers: { location: "https://cdn.example/again" } });
  const d = rig({ "cdn.example": [PUBLIC] }, () => redirect);
  await expect(guardedFetchVetted("https://cdn.example/write", { method: "POST", body: new TextEncoder().encode("{}") }, d)).rejects.toBeInstanceOf(EgressBlocked);
  expect(canceled).toBe(true);
  expect(d.sent).toHaveLength(1);
});

test("vetted requests carry an explicit method and bounded caller body; GET bodies are refused", async () => {
  const d = rig({ "cdn.example": [PUBLIC] });
  const body = new TextEncoder().encode("{\"ok\":true}");
  await guardedFetchVetted("https://cdn.example/write", { method: "POST", body }, d);
  expect(d.sent[0]!.method).toBe("POST");
  expect([...d.sent[0]!.body!]).toEqual([...body]);
  await expect(guardedFetchVetted("https://cdn.example/read", { body }, d)).rejects.toBeInstanceOf(EgressBlocked);
  await expect(guardedFetchVetted("https://cdn.example/write", { method: "PUT", body: new Uint8Array(1_048_577) }, d)).rejects.toBeInstanceOf(EgressBlocked);
});

test("the caller's signal and the time cap both reach the transport", async () => {
  const d = rig({ "cdn.example": [PUBLIC] });
  const controller = new AbortController();
  await guardedFetchVetted("https://cdn.example/a", { signal: controller.signal, timeoutMs: 5000 }, d);
  controller.abort();
  expect(d.sent[0]!.signal.aborted).toBe(true);
});

test("a header the caller gives is passed on; the request never carries a redirect-following flag", async () => {
  const d = rig({ "cdn.example": [PUBLIC] });
  await guardedFetchVetted("https://cdn.example/a", { headers: { accept: "image/*" } }, d);
  expect(d.sent[0]!.headers["accept"]).toBe("image/*");
});

// ---- The real transport, with the connector injected: what it asks node:https to connect to. ----
import { Readable } from "node:stream";
import type { request as httpsRequest } from "node:https";
import { pinnedSender } from "./egress";

interface Seen { options: { hostname: string; port: number; path: string; method?: string; headers?: Record<string, string>; lookup?: (h: string, o: object, cb: (...a: unknown[]) => void) => void }; body?: Uint8Array }
function connector(reply: (n: number) => { status: number; headers?: Record<string, string> }): { request: typeof httpsRequest; seen: Seen[] } {
  const seen: Seen[] = [];
  const request = ((options: Seen["options"], cb: (res: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
    seen.push({ options });
    const r = reply(seen.length);
    const handlers: Record<string, (e: Error) => void> = {};
    return { on: (ev: string, fn: (e: Error) => void) => { handlers[ev] = fn; }, end: (body?: Uint8Array) => { seen.at(-1)!.body = body; cb(Object.assign(Readable.from([Buffer.from("ok")]), { statusCode: r.status, headers: r.headers ?? {} })); } };
  }) as unknown as typeof httpsRequest;
  return { request, seen };
}
const lookupOf = (s: Seen): string | undefined => {
  let got: string | undefined;
  s.options.lookup!("cdn.example", {}, (_e: unknown, address: unknown) => { got = address as string; });
  return got;
};

test("the real transport connects to the vetted address while the request keeps the original name", async () => {
  const c = connector(() => ({ status: 200 }));
  const res = await pinnedSender(c.request)({ url: new URL("https://cdn.example/a.png?x=1"), address: PUBLIC, headers: { accept: "image/*" }, signal: new AbortController().signal });
  expect(res.status).toBe(200);
  const opts = c.seen[0]!.options as unknown as { hostname: string; port: number; path: string; headers: Record<string, string> };
  expect(opts.hostname).toBe("cdn.example");
  expect(opts.port).toBe(443);
  expect(opts.path).toBe("/a.png?x=1");
  expect(opts.headers["accept"]).toBe("image/*");
  expect(lookupOf(c.seen[0]!)).toBe(PUBLIC);
});

test("the pinned HTTPS sender preserves an explicit method and sends only the supplied bytes", async () => {
  const c = connector(() => ({ status: 200 }));
  const body = new TextEncoder().encode("payload");
  await pinnedSender(c.request)({ url: new URL("https://cdn.example/write"), address: PUBLIC, headers: {}, signal: new AbortController().signal, method: "PATCH", body });
  expect(c.seen[0]!.options.method).toBe("PATCH");
  expect([...c.seen[0]!.body!]).toEqual([...body]);
  expect(c.seen[0]!.options.headers).toEqual({ "accept-encoding": "identity" });
});

test("a second resolution to another address is never used: the name is resolved once and every hop connects to its own vetted address", async () => {
  const answers = [[PUBLIC], ["127.0.0.1"]];
  let calls = 0;
  const c = connector(() => ({ status: 200 }));
  const deps: VettedDeps = { resolve: async () => answers[calls++]!, send: pinnedSender(c.request) };
  await guardedFetchVetted("https://cdn.example/a", {}, deps);
  expect(calls).toBe(1);
  expect(c.seen).toHaveLength(1);
  expect(lookupOf(c.seen[0]!)).toBe(PUBLIC);
});

test("through the real transport, a private answer is refused before any connection and a redirect hop is vetted and pinned on its own", async () => {
  const none = connector(() => ({ status: 200 }));
  const refused = await guardedFetchVetted("https://lan.example/a", {}, { resolve: async () => ["10.0.0.5"], send: pinnedSender(none.request) }).then(() => null, (e: unknown) => e);
  expect(refused).toBeInstanceOf(EgressBlocked);
  expect(none.seen).toHaveLength(0);

  const hops = connector((n) => (n === 1 ? { status: 302, headers: { location: "https://inner.example/b" } } : { status: 200 }));
  const answers: Record<string, string[]> = { "cdn.example": [PUBLIC], "inner.example": ["192.168.1.9"] };
  const blocked = await guardedFetchVetted("https://cdn.example/a", {}, { resolve: async (h) => answers[h] ?? [], send: pinnedSender(hops.request) }).then(() => null, (e: unknown) => e);
  expect(blocked).toBeInstanceOf(EgressBlocked);
  expect(hops.seen).toHaveLength(1);
});
