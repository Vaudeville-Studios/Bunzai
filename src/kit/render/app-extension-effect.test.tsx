/** Purpose: verify the Terminal shell exposes a real approval prompt and answers its owner queue. */
/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test";
import { App } from "./app";
import { testRender, settleUntil } from "./test-render";
import type { Session } from "../session";
import type { PendingExtensionEffect } from "../../extensions/runtime/confirmation";

test("Terminal shows the catalog-owned effect review and sends the explicit answer", async () => {
  const answers: boolean[] = [];
  const ticket: PendingExtensionEffect = { id: "effect-1", packageId: "demo.ext", packageName: "Fixture extension", operation: "models.generate", effect: "external",
    resources: [{ kind: "host-connection", id: "saved-1" }], fields: ["model.prompt"], methods: [], destinations: ["connection:saved-1"], review: { prompt: "send this exact text", maxOutputTokens: 24 }, expiresAt: Date.now() + 60_000 };
  const extensions = {
    list: async () => [{ id: "demo.ext", grants: [{ operation: "models.generate", duration: "session", budget: { requests: 3, bytes: 20_000, tokens: 1_200 } }] }],
    pendingEffects: async () => answers.length === 0 ? [ticket] : [],
    answerEffect: async (_id: string, approved: boolean) => { answers.push(approved); return true; },
    pendingFileActions: async () => [], processFileAction: async () => undefined, answerFileAction: async () => false,
  } as unknown as NonNullable<Session["extensions"]>;
  const session: Session = { extensions, async runTurn(_input, history) { return history; }, async probe() {}, async summarise() { return null; }, async activeProvider() { return null; } };
  const view = await testRender(<App studioName="Fixture" totalPieces={0} decks={[]} session={session} commands={[]} onQuit={() => {}} />, { width: 90, height: 30 });
  try {
    await settleUntil(() => view.captureCharFrame().includes("EXTENSION REQUEST: Generate with a saved model"));
    const frame = view.captureCharFrame();
    expect(frame).toContain("Fixture extension");
    expect(frame).toContain("send this exact text");
    expect(frame).toContain("connection:saved-1");
    expect(frame).toContain("requests: 3");
    view.mockInput.pressKey("y");
    await settleUntil(() => answers.length === 1);
    await settleUntil(() => !view.captureCharFrame().includes("EXTENSION REQUEST:"));
    expect(answers).toEqual([true]);
    expect(view.captureCharFrame()).not.toContain("EXTENSION REQUEST:");
  } finally { await view.renderer.destroy(); }
});
