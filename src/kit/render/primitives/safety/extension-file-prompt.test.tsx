/** Purpose: verify Terminal path selection is explicit and never accepts a guest-provided path. */
/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test";
import { ExtensionFilePrompt } from "./extension-file-prompt";
import { testRender, settleUntil } from "../../test-render";
import type { PendingExtensionFileAction } from "../../../../extensions/contracts/file-actions";

test("Terminal file selection submits only the path typed into its focused host prompt", async () => {
  const paths: string[] = [], cancelled: boolean[] = [];
  const ticket: PendingExtensionFileAction = { id: "pick-1", packageId: "demo.files", packageName: "Fixture extension", principal: {
    storeId: "terminal-fixture", packageId: "demo.files", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 1,
  }, expiresAt: Date.now() + 60_000, operation: "files.pick", action: "pick", mode: "read" };
  const view = await testRender(<ExtensionFilePrompt ticket={ticket} onChoose={(path) => paths.push(path)} onCancel={() => cancelled.push(true)} />, { width: 80, height: 12 });
  try {
    await settleUntil(() => view.captureCharFrame().includes("EXTENSION FILE SELECTION"));
    await view.mockInput.typeText("C:\\temp\\selected.txt");
    view.mockInput.pressEnter();
    await settleUntil(() => paths.length === 1);
    expect(paths).toEqual(["C:\\temp\\selected.txt"]);
    expect(cancelled).toEqual([]);
  } finally { await view.renderer.destroy(); }
});
