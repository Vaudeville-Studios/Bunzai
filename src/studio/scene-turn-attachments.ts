/** Resolves canonical prompt media refs only at the model boundary; previews never receive file bytes. */
import { embeddedMediaBytes, parseUploadedRef } from "../entities/piece-parts-blob";
import type { PresetAttachment } from "../entities/preset/schema";
import { PROMPT_ATTACHMENT_MIMES, isPromptImageMime, isPromptTextMime, promptTextFromBytes, rasterImageMimeFromBytes } from "../core/media/mime";
import { ASSET_MAX_BYTES, PROMPT_ATTACHMENT_REQUEST_BYTES, PROMPT_ATTACHMENT_REQUEST_COUNT, PROMPT_TEXT_ATTACHMENT_MAX_BYTES } from "../core/media/limits";
import { IMAGE_MAX_BYTES } from "../core/media/image-limit";
import type { AssetLookup } from "../stage/contracts/content-store";
import type { ProviderAttachment, ProviderMessage } from "../stage/contracts/provider";
import { StudioValidationError } from "./errors";
import { countText } from "../core/tokens";
import type { AssembledRole, TraceBlock } from "../core/assembly/types";
import { promptAttachmentOwnerLabel, type PromptAttachmentInfo } from "../core/media/prompt-attachment";

type ReadAsset = (sha: string, maxBytes: number) => Promise<AssetLookup>;
export type PromptMessage = Omit<ProviderMessage, "attachments"> & { attachments?: readonly PresetAttachment[]; attachmentOwner?: { id: string; name: string } };
export interface ResolvedPromptMessages { messages: ProviderMessage[]; sourceKeys: string[]; sourceIndexes: number[]; files: PromptAttachmentInfo[] }

const textCompanion = (name: string, text: string) => `[Attached text: ${name}]\n${text}\n[End attached text]`;

async function bytesOf(attachment: PresetAttachment, readAsset: ReadAsset): Promise<{ mime: string; bytes: Uint8Array }> {
  if (attachment.ref.length > Math.ceil(ASSET_MAX_BYTES * 4 / 3) + 128) throw new StudioValidationError(`The attached file "${attachment.name}" exceeds the per-file limit.`);
  const embedded = embeddedMediaBytes(attachment.ref);
  const ref = parseUploadedRef(attachment.ref);
  const actual = embedded ?? (ref ? await (async () => {
    const read = await readAsset(ref.sha, ASSET_MAX_BYTES);
    return read.status === "ok" ? { mime: ref.mime, bytes: read.bytes } : undefined;
  })() : undefined);
  if (!actual || actual.bytes.byteLength > ASSET_MAX_BYTES || !PROMPT_ATTACHMENT_MIMES.includes(actual.mime as typeof PROMPT_ATTACHMENT_MIMES[number])) {
    throw new StudioValidationError(`The attached file "${attachment.name}" is missing or uses unsupported media.`);
  }
  const verified = isPromptImageMime(actual.mime)
    ? rasterImageMimeFromBytes(actual.bytes)
    : actual.mime === "application/pdf" ? (new TextDecoder().decode(actual.bytes.subarray(0, 5)) === "%PDF-" ? "application/pdf" : undefined)
    : isPromptTextMime(actual.mime) ? (promptTextFromBytes(actual.bytes, PROMPT_TEXT_ATTACHMENT_MAX_BYTES) !== undefined ? actual.mime : undefined)
    : undefined;
  if (verified !== actual.mime) throw new StudioValidationError(`The attached file "${attachment.name}" no longer matches its recorded media type.`);
  if (actual.mime.startsWith("image/") && actual.bytes.byteLength > IMAGE_MAX_BYTES) throw new StudioValidationError(`The image "${attachment.name}" exceeds the image limit.`);
  return actual;
}

/** Converts refs into the shared provider value shape, preserving authored roles with user companions. */
export async function resolvePromptAttachments(messages: readonly PromptMessage[], readAsset: ReadAsset | undefined): Promise<ResolvedPromptMessages> {
  let total = 0;
  const result: ProviderMessage[] = [];
  const sourceKeys: string[] = [];
  const sourceIndexes: number[] = [];
  const files: ResolvedPromptMessages["files"] = [];
  for (const [sourceIndex, message] of messages.entries()) {
    const refs = message.attachments ?? [];
    const { attachments: _refs, attachmentOwner: _owner, ...plainMessage } = message;
    if (!refs.length) { result.push(plainMessage); sourceKeys.push(`m${result.length - 1}`); sourceIndexes.push(sourceIndex); continue; }
    if (!readAsset && refs.some((ref) => !ref.ref.startsWith("data:"))) throw new StudioValidationError("Prompt attachments are unavailable in this host.");
    result.push(plainMessage);
    sourceKeys.push(`m${result.length - 1}`);
    sourceIndexes.push(sourceIndex);
    for (const item of refs) {
      const { mime, bytes } = await bytesOf(item, readAsset ?? (() => Promise.resolve({ status: "missing" })));
      total += bytes.byteLength;
      if (total > PROMPT_ATTACHMENT_REQUEST_BYTES) throw new StudioValidationError("Prompt attachments exceed the 16 MiB per-request limit. Remove a file or send a smaller set.");
      const companionIndex = result.length;
      const owner = promptAttachmentOwnerLabel(message.attachmentOwner?.name ?? "prompt block");
      const prefix = `Files attached to "${owner}"`;
      if (isPromptTextMime(mime)) {
        if (bytes.byteLength > PROMPT_TEXT_ATTACHMENT_MAX_BYTES) throw new StudioValidationError(`The text file "${item.name}" exceeds the 2 MiB limit.`);
        const text = promptTextFromBytes(bytes, PROMPT_TEXT_ATTACHMENT_MAX_BYTES);
        if (text === undefined) throw new StudioValidationError(`The text file "${item.name}" contains unsupported binary or control bytes.`);
        result.push({ role: "user", content: `${prefix}\n${textCompanion(item.name, text)}` });
        sourceKeys.push(`a${result.length - 1}`);
        sourceIndexes.push(sourceIndex);
        files.push({ message: companionIndex, name: item.name, kind: "text", ...(message.attachmentOwner ? { owner } : {}) });
      } else if (isPromptImageMime(mime)) {
        const attachment: ProviderAttachment = { kind: "image", name: item.name, mime: mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", dataUri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
        result.push({ role: "user", content: prefix, attachments: [attachment] });
        sourceKeys.push(`a${result.length - 1}`);
        sourceIndexes.push(sourceIndex);
        files.push({ message: companionIndex, name: item.name, kind: "image", ...(message.attachmentOwner ? { owner } : {}) });
      } else if (mime === "application/pdf") {
        const attachment: ProviderAttachment = { kind: "pdf", name: item.name, base64: Buffer.from(bytes).toString("base64") };
        result.push({ role: "user", content: prefix, attachments: [attachment] });
        sourceKeys.push(`a${result.length - 1}`);
        sourceIndexes.push(sourceIndex);
        files.push({ message: companionIndex, name: item.name, kind: "pdf", ...(message.attachmentOwner ? { owner } : {}) });
      } else throw new StudioValidationError(`The attached file "${item.name}" uses unsupported media.`);
      if (files.length > PROMPT_ATTACHMENT_REQUEST_COUNT) throw new StudioValidationError(`A request can include at most ${PROMPT_ATTACHMENT_REQUEST_COUNT} prompt attachments.`);
    }
  }
  return { messages: result, sourceKeys, sourceIndexes, files };
}

export function traceResolvedPromptMessages(trace: readonly TraceBlock[], resolved: ResolvedPromptMessages, messages: readonly ProviderMessage[] = resolved.messages): TraceBlock[] {
  const files = new Map(resolved.files.map((file) => [file.message, file]));
  return messages.map((message, index) => {
    const file = files.get(index);
    const source = file ? { kind: "prompt" as const, name: `Attachment: ${file.name}` } : trace[resolved.sourceIndexes[index]!]?.source ?? { kind: "prompt" as const, name: "Provider request" };
    return { source, role: message.role as AssembledRole, tokens: countText(message.content) };
  });
}

export function applyPromptReview(messages: readonly ProviderMessage[], sourceKeys: readonly string[], edits: Readonly<Record<number, string>>, saved: Map<string, string>): ProviderMessage[] {
  for (const [index, content] of Object.entries(edits)) {
    const key = sourceKeys[Number(index)];
    if (key) saved.set(key, content);
  }
  return messages.map((message, index) => saved.has(sourceKeys[index]!) ? { ...message, content: saved.get(sourceKeys[index]!)! } : message);
}
