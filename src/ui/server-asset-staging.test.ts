/** Staged uploads: sealed on disk as they stream in, bounded by type, and gone when anything stops them. */
import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { IMAGE_MAX_BYTES } from "../core/media/image-limit";
import { ASSET_MAX_BYTES } from "../core/media/limits";
import { clearStagedAssets, openSessionUploads, stageAssetStream, stageAssetUpload } from "./server-asset-staging";

const PNG_HEAD = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const MP4_HEAD = Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0);
const png = (size: number): Uint8Array => { const bytes = new Uint8Array(size).map((_, i) => (i * 7) % 256); bytes.set(PNG_HEAD); return bytes; };
const stagingDirs = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("bunzai-asset-staged-"));
const unlocked = async (): Promise<boolean> => true;
const upload = (body: Uint8Array, name: string, extra: Record<string, string> = {}): Request =>
  new Request("http://x/api/asset/upload", { method: "POST", body: new Blob([body as BlobPart]), headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(name), ...extra } });
/** A stream of `chunks` that records whether the server cancelled it, and can run forever. */
function spied(chunk: Uint8Array, count: number | "forever") {
  const state = { cancelled: false, sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (count !== "forever" && state.sent >= count) return controller.close();
      state.sent++;
      controller.enqueue(chunk);
    },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}

afterEach(async () => { await clearStagedAssets(); });

test("a picture streams in sealed, and only its own session can open it, byte-exact", async () => {
  const bytes = png(300_000);
  const res = await stageAssetUpload(upload(bytes, "room.png"), "s1", unlocked);
  expect(res.status).toBe(200);
  const staged = (await res.json()) as { ref: string; sha: string; mime: string; bytes: number; asset: string };
  expect(staged).toMatchObject({ mime: "image/png", bytes: 300_000 });
  expect(staged.asset).toBe(`\u0000b:u:image/png:${staged.sha}`);
  await expect(openSessionUploads([staged.ref], "s2")).rejects.toMatchObject({ status: 403 });
  const [opened] = await openSessionUploads([staged.ref], "s1");
  expect(opened!.key).toBe(staged.sha);
  expect(opened!.payload).toMatchObject({ kind: "bytes" });
  expect([...(opened!.payload as { bytes: Uint8Array }).bytes]).toEqual([...bytes]);
});

test("PDF and UTF-8 prompt text stage as sealed bytes with byte-verified MIME", async () => {
  const cases = [
    { name: "guide.pdf", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF"), mime: "application/pdf" },
    { name: "notes.md", bytes: new TextEncoder().encode("{{setvar::mood::calm}} literal notes"), mime: "text/markdown" },
  ];
  for (const item of cases) {
    const response = await stageAssetStream(new Blob([item.bytes]).stream(), { filename: item.name, signal: new AbortController().signal }, "s1", unlocked);
    expect(response.status).toBe(200);
    const receipt = await response.json() as { mime: string; ref: string };
    expect(receipt.mime).toBe(item.mime);
    const [blob] = await openSessionUploads([receipt.ref], "s1");
    expect((blob!.payload as { bytes: Uint8Array }).bytes).toEqual(item.bytes);
  }
});

test("text extensions refuse invalid UTF-8 and known binary signatures", async () => {
  for (const bytes of [Uint8Array.of(0xff, 0xfe), png(16)]) {
    const response = await stageAssetStream(new Blob([Uint8Array.from(bytes).buffer]).stream(), { filename: "notes.txt", signal: new AbortController().signal }, "s1", unlocked);
    expect(response.status).toBe(415);
  }
});

test("a picture over the image limit is cut off mid-stream, cancelled upstream, and leaves nothing on disk", async () => {
  const before = stagingDirs();
  const { stream, state } = spied(png(1024 * 1024), "forever");
  const res = await stageAssetStream(stream, { filename: "huge.png", signal: new AbortController().signal }, "s1", unlocked);
  expect(res.status).toBe(413);
  expect(state.cancelled).toBe(true);
  expect(state.sent).toBeLessThanOrEqual(IMAGE_MAX_BYTES / (1024 * 1024) + 2);
  expect(stagingDirs()).toEqual(before);
});

test("a video keeps the larger media limit", async () => {
  const head = new Uint8Array(1024 * 1024); head.set(MP4_HEAD);
  const { stream } = spied(head, IMAGE_MAX_BYTES / (1024 * 1024) + 2);
  const res = await stageAssetStream(stream, { filename: "loop.mp4", signal: new AbortController().signal }, "s1", unlocked);
  expect(res.status).toBe(200);
  expect(IMAGE_MAX_BYTES + 2 * 1024 * 1024).toBeLessThan(ASSET_MAX_BYTES);
});

test("a declared length over the limit for its type is refused before a byte is read", async () => {
  const res = await stageAssetUpload(upload(png(10), "a.png", { "content-length": String(IMAGE_MAX_BYTES + 1) }), "s1", unlocked);
  expect(res.status).toBe(413);
});

test("a stream that dies midway fails the upload and removes what it wrote", async () => {
  const before = stagingDirs();
  let sent = 0;
  const dying = new ReadableStream<Uint8Array>({ pull(c) { if (sent++ === 0) c.enqueue(png(5000)); else c.error(new Error("connection reset")); } });
  const res = await stageAssetStream(dying, { filename: "a.png", signal: new AbortController().signal }, "s1", unlocked);
  expect(res.status).toBe(400);
  expect(stagingDirs()).toEqual(before);
});

test("locking the library while an upload streams cancels it and removes its file", async () => {
  const before = stagingDirs();
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let step = 0;
  const slow = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (step++ === 0) return c.enqueue(png(5000));
      reached();
      await gate;
      c.enqueue(png(5000));
      c.close();
    },
  });
  const pending = stageAssetStream(slow, { filename: "a.png", signal: new AbortController().signal }, "s1", unlocked);
  await waiting;
  await clearStagedAssets();
  release();
  const res = await pending;
  expect(res.status).toBe(423);
  expect(stagingDirs()).toEqual(before);
});

test("a library that locks as the upload ends does not publish a grant", async () => {
  const before = stagingDirs();
  const res = await stageAssetStream(spied(png(2000), 1).stream, { filename: "a.png", signal: new AbortController().signal }, "s1", async () => false);
  expect(res.status).toBe(423);
  expect(stagingDirs()).toEqual(before);
});

test("bytes that do not match the extension are refused", async () => {
  const res = await stageAssetStream(spied(new Uint8Array(100), 1).stream, { filename: "a.png", signal: new AbortController().signal }, "s1", unlocked);
  expect(res.status).toBe(415);
});
