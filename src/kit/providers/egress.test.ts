/** The registry discovers the drop-in providers, and the egress gate fails closed and host-locks. */
import { expect, test } from "bun:test";
import type { ProviderConfig } from "./config";
import { allowedHost, assertReady, EgressBlocked, guardedFetch } from "./egress";
import { loadSpokes } from "./registry";

const registry = await loadSpokes();
const anthropicSpoke = registry.get("anthropic")!;
const localSpoke = registry.get("local")!;

const anthropic: ProviderConfig = { kind: "anthropic", model: "claude-opus-4-8", apiKey: "sk-ant-x" };
const local: ProviderConfig = { kind: "local", model: "llama3.1", baseURL: "http://localhost:11434/v1" };

test("registry discovers every drop-in provider and skips the template", () => {
  expect([...registry.keys()].sort()).toEqual([
    "ai21",
    "aimlapi",
    "anthropic",
    "claude-sub",
    "codex",
    "cometapi",
    "custom",
    "deepseek",
    "electronhub",
    "fireworks",
    "google",
    "groq",
    "local",
    "minimax",
    "mistral",
    "moonshot",
    "nanogpt",
    "ollama",
    "openai",
    "openrouter",
    "perplexity",
    "pollinations",
    "siliconflow",
    "xai",
    "zai",
  ]);
});

test("unknown provider fails closed", () => {
  expect(() => assertReady({ kind: "nope", model: "x" }, undefined)).toThrow(EgressBlocked);
});

test("keyed providers need a key; a configured one passes", () => {
  expect(() => assertReady({ kind: "anthropic", model: "claude-opus-4-8" }, anthropicSpoke)).toThrow(EgressBlocked);
  expect(() => assertReady(anthropic, anthropicSpoke)).not.toThrow();
});

test("keyless local is allowed without a key", () => {
  expect(() => assertReady(local, localSpoke)).not.toThrow();
});

test("allowed host is the spoke's fixed host, or the user's base URL host", () => {
  expect(allowedHost(anthropic, anthropicSpoke)).toBe("api.anthropic.com");
  expect(allowedHost(local, localSpoke)).toBe("localhost:11434");
});

test("guardedFetch refuses any host but the configured one, before touching the network", async () => {
  await expect(guardedFetch("api.anthropic.com")("https://evil.example.com/steal")).rejects.toThrow(EgressBlocked);
});

test("guardedFetch blocks a redirect before it can leave the configured host", async () => {
  const reached: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    reached.push(input instanceof Request ? input.url : String(input));
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example.com/steal" },
    });
  };

  await expect(
    guardedFetch("api.anthropic.com", fakeFetch)("https://api.anthropic.com/v1/models"),
  ).rejects.toThrow(EgressBlocked);
  expect(reached).toEqual(["https://api.anthropic.com/v1/models"]);
});

test("guardedFetch follows a bounded redirect on the configured host", async () => {
  const reached: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    reached.push(url);
    return reached.length === 1
      ? new Response(null, { status: 307, headers: { location: "/v1/models?page=2" } })
      : Response.json({ data: [] });
  };

  const response = await guardedFetch("api.anthropic.com", fakeFetch)(
    "https://api.anthropic.com/v1/models",
  );
  expect(response.status).toBe(200);
  expect(reached).toEqual([
    "https://api.anthropic.com/v1/models",
    "https://api.anthropic.com/v1/models?page=2",
  ]);
});

test("guardedFetch rejects an HTTPS redirect downgrade", async () => {
  const fakeFetch = async (): Promise<Response> =>
    new Response(null, {
      status: 302,
      headers: { location: "http://api.anthropic.com/v1/models" },
    });

  await expect(
    guardedFetch("api.anthropic.com", fakeFetch)("https://api.anthropic.com/v1/models"),
  ).rejects.toThrow("downgrade");
});

test("guardedFetch stops a redirect loop at the hop cap and fails closed", async () => {
  let hops = 0;
  const fakeFetch = async (): Promise<Response> => {
    hops += 1;
    return new Response(null, { status: 302, headers: { location: `/hop/${String(hops)}` } });
  };
  await expect(guardedFetch("api.anthropic.com", fakeFetch)("https://api.anthropic.com/start")).rejects.toThrow("more than 5");
  expect(hops).toBe(6);
});

test("guardedFetch never sends the Authorization header to another host, by name or by address", async () => {
  const sentTo: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const req = input as Request;
    sentTo.push(`${new URL(req.url).host} ${req.headers.get("authorization") ?? "-"}`);
    return new Response(null, { status: 307, headers: { location: sentTo.length === 1 ? "https://evil.example.com/x" : "http://127.0.0.1:8321/api" } });
  };
  const fetcher = guardedFetch("api.anthropic.com", fakeFetch);
  await expect(fetcher("https://api.anthropic.com/v1", { headers: { authorization: "Bearer secret" } })).rejects.toThrow(EgressBlocked);
  expect(sentTo).toEqual(["api.anthropic.com Bearer secret"]);
  sentTo.length = 0;
  const toLoopback = async (): Promise<Response> => { sentTo.push("hit"); return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8321/api" } }); };
  await expect(guardedFetch("api.anthropic.com", toLoopback)("https://api.anthropic.com/v1", { headers: { authorization: "Bearer secret" } })).rejects.toThrow(EgressBlocked);
  expect(sentTo).toEqual(["hit"]);
});
