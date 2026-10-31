/** Purpose: prove extension turn regex replies use the isolated worker and strict bounded DTO. */
import { expect, test } from "bun:test";
import { answerRegexRequest } from "../../sandbox/regex/request";
import { pendingSceneTurnRegexActionSchema } from "../../extensions/contracts/host-actions";
import { runExtensionSceneTurnRegex } from "./scene-turn-regex";

const workerLike = (): Worker => {
  let listener: ((event: { data: unknown }) => void) | undefined;
  return {
    addEventListener: (type: string, handler: (event: { data: unknown }) => void) => { if (type === "message") listener = handler; },
    removeEventListener: () => undefined,
    postMessage: (data: unknown) => queueMicrotask(() => listener?.({ data: answerRegexRequest(data) })),
    terminate: () => undefined,
  } as unknown as Worker;
};

const ticket = () => pendingSceneTurnRegexActionSchema.parse({
  id: "action-1", packageId: "bunzai.extension.case", principal: { storeId: "store", packageId: "bunzai.extension.case", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 2 }, expiresAt: Date.now() + 10_000,
  action: "scene-turn.regex", operation: "turns.start", sceneId: "scene-1", turnId: "turn-1", phase: "prompt",
  rules: [{ id: "strip", label: "strip", find: "secret", flags: "g", replace: "", phases: ["prompt"], enabled: true, sortOrder: 0 }],
  items: [{ index: 4, role: "user", depth: 0, text: "secret note" }], macros: { user: "Ann", char: "Vera" },
});

test("scene-turn regex ticket returns indexed RegexAnswer from the isolated worker adapter", async () => {
  const response = await runExtensionSceneTurnRegex(ticket(), workerLike);
  expect(response).toEqual({ status: "scene-regex-result", answer: { kind: "done", texts: { 4: " note" } } });
});

test("scene-turn regex ticket rejects aggregate input beyond its wire ceiling", () => {
  expect(() => pendingSceneTurnRegexActionSchema.parse({ ...ticket(), items: [{ index: 4, role: "user", depth: 0, text: "x".repeat(17_000) }] })).toThrow();
});

test("scene-turn regex worker startup failures become actionable failed answers", async () => {
  const response = await runExtensionSceneTurnRegex(ticket(), () => { throw new Error("blocked worker"); });
  expect(response.status).toBe("scene-regex-result");
  expect(response.answer).toMatchObject({ kind: "failed", error: expect.stringContaining("blocked worker") });
});
