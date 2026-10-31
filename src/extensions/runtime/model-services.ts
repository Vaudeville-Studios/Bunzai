/** Binds model operations to saved Kit provider connections without exposing their secrets. */
import { readVault } from "../../kit/providers/vault";
import { listModelsFor } from "../../kit/providers/adapters";
import { resolveSceneProvider } from "../../kit/providers/scene";
import type { ProviderConfig } from "../../kit/providers/config";
import type { ProviderCompletion } from "../../stage/contracts/provider";
import { decodeJsonValue } from "../contracts/value";
import { sha256HexBytes } from "../../core/sha256";
import { deepEq } from "../../core/guards";
import { extensionTokenReportSchema, type ExtensionModelConnection, type ExtensionModelInfo, type ExtensionModelServices, type ExtensionModelUsage } from "../operations/models/_services";
import type { OperationPrincipal } from "../contracts/operation";

export interface ModelServiceAdapters {
  providers(): Promise<readonly ProviderConfig[]>;
  list(config: ProviderConfig, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<readonly ExtensionModelInfo[] | null>;
  generate(config: ProviderConfig, prompt: string, maxOutputTokens: number, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<ProviderCompletion>;
}
const production: ModelServiceAdapters = {
  async providers() { return (await readVault()).providers; },
  async list(config, signal, assertCurrent) { await assertCurrent(); return await listModelsFor(config, signal, assertCurrent); },
  async generate(config, prompt, maxOutputTokens, signal, assertCurrent) {
    const { provider } = await resolveSceneProvider(config, signal, assertCurrent);
    await assertCurrent();
    return provider.send({ model: config.model, messages: [{ role: "user", content: prompt }], options: { max_tokens: maxOutputTokens, stream: false } }, { signal });
  },
};
const safeConnection = (config: ProviderConfig): ExtensionModelConnection | null => config.id ? {
  id: config.id, name: config.name ?? config.id, provider: config.kind, model: config.model, hasKey: Boolean(config.apiKey),
} : null;
const jsonTokenReport = (report: unknown) => report === undefined ? null : extensionTokenReportSchema.parse(decodeJsonValue(JSON.parse(JSON.stringify(report))));
const promptDigest = (prompt: string): string => sha256HexBytes(new TextEncoder().encode(prompt));
const sameConfig = (left: ProviderConfig, right: ProviderConfig): boolean => deepEq(left, right);
type PreparedGeneration = { config: ProviderConfig; promptDigest: string; maxOutputTokens: number; principal: Pick<OperationPrincipal, "packageDigest" | "policyFingerprint" | "grantRevision" | "runEpoch">; expiresAt: number };

export function createExtensionModelServices(adapters: ModelServiceAdapters = production, now: () => number = Date.now): ExtensionModelServices {
  const jobs = new Map<string, { connectionId: string; controller: AbortController }>();
  const prepared = new Map<string, PreparedGeneration>();
  const totals = new Map<string, ExtensionModelUsage>();
  const configs = async (): Promise<readonly ProviderConfig[]> => adapters.providers();
  const configFor = async (id: string): Promise<ProviderConfig | null> => (await configs()).find((config) => config.id === id) ?? null;
  const usageFor = (packageId: string) => totals.get(packageId) ?? { calls: 0, promptTokens: 0, outputTokens: 0, accountingUnits: 0, tokenUsageComplete: true };
  const clearExpiredReviews = () => { for (const [key, item] of prepared) if (item.expiresAt <= now()) prepared.delete(key); };
  return {
    async describe(connectionId) { const config = await configFor(connectionId); return config ? safeConnection(config) : null; },
    async list(connectionId, signal, assertCurrent) {
      const config = await configFor(connectionId);
      if (!config) throw new Error("saved model connection is unavailable");
      await assertCurrent();
      return (await adapters.list(config, signal, assertCurrent))?.slice(0, 100) ?? null;
    },
    async prepareGeneration(packageId, connectionId, jobId, prompt, maxOutputTokens, principal) {
      clearExpiredReviews();
      const config = await configFor(connectionId);
      const connection = config && safeConnection(config);
      if (!config || !connection) throw new Error("only saved model connections can be approved");
      const key = `${packageId}\0${jobId}`;
      if (prepared.has(key)) throw new Error("model job ID is already awaiting approval");
      if (prepared.size >= 128) throw new Error("model review limit reached; retry after a review expires");
      prepared.set(key, { config: structuredClone(config), promptDigest: promptDigest(prompt), maxOutputTokens,
        principal: { packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch }, expiresAt: now() + 120_000 });
      return connection;
    },
    async generate(packageId, connectionId, jobId, prompt, maxOutputTokens, principal, signal, assertCurrent) {
      const key = `${packageId}\0${jobId}`;
      if (jobs.has(key)) throw new Error("model job ID is already in use");
      clearExpiredReviews();
      const approval = prepared.get(key);
      prepared.delete(key);
      const currentPrincipal = { packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch };
      if (!approval || approval.expiresAt <= now() || approval.promptDigest !== promptDigest(prompt) || approval.maxOutputTokens !== maxOutputTokens
        || JSON.stringify(approval.principal) !== JSON.stringify(currentPrincipal)) throw new Error("model request changed after review; inspect it again");
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      jobs.set(key, { connectionId, controller });
      try {
        if (controller.signal.aborted) throw new Error("model generation was cancelled");
        const config = await configFor(connectionId);
        if (!config || !sameConfig(config, approval.config)) throw new Error("saved model connection changed after review; inspect it again");
        await assertCurrent();
        const completion = await adapters.generate(approval.config, prompt, maxOutputTokens, controller.signal, assertCurrent);
        if (controller.signal.aborted) throw new Error("model generation was cancelled");
        if (completion.content.length > 65_536) throw new Error("model reply exceeds the extension output limit");
        const usage = jsonTokenReport(completion.usage);
        const promptBytes = new TextEncoder().encode(prompt).byteLength;
        const outputBytes = new TextEncoder().encode(completion.content).byteLength;
        const promptTokens = usage?.promptTotal ?? null;
        const outputTokens = usage?.output ?? null;
        if (outputBytes > maxOutputTokens * 4) throw new Error("model output exceeded the reviewed token ceiling");
        const total = usageFor(packageId);
        total.calls++;
        total.accountingUnits += promptBytes + outputBytes;
        if (promptTokens === null || outputTokens === null) total.tokenUsageComplete = false;
        else { total.promptTokens += promptTokens; total.outputTokens += outputTokens; }
        if (usage?.cost !== undefined) total.costUsd = (total.costUsd ?? 0) + usage.cost;
        totals.set(packageId, total);
        return { model: approval.config.model, text: completion.content, usage, promptTokens, outputTokens, accountingUnits: promptBytes + outputBytes };
      } finally {
        signal.removeEventListener("abort", abort);
        jobs.delete(key);
      }
    },
    async cancel(packageId, connectionId, jobId) {
      const job = jobs.get(`${packageId}\0${jobId}`);
      if (!job || job.connectionId !== connectionId) return false;
      job.controller.abort(new Error("cancelled by the extension"));
      return true;
    },
    async usage(packageId) {
      return usageFor(packageId);
    },
  };
}
