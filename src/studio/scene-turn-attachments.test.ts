/** Provider-boundary tests for resolved prompt attachment order and value metadata. */
import { describe, expect, test } from "bun:test";
import { toWireMessages } from "../stage/provider/openai-compatible-request";
import { toAnthropicWire } from "../stage/provider/anthropic-request";
import { applyPromptReview, resolvePromptAttachments } from "./scene-turn-attachments";

const data = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

describe("prompt attachment resolution", () => {
  test("keeps interleaved image, literal text, and PDF order at the actual provider wire", async () => {
    const resolved = await resolvePromptAttachments([{
      role: "system", content: "Instruction", attachmentOwner: { id: "p1", name: "Reference" },
      attachments: [
        { name: "cover.png", ref: data("image/png", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) },
        { name: "notes.txt", ref: data("text/plain", new TextEncoder().encode("keep the blue coat")) },
        { name: "brief.pdf", ref: data("application/pdf", new TextEncoder().encode("%PDF-1.7\nbrief")) },
      ],
    }], undefined);
    expect(resolved.messages.map((message) => message.role)).toEqual(["system", "user", "user", "user"]);
    expect(resolved.sourceKeys).toEqual(["m0", "a1", "a2", "a3"]);
    expect(resolved.files.map((file) => [file.message, file.name])).toEqual([[1, "cover.png"], [2, "notes.txt"], [3, "brief.pdf"]]);
    const openAI = toWireMessages(resolved.messages, { connectionId: "openai", model: "gpt-test", pdfAttachments: true });
    expect((openAI[1]!.content as { type: string }[]).map((part) => part.type)).toEqual(["text", "image_url"]);
    expect(openAI[2]!.content).toContain("keep the blue coat");
    expect((openAI[3]!.content as { type: string }[]).map((part) => part.type)).toEqual(["text", "file"]);
    const anthropic = toAnthropicWire(resolved.messages);
    expect((anthropic.messages[0]!.content as { type: string }[]).map((part) => part.type)).toEqual(["text", "image", "text", "text", "document"]);
  });

  test("review edits follow resolved companions and leave their media untouched", async () => {
    const resolved = await resolvePromptAttachments([{
      role: "user", content: "question", attachmentOwner: { id: "p1", name: "Question" },
      attachments: [{ name: "notes.txt", ref: data("text/plain", new TextEncoder().encode("source")) }],
    }], undefined);
    const saved = new Map<string, string>();
    const reviewed = applyPromptReview(resolved.messages, resolved.sourceKeys, { 1: "reviewed file text" }, saved);
    expect(reviewed[0]!.content).toBe("question");
    expect(reviewed[1]!.content).toBe("reviewed file text");
    expect(saved.get("a1")).toBe("reviewed file text");
  });

  test("stored owner labels are bounded without changing the authored block name", async () => {
    const name = "Reference".repeat(50);
    const resolved = await resolvePromptAttachments([{
      role: "user", content: "question", attachmentOwner: { id: "p1", name },
      attachments: [{ name: "notes.txt", ref: data("text/plain", new TextEncoder().encode("source")) }],
    }], undefined);
    expect(resolved.files[0]!.owner).toBe(`${name.slice(0, 252)}...`);
    expect(resolved.files[0]!.owner).toHaveLength(255);
  });

  test("Anthropic omits an empty caption but keeps attachment content", () => {
    const wire = toAnthropicWire([{ role: "user", content: "", attachments: [{ kind: "pdf", name: "brief.pdf", base64: "JVBERi0=" }] }]);
    expect(wire.messages[0]!.content).toEqual([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" }, title: "brief.pdf" }]);
  });

  test("an attachment-only prompt survives resolver and Anthropic role merging without an empty text block", async () => {
    const resolved = await resolvePromptAttachments([{
      role: "user", content: "", attachments: [{ name: "brief.pdf", ref: data("application/pdf", new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")) }],
    }], undefined);
    const wire = toAnthropicWire(resolved.messages);
    const parts = wire.messages[0]!.content as { type: string; text?: string }[];
    expect(parts.filter((part) => part.type === "text" && part.text === "")).toEqual([]);
    expect(parts.at(-1)).toMatchObject({ type: "document", source: { media_type: "application/pdf" }, title: "brief.pdf" });
  });
});
