/** One reviewed request and serialized-prompt budget shared by both turn engines. */
import { MAX_EXTENSION_TURN_ACCOUNTING_UNITS, MAX_EXTENSION_TURN_OUTPUT_TOKENS, MAX_EXTENSION_TURN_PROMPT_BYTES, MAX_EXTENSION_TURN_REQUESTS } from "../contracts/limits";

export function createExtensionTurnBudget(): (promptBytes: number, requestedOutput: number) => number {
  let requests = 0, units = 0;
  return (promptBytes, requestedOutput) => {
    if (!Number.isSafeInteger(promptBytes) || promptBytes < 0 || promptBytes > MAX_EXTENSION_TURN_PROMPT_BYTES) throw new Error("The extension turn prompt exceeds the reviewed byte limit; no provider call was sent.");
    if (!Number.isSafeInteger(requestedOutput) || requestedOutput < 1) throw new Error("The scene requested an invalid provider output limit.");
    if (requests >= MAX_EXTENSION_TURN_REQUESTS) throw new Error("The approved extension turn request limit was reached before another provider call.");
    const output = Math.min(MAX_EXTENSION_TURN_OUTPUT_TOKENS, requestedOutput);
    if (units + promptBytes + output > MAX_EXTENSION_TURN_ACCOUNTING_UNITS) throw new Error("The extension turn exceeds its reviewed prompt and output budget; no provider call was sent.");
    requests++;
    units += promptBytes + output;
    return output;
  };
}
