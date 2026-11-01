/** Host-owned model connections; provider secrets never cross this port. */
import { z } from "zod";
import type { OperationPrincipal } from "../../contracts/operation";

export const extensionTokenReportSchema = z.strictObject({ shape: z.enum(["openai", "responses", "anthropic", "gemini", "deepseek", "ollama", "llamacpp"]), promptTotal: z.number().nonnegative().optional(), uncached: z.number().nonnegative().optional(), cacheRead: z.number().nonnegative().optional(), cacheWrite: z.number().nonnegative().optional(), cacheWrite1h: z.number().nonnegative().optional(), output: z.number().nonnegative().optional(), reasoning: z.number().nonnegative().optional(), reasoningInOutput: z.boolean().optional(), toolPrompt: z.number().nonnegative().optional(), cost: z.number().nonnegative().optional() });
export type ExtensionTokenReport = z.infer<typeof extensionTokenReportSchema>;

export interface ExtensionModelConnection {
  id: string;
  name: string;
  provider: string;
  model: string;
  hasKey: boolean;
}
export interface ExtensionModelInfo { id: string; label?: string; context?: number }
export interface ExtensionModelUsage { calls: number; promptTokens: number; outputTokens: number; accountingUnits: number; tokenUsageComplete: boolean; costUsd?: number }
export interface ExtensionModelServices {
  describe(connectionId: string): Promise<ExtensionModelConnection | null>;
  list(connectionId: string, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<readonly ExtensionModelInfo[] | null>;
  prepareGeneration(packageId: string, connectionId: string, jobId: string, prompt: string, maxOutputTokens: number, principal: OperationPrincipal): Promise<ExtensionModelConnection>;
  generate(packageId: string, connectionId: string, jobId: string, prompt: string, maxOutputTokens: number, principal: OperationPrincipal, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<{ model: string; text: string; usage: ExtensionTokenReport | null; promptTokens: number | null; outputTokens: number | null; accountingUnits: number }>;
  cancel(packageId: string, connectionId: string, jobId: string): Promise<boolean>;
  usage(packageId: string): Promise<ExtensionModelUsage>;
}
