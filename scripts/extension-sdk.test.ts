/** Test SDK generation and ensure wrappers retain one bridge call path. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("SDK projections are current and dispatch only through bunzai.call", () => {
  const result = Bun.spawnSync(["bun", "run", "scripts/extension-sdk.ts", "--check"]);
  expect(result.exitCode).toBe(0);
  const sdk = readFileSync("src/extensions/sdk/index.ts", "utf8");
  expect(sdk.split(/\r?\n/).length).toBeLessThan(500);
  expect(sdk).toContain("bridge().call(operation, args as JsonValue)");
  expect(sdk).toContain("apiDescribe(args: ExtensionOperationInputs");
  expect(sdk).not.toContain("ApiDescribe(args:");
  expect(sdk).toContain("bridge().extension.define(definition)");
  expect(sdk).toContain("readonly context: Readonly<{ invocation: ExtensionInvocationContext }>");
  expect(sdk).toContain("get context(): GuestBridge[\"context\"] { return bridge().context; }");
  expect(sdk).not.toContain("fetch(");
  expect(sdk).not.toContain("postMessage(");
});
