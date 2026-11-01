/**
 * Regression tests for the UI server's Host/Origin gate: an auth handler that trusts
 * X-Forwarded-Proto/Host to rewrite its own callback URLs lets a client-controlled header spoof
 * it. Bunzai's gate must decide Origin/Host purely from its own boot-time expected values and the
 * real Origin header, never from a forwardable one.
 */
import { describe, expect, test } from "bun:test";
import {
  checkApiRequest,
  checkLanApiRequest,
  checkRemoteApiRequest,
  hostAllowed,
  originAllowed,
  readBodyCapped,
  readJsonObject,
} from "./server-security";

describe("origin and host decisions ignore forwarded headers", () => {
  const expectedOrigin = "http://127.0.0.1:8321";
  const expectedHost = "127.0.0.1:8321";

  test("the real loopback origin, in each of its interchangeable spellings, is allowed", () => {
    expect(originAllowed(expectedOrigin, expectedOrigin)).toBe(true);
    expect(originAllowed("http://localhost:8321", expectedOrigin)).toBe(true);
    expect(originAllowed("http://[::1]:8321", expectedOrigin)).toBe(true);
  });

  test("an origin claiming a forwarded/proxied host is refused, not trusted", () => {
    expect(originAllowed("https://evil.example:8321", expectedOrigin)).toBe(false);
    expect(originAllowed("http://127.0.0.1:9999", expectedOrigin)).toBe(false);
    expect(originAllowed(null, expectedOrigin)).toBe(false);
  });

  test("a spoofed host header is refused the same way", () => {
    expect(hostAllowed(expectedHost, expectedHost)).toBe(true);
    expect(hostAllowed("evil.example:8321", expectedHost)).toBe(false);
  });
});

describe("B14: readJsonObject is the one content-type + object-shape gate", () => {
  const req = (body: string, contentType = "application/json") =>
    new Request("http://127.0.0.1/api/x", { method: "POST", headers: { "content-type": contentType }, body });

  test.each([
    ["x", "a bare string"],
    ["[]", "an array"],
    ["null", "null"],
    ["42", "a number"],
  ])("a %s body (%s) is refused 400, with no value returned", async (body) => {
    const result = await readJsonObject(req(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  test("a missing content-type is refused 415, before the body is even read", async () => {
    const result = await readJsonObject(req('{"a":1}', "text/plain"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  test("a well-formed object passes through untouched", async () => {
    const result = await readJsonObject(req('{"a":1,"b":"two"}'));
    expect(result).toEqual({ ok: true, value: { a: 1, b: "two" } });
  });
});

describe("B14: all three /api gates refuse the same cross-site GET", () => {
  const sec = { instanceId: "fixture", token: "t", expectedHost: "127.0.0.1:8321", expectedOrigin: "http://127.0.0.1:8321" };
  const crossSiteGet = (headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:8321/api/x", { headers: { host: "127.0.0.1:8321", "sec-fetch-site": "cross-site", ...headers } });

  test("checkApiRequest refuses", async () => {
    expect(checkApiRequest(crossSiteGet(), sec)?.status).toBe(403);
  });

  test("checkRemoteApiRequest refuses", async () => {
    expect(checkRemoteApiRequest(crossSiteGet({ "x-bunzai-sidecar-secret": "s" }), sec, "s")?.status).toBe(403);
  });

  test("checkLanApiRequest refuses", async () => {
    expect(checkLanApiRequest(crossSiteGet(), sec)?.status).toBe(403);
  });
});

describe("an oversized body is rejected before anything would parse it", () => {
  test("a declared Content-Length over the cap is refused without reading the stream", async () => {
    const req = new Request("http://127.0.0.1/api/x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: JSON.stringify({ x: "y" }),
    });
    const result = await readBodyCapped(req, 64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  test("a body that grows past the cap mid-stream is refused, not buffered whole", async () => {
    const big = "x".repeat(1000);
    const req = new Request("http://127.0.0.1/api/x", { method: "POST", body: big });
    const result = await readBodyCapped(req, 64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });
});

describe("same-site GETs from a foreign loopback port are refused", () => {
  const sec = { instanceId: "fixture", token: "t", expectedHost: "127.0.0.1:8321", expectedOrigin: "http://127.0.0.1:8321" };
  const get = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:8321/api/x", { headers: { host: "127.0.0.1:8321", ...headers } });
  // The browser sets Sec-Fetch-Site: same-site for a page on another port of the same host.
  const foreign = { "sec-fetch-site": "same-site", origin: "http://127.0.0.1:9999" };

  test("every gate refuses a same-site GET", () => {
    expect(checkApiRequest(get(foreign), sec)?.status).toBe(403);
    expect(checkApiRequest(get({ "sec-fetch-site": "same-site" }), sec)?.status).toBe(403);
    expect(checkLanApiRequest(get(foreign), sec)?.status).toBe(403);
    expect(checkRemoteApiRequest(get({ ...foreign, "x-bunzai-sidecar-secret": "s" }), sec, "s")?.status).toBe(403);
  });

  test("the sandbox origin gets no exception: it never calls /api (ADR-009)", () => {
    expect(checkApiRequest(get({ "sec-fetch-site": "same-site", origin: "http://127.0.0.1:40000" }), sec)?.status).toBe(403);
  });

  test("the app's own fetches, the address bar, and header-less clients still pass", () => {
    for (const site of ["same-origin", "none"]) {
      expect(checkApiRequest(get({ "sec-fetch-site": site }), sec)).toBeNull();
    }
    expect(checkApiRequest(get({}), sec)).toBeNull();
    expect(checkApiRequest(get({ "user-agent": "Bun/1.3" }), sec)).toBeNull();
  });

  test("a browser that sends no Sec-Fetch-Site on loopback is refused (fail closed)", () => {
    expect(checkApiRequest(get({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120" }), sec)?.status).toBe(403);
  });

  test("an unknown or oddly cased Sec-Fetch-Site is refused, and HEAD is gated like GET", () => {
    for (const site of ["bogus", "Same-Site", "CROSS-SITE", "same-origin2"]) {
      expect(checkApiRequest(get({ "sec-fetch-site": site }), sec)?.status).toBe(403);
      expect(checkLanApiRequest(get({ "sec-fetch-site": site }), sec)?.status).toBe(403);
    }
    const head = (site: string) => new Request("http://127.0.0.1:8321/api/x", { method: "HEAD", headers: { host: "127.0.0.1:8321", "sec-fetch-site": site } });
    expect(checkApiRequest(head("same-site"), sec)?.status).toBe(403);
    expect(checkApiRequest(head("same-origin"), sec)).toBeNull();
    expect(checkRemoteApiRequest(new Request("http://127.0.0.1:8321/api/x", { headers: { "x-bunzai-sidecar-secret": "s", "sec-fetch-site": "Same-Site" } }), sec, "s")?.status).toBe(403);
  });

  test("the LAN gate keeps header-less browsers: plain-http LAN pages never send Sec-Fetch-Site", () => {
    expect(checkLanApiRequest(get({ "user-agent": "Mozilla/5.0 Chrome/120" }), sec)).toBeNull();
  });
});
