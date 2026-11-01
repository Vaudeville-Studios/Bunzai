/** Purpose: verify extension previews use the existing terminable regex worker and return text only. */
import { expect, test } from "bun:test";
import type { PendingExtensionHostAction } from "../../extensions/contracts/host-actions";
import { runExtensionRegexPreview } from "./regex-preview";

test("runs the host-approved regex preview through its isolated Worker adapter", async () => {
  const ticket: Extract<PendingExtensionHostAction, { action: "regex.preview" }> = {
    id: "regex-1", packageId: "demo.regex", principal: { storeId: "store", packageId: "demo.regex", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 1 },
    expiresAt: Date.now() + 10_000, action: "regex.preview", operation: "regex.preview", phase: "input", text: "bounded text", rules: [],
  };
  await expect(runExtensionRegexPreview(ticket)).resolves.toEqual({ status: "regex-result", ok: true, text: "bounded text", error: null });
});
