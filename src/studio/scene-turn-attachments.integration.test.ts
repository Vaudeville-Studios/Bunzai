/** Public turn lifecycle tests for attachment review, fallback, request, and trace alignment. */
import { describe, expect, test } from "bun:test";
import { ProviderError } from "../stage/contracts/provider";
import type { PresetBody } from "../entities/preset/schema";
import { runTurn, type TurnEvent } from "./scene-turn";
import { answerReview } from "./scene-turn-review";
import { lastOf, scene, scripted, waitFor } from "./scene-turn-test-support";

describe("turn attachments and fallback", () => {
  test("inspection edits stay on the resolved file companion and the provider receives ordered attachments", async () => {
    const { provider, sent } = scripted({ pieces: ["Reply."] });
    const s = await scene(provider);
    const uri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    const preset: PresetBody = { name: "Files", prompts: [{
      id: "reference", name: "Reference", content: "Use these files.", role: "system", enabled: true, systemPrompt: true, marker: false,
      placement: "append_preset", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false,
      attachments: [
        { name: "cover.png", ref: uri("image/png", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) },
        { name: "notes.txt", ref: uri("text/plain", new TextEncoder().encode("Keep the coat blue.")) },
        { name: "brief.pdf", ref: uri("application/pdf", new TextEncoder().encode("%PDF-1.7\nbrief")) },
      ],
    }], samplers: {} };
    await s.chats.setPreset(s.chat.id, { kind: "preset", id: "files", toggles: {}, samplers: {} });
    const deps = { ...s.deps, readPreset: async () => preset };
    const events: TurnEvent[] = [];
    const done = runTurn(deps, { chatId: s.chat.id, kind: "reply", expectedVersion: await s.version(), inspect: true }, (event) => events.push(event));
    await waitFor(events, "review");
    const review = events.find((event): event is Extract<TurnEvent, { type: "review" }> => event.type === "review")!;
    expect(review.files?.map((file) => file.name)).toEqual(["cover.png", "notes.txt", "brief.pdf"]);
    expect(review.mediaEstimateIncomplete).toBe(true);
    answerReview(deps.runtime, s.chat.id, review.turnId, { kind: "send", edits: { [String(review.files![1]!.message)]: "Reviewed literal text." } });
    await done;
    expect(sent).toHaveLength(1);
    const files = sent[0]!.messages.filter((message) => message.attachments?.length);
    expect(files.map((message) => message.attachments![0]!.kind)).toEqual(["image", "pdf"]);
    expect(sent[0]!.messages.find((message) => message.content.includes("Reviewed literal text."))?.content).toBe("Reviewed literal text.");
    expect(review.files?.[1]).toMatchObject({ name: "notes.txt", kind: "text" });
    const last = await lastOf(s.chats, s.chat.activeBranchId);
    const trace = await s.chats.swipeTrace(last.id, last.swipes[0]!.id);
    if (!trace) throw new Error("the committed reply trace is unavailable");
    const lastRequest = await s.chats.lastRequest(s.chat.activeBranchId);
    expect(lastRequest?.files).toHaveLength(3);
    expect((trace["blocks"] as unknown[]).length).toBe(lastRequest!.texts.length);
  });

  test("an inspected request is not reused if model fallback changes its synthetic tail", async () => {
    const main = scripted({ pieces: [], fail: new ProviderError("overloaded", { category: "service_unavailable", code: "service_unavailable", status: 503 }) });
    const fallback = scripted({ pieces: ["Fallback reply."] });
    const s = await scene(main.provider);
    await s.chats.setConnection(s.chat.id, { id: "main", model: "claude-opus-4.6" });
    await s.chats.setPrompting(s.chat.id, { prefill: "Begin:" });
    const deps = { ...s.deps, connect: async (connection: { id: string }) => connection.id === "backup"
      ? { provider: fallback.provider, kind: "openrouter" as const, context: 32_000 }
      : { provider: main.provider, kind: "openrouter" as const, context: 32_000 } };
    const events: TurnEvent[] = [];
    const done = runTurn(deps, { chatId: s.chat.id, kind: "reply", expectedVersion: await s.version(), inspect: true, fallback: { id: "backup", model: "claude-opus-4.5" } }, (event) => events.push(event));
    await waitFor(events, "review");
    const review = events.find((event): event is Extract<TurnEvent, { type: "review" }> => event.type === "review")!;
    answerReview(deps.runtime, s.chat.id, review.turnId, { kind: "send", edits: {} });
    await done;
    expect(main.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "failed", message: expect.stringContaining("fallback model changes the reviewed prompt") });
  });

  test("stored request and trace match successful fallback messages", async () => {
    const main = scripted({ pieces: [], fail: new ProviderError("overloaded", { category: "service_unavailable", code: "service_unavailable", status: 503 }) });
    const fallback = scripted({ pieces: ["Fallback reply."] });
    const s = await scene(main.provider);
    await s.chats.setConnection(s.chat.id, { id: "main", model: "claude-opus-4.5" });
    await s.chats.setPrompting(s.chat.id, { prefill: "Begin:" });
    const deps = { ...s.deps, connect: async (connection: { id: string }) => connection.id === "backup"
      ? { provider: fallback.provider, kind: "openrouter" as const, context: 32_000 }
      : { provider: main.provider, kind: "openrouter" as const, context: 32_000 } };
    await runTurn(deps, { chatId: s.chat.id, kind: "reply", expectedVersion: await s.version(), fallback: { id: "backup", model: "claude-opus-4.6" } }, () => undefined);
    expect(main.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(1);
    const lastRequest = await s.chats.lastRequest(s.chat.activeBranchId);
    expect(lastRequest?.texts).toEqual(fallback.sent[0]!.messages.map((message) => message.content));
    expect(lastRequest?.texts.some((text) => text === "Begin:")).toBe(false);
    const last = await lastOf(s.chats, s.chat.activeBranchId);
    const trace = await s.chats.swipeTrace(last.id, last.swipes[last.current]!.id);
    if (!trace) throw new Error("the committed fallback trace is unavailable");
    expect((trace["blocks"] as unknown[]).length).toBe(lastRequest!.texts.length);
  });
});
