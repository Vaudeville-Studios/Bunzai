/** Tests provider-service projections exclude credentials while bounding model discovery and generation. */
import { expect, test } from "bun:test";
import { createExtensionModelServices, type ModelServiceAdapters } from "./model-services";
import type { ProviderConfig } from "../../kit/providers/config";

const connection: ProviderConfig = { id: "saved-1", kind: "openai", model: "fixture-model", apiKey: "fixture-secret", baseURL: "https://private.example/v1", headers: { "x-secret": "not-for-guest" } };
const principal = { storeId: "fixture", packageId: "example.extension", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };

test("model services expose safe saved-connection metadata and bounded model lists", async () => {
  const adapters: ModelServiceAdapters = {
    providers: async () => [connection],
    list: async () => Array.from({ length: 120 }, (_, index) => ({ id: `model-${index}` })),
    generate: async () => ({ content: "unused", raw: null }),
  };
  const service = createExtensionModelServices(adapters);
  const connectionInfo = await service.describe("saved-1");
  expect(connectionInfo).toEqual({ id: "saved-1", name: "saved-1", provider: "openai", model: "fixture-model", hasKey: true });
  expect(JSON.stringify(connectionInfo)).not.toContain("fixture-secret");
  expect(JSON.stringify(connectionInfo)).not.toContain("private.example");
  expect((await service.list("saved-1", new AbortController().signal, async () => {}))?.length).toBe(100);
  expect(await service.describe("missing")).toBeNull();
});

test("model calls use the exact reviewed connection snapshot and settle prompt plus output usage", async () => {
  let requested: ProviderConfig | undefined;
  let receivedPrompt = "";
  const adapters: ModelServiceAdapters = {
    providers: async () => [connection], list: async () => null,
    generate: async (config, prompt, _tokens, signal) => {
      requested = config; receivedPrompt = prompt; signal.throwIfAborted();
      return { content: "fixture reply", model: "provider-model", usage: { shape: "openai", promptTotal: 12, output: 4, cost: 0.02 }, raw: null };
    },
  };
  const service = createExtensionModelServices(adapters);
  await expect(service.prepareGeneration("example.extension", "saved-1", "job_12345678", "fixture prompt", 128, principal)).resolves.toMatchObject({ model: "fixture-model" });
  const result = await service.generate("example.extension", "saved-1", "job_12345678", "fixture prompt", 128, principal, new AbortController().signal, async () => {});
  expect(result).toEqual({ model: "fixture-model", text: "fixture reply", usage: { shape: "openai", promptTotal: 12, output: 4, cost: 0.02 }, promptTokens: 12, outputTokens: 4, accountingUnits: 27 });
  expect(requested?.apiKey).toBe("fixture-secret");
  expect(receivedPrompt).toBe("fixture prompt");
  expect(await service.usage("example.extension")).toEqual({ calls: 1, promptTokens: 12, outputTokens: 4, accountingUnits: 27, tokenUsageComplete: true, costUsd: 0.02 });
  expect(await service.usage("other.extension")).toEqual({ calls: 0, promptTokens: 0, outputTokens: 0, accountingUnits: 0, tokenUsageComplete: true });
});

test("missing provider token usage stays unknown while conservative accounting is explicit", async () => {
  const adapters: ModelServiceAdapters = { providers: async () => [connection], list: async () => null,
    generate: async () => ({ content: "reply", raw: null }) };
  const service = createExtensionModelServices(adapters);
  await service.prepareGeneration("example.extension", "saved-1", "job_12345678", "prompt", 16, principal);
  expect(await service.generate("example.extension", "saved-1", "job_12345678", "prompt", 16, principal, new AbortController().signal, async () => {}))
    .toMatchObject({ promptTokens: null, outputTokens: null, accountingUnits: 11 });
  expect(await service.usage("example.extension")).toEqual({ calls: 1, promptTokens: 0, outputTokens: 0, accountingUnits: 11, tokenUsageComplete: false });
});

test("a saved connection change after host review requires a new review before any provider call", async () => {
  let current = connection;
  let calls = 0;
  const adapters: ModelServiceAdapters = { providers: async () => [current], list: async () => null, generate: async () => { calls++; return { content: "unexpected", raw: null }; } };
  const service = createExtensionModelServices(adapters);
  await service.prepareGeneration("example.extension", "saved-1", "job_12345678", "prompt", 16, principal);
  current = { ...connection, model: "different-model" };
  await expect(service.generate("example.extension", "saved-1", "job_12345678", "prompt", 16, principal, new AbortController().signal, async () => {})).rejects.toThrow("changed after review");
  expect(calls).toBe(0);
});

test("model cancellation is restricted to the originating package and saved connection", async () => {
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const adapters: ModelServiceAdapters = {
    providers: async () => [connection], list: async () => null,
    generate: async (_config, _prompt, _tokens, signal) => {
      started();
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return { content: "unreachable", raw: null };
    },
  };
  const service = createExtensionModelServices(adapters);
  const controller = new AbortController();
  await service.prepareGeneration("example.extension", "saved-1", "job_12345678", "prompt", 16, principal);
  const pending = service.generate("example.extension", "saved-1", "job_12345678", "prompt", 16, principal, controller.signal, async () => {});
  await start;
  expect(await service.cancel("other.extension", "saved-1", "job_12345678")).toBe(false);
  expect(await service.cancel("example.extension", "other-connection", "job_12345678")).toBe(false);
  expect(await service.cancel("example.extension", "saved-1", "job_12345678")).toBe(true);
  await expect(pending).rejects.toThrow();
  expect(await service.cancel("example.extension", "saved-1", "job_12345678")).toBe(false);
});
