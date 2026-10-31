/**
 * Sandbox-only origin host: allowlist, no API, no token, CORS for UI origin only.
 */
import { describe, expect, test } from "bun:test";
import {
  createSandboxHandler,
  isSandboxAllowlistedPath,
  SANDBOX_ALLOWLIST,
  startSandboxHost,
} from "./sandbox-host";
import { createSecurityContext, injectSandboxOriginMeta, injectSessionMeta } from "./server";

const UI_ORIGIN = "http://127.0.0.1:8321";

describe("sandbox allowlist", () => {
  test("only the sandbox worker and WASM asset paths are allowlisted", () => {
    expect(isSandboxAllowlistedPath("/sandbox/worker.js")).toBe(true);
    expect(isSandboxAllowlistedPath("/sandbox/regex-worker.js")).toBe(true);
    expect(isSandboxAllowlistedPath("/sandbox/glue.wasm")).toBe(true);
    expect(isSandboxAllowlistedPath("/sandbox/extension-worker.js")).toBe(true);
    expect(isSandboxAllowlistedPath("/sandbox/quickjs.wasm")).toBe(true);
    expect(isSandboxAllowlistedPath("/api/studio/save")).toBe(false);
    expect(isSandboxAllowlistedPath("/")).toBe(false);
    expect(isSandboxAllowlistedPath("/sandbox/../api/settings")).toBe(false);
    expect(SANDBOX_ALLOWLIST.length).toBe(7);
  });
});

describe("createSandboxHandler", () => {
  test("denies /api and arbitrary paths", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    for (const path of ["/api/settings", "/api/studio/save", "/", "/index.html", "/boot.js", "/secret"]) {
      const res = await handler(new Request(`http://127.0.0.1:9${path}`));
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain("vaude-session");
      expect(text).not.toMatch(/token/i);
    }
  });

  test("serves worker.js with CORS for the UI origin and restrictive CSP", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const res = await handler(new Request("http://127.0.0.1:9/sandbox/worker.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(UI_ORIGIN);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("content-security-policy") ?? "").toContain("default-src 'none'");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(100);
    // The worker protocol deliberately contains the *name* of forbidden credential-shaped keys.
    // What matters is that the sandbox bundle cannot contain an actual launch credential.
    expect(body).not.toContain("secret-token-value");
    expect(body).not.toContain("X-Bunzai-Token");
  }, 60_000);

  test("OPTIONS preflight only for allowlisted paths", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const ok = await handler(
      new Request("http://127.0.0.1:9/sandbox/worker.js", { method: "OPTIONS" }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(UI_ORIGIN);

    const no = await handler(new Request("http://127.0.0.1:9/api/settings", { method: "OPTIONS" }));
    expect(no.status).toBe(404);
  });

  test("serves the regex worker from the isolated allowlist", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const res = await handler(new Request("http://127.0.0.1:9/sandbox/regex-worker.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(UI_ORIGIN);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  test("builds the QuickJS wrapper and serves a separate WASM asset from the isolated origin", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const worker = await handler(new Request("http://127.0.0.1:9/sandbox/extension-worker.js", { headers: { origin: UI_ORIGIN } }));
    const wasm = await handler(new Request("http://127.0.0.1:9/sandbox/quickjs.wasm", { headers: { origin: UI_ORIGIN } }));
    expect(worker.status).toBe(200);
    expect(worker.headers.get("access-control-allow-origin")).toBe(UI_ORIGIN);
    expect(await worker.text()).toContain("QuickJS");
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect((await wasm.arrayBuffer()).byteLength).toBe(503_134);
  }, 60_000);

  test("serves a trusted parent-locked frame without any API authority", async () => {
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const frame = await handler(new Request("http://127.0.0.1:9/sandbox/extension-frame.html?parent=ignored", { headers: { origin: UI_ORIGIN } }));
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain(`frame-ancestors ${UI_ORIGIN}`);
    expect(frame.headers.get("content-security-policy")).toContain("wasm-unsafe-eval");
    expect(await frame.text()).toContain("/sandbox/extension-frame.js");
  });

  test("rejects non-loopback allowOrigin at construction", () => {
    expect(() => createSandboxHandler({ allowOrigin: "https://evil.example" })).toThrow(
      /allowOrigin/,
    );
  });
});

describe("startSandboxHost", () => {
  test("binds ephemeral loopback origin and serves worker only", async () => {
    const { origin, stop } = startSandboxHost({ allowOrigin: UI_ORIGIN });
    try {
      expect(origin.startsWith("http://127.0.0.1:")).toBe(true);
      expect(origin).not.toBe(UI_ORIGIN);

      const worker = await fetch(`${origin}/sandbox/worker.js`);
      expect(worker.status).toBe(200);

      const api = await fetch(`${origin}/api/studio/list`);
      expect(api.status).toBe(404);

      // Token is never on this origin's surface.
      const html = await fetch(`${origin}/`);
      expect(html.status).toBe(404);
      expect(await html.text()).not.toContain("vaude-session");
    } finally {
      stop();
    }
  }, 60_000);
});

describe("injectSandboxOriginMeta", () => {
  test("injects sandbox origin without touching session token", () => {
    const base = "<html><head></head><body></body></html>";
    const withToken = injectSessionMeta(base, "secret-token-value");
    const withBoth = injectSandboxOriginMeta(withToken, "http://127.0.0.1:9999");
    expect(withBoth).toContain('name="vaude-session"');
    expect(withBoth).toContain("secret-token-value");
    expect(withBoth).toContain('name="vaude-sandbox-origin"');
    expect(withBoth).toContain("http://127.0.0.1:9999");
    // sandbox meta must not reuse the token
    expect(withBoth).not.toMatch(/vaude-sandbox-origin"[^>]*secret-token-value/);
  });

  test("rejects non-loopback origin", () => {
    expect(() => injectSandboxOriginMeta("<html></html>", "http://example.com")).toThrow();
  });
});

describe("token stays on UI security context only", () => {
  test("no sandbox response, served or refused, carries the API token", async () => {
    const sec = createSecurityContext();
    const handler = createSandboxHandler({ allowOrigin: UI_ORIGIN });
    const paths = [...SANDBOX_ALLOWLIST, "/api/settings", "/", "/index.html", "/secret"];
    for (const path of paths) {
      const res = await handler(new Request(`http://127.0.0.1:9${path}`));
      const headers = [...res.headers].flat().join(" ");
      expect(headers.includes(sec.token), `${path} headers`).toBe(false);
      expect(Buffer.from(await res.arrayBuffer()).includes(sec.token), `${path} body`).toBe(false);
    }
    expect(sec.token.length).toBeGreaterThan(16);
  });
});
