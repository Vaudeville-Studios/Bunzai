/** Coordinate role-filtered regex batches for a scene; execution is supplied by a host worker adapter. */
import { rulesForRole } from "../core/regex/scene-pass";
import type { RegexRule } from "../entities/regex/schema";

export interface SceneRegexInput {
  rules: readonly RegexRule[];
  items: readonly { index: number; role: "user" | "assistant"; depth: number; text: string }[];
  macros: { user: string; char: string };
  phase?: "prompt" | "display";
}
export type SceneRegexAnswer = { kind: "done"; texts: Record<number, string> } | { kind: "failed"; error: string } | { kind: "cancel" };
export type SceneRegexBatchRunner = (items: readonly { text: string; depth: number }[], rules: readonly RegexRule[], options: {
  phase: "prompt" | "display"; target: "prompt" | "display"; macros: SceneRegexInput["macros"]; protectCaptures: boolean;
}, signal?: AbortSignal) => Promise<{ ok: true; texts: string[] } | { ok: false; reason: "timeout" | "cancelled" | "error"; error: string }>;

/** Runs each role in bounded chunks and returns no partial changes after worker failure. */
export async function runScenePromptRegex(asked: SceneRegexInput, runBatch: SceneRegexBatchRunner, signal?: AbortSignal): Promise<SceneRegexAnswer> {
  const texts: Record<number, string> = {};
  const protectCaptures = asked.rules.some((rule) => rule.replace.includes("{{"));
  const phase = asked.phase ?? "prompt";
  for (const role of ["user", "assistant"] as const) {
    const rules = phase === "display" ? asked.rules : rulesForRole(asked.rules, role);
    const items = asked.items.filter((item) => item.role === role);
    for (let at = 0; at < items.length; at += 100) {
      if (signal?.aborted) return { kind: "cancel" };
      const chunk = items.slice(at, at + 100);
      const result = await runBatch(chunk.map(({ text, depth }) => ({ text, depth })), rules,
        { phase, target: phase, macros: asked.macros, protectCaptures }, signal);
      if (!result.ok) return result.reason === "cancelled" ? { kind: "cancel" } : { kind: "failed", error: result.error };
      chunk.forEach((item, index) => { if (result.texts[index] !== item.text) texts[item.index] = result.texts[index]!; });
    }
  }
  return { kind: "done", texts };
}
