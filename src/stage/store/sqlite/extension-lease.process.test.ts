/** Real two-process lease contention and expired-owner fencing on a throwaway SQLite fixture. */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cellCipher } from "../../crypto/cell-cipher";
import { subkeys } from "../../crypto/crypto";
import { openStageDatabase } from "./database";
import { sqliteExtensionStore } from "./extension-store";
import { attachRowFingerprints } from "./row-fingerprints";
import { createContentStore } from "../content-store";
import { sqliteDocumentBackend } from "./document-backend";
import { sha256HexBytes } from "../../../core/sha256";
import { castSnapshotCodec } from "../cast-snapshot-codec";
import { sqliteChatStoreBackend } from "./chat-store";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const uuid = (n: string): string => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const readers = new WeakMap<ReadableStream<Uint8Array>, { reader: ReadableStreamDefaultReader<Uint8Array>; text: string }>();
async function line(stream: ReadableStream<Uint8Array>): Promise<string> {
  const state = readers.get(stream) ?? { reader: stream.getReader(), text: "" };
  readers.set(stream, state);
  while (true) {
    const at = state.text.indexOf("\n");
    if (at >= 0) { const result = state.text.slice(0, at); state.text = state.text.slice(at + 1); return result; }
    const { value, done } = await state.reader.read(); state.text += value ? new TextDecoder().decode(value) : "";
    if (done) return state.text;
  }
}
async function remaining(stream: ReadableStream<Uint8Array>): Promise<string> {
  const state = readers.get(stream) ?? { reader: stream.getReader(), text: "" };
  readers.set(stream, state);
  let text = state.text; state.text = "";
  while (true) {
    const { value, done } = await state.reader.read();
    if (value) text += new TextDecoder().decode(value);
    if (done) return text;
  }
}

test("only one process owns the runtime and a resumed expired owner cannot write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-extension-lease-")); dirs.push(dir);
  const path = join(dir, "fixture.db"); const key = Buffer.alloc(32, 7).toString("base64");
  const packageDigest = sha256HexBytes(new TextEncoder().encode("two-process fixture package"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "extension-lease-child.ts"), path, uuid("1"), "1000", "hold", packageDigest], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true,
    env: { ...process.env, BUNZAI_EXTENSION_TEST_KEY: key },
  });
  const firstLine = await line(child.stdout!);
  if (!firstLine) throw new Error(`lease child exited before acquiring: ${await line(child.stderr!)}`);
  const first = JSON.parse(firstLine) as { owner: string; epoch: number; recoveryRequired: boolean };
  expect(first).toMatchObject({ owner: uuid("1"), epoch: 1, recoveryRequired: false });
  const second = Bun.spawn([process.execPath, join(import.meta.dir, "extension-lease-child.ts"), path, uuid("2"), "1001", "once"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true,
    env: { ...process.env, BUNZAI_EXTENSION_TEST_KEY: key },
  });
  expect(await line(second.stdout!)).toBe("null");
  expect(await second.exited).toBe(0);

  const database = openStageDatabase(path, (await import("./migrations")).MIGRATIONS);
  const cipher = cellCipher(() => subkeys(Buffer.from(key, "base64")));
  attachRowFingerprints(database, cipher);
  const takeover = await sqliteExtensionStore(database, cipher, () => 31_001).acquireRuntimeFence(uuid("3"), 31_001, 30_000);
  expect(takeover).toMatchObject({ owner: uuid("3"), epoch: 2, recoveryRequired: true });
  child.stdin!.write("resume\n"); child.stdin!.end();
  expect(await line(child.stdout!)).toBe("FENCED");
  expect(await child.exited).toBe(0);
  const restored = await createContentStore(sqliteDocumentBackend(database, cipher)).read("character", "Ada");
  expect(restored?.entity.kind === "character" ? restored.entity.body.identity.name : null).toBe("Ada");
  await sqliteExtensionStore(database, cipher, () => 31_001).releaseRuntimeFence(takeover!);
  database.close();
});

test("a second process revoking a paused extension turn blocks stale and first-party checkpoint commits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-extension-turn-lease-")); dirs.push(dir);
  const path = join(dir, "fixture.db"), key = Buffer.alloc(32, 9).toString("base64");
  const packageDigest = sha256HexBytes(new TextEncoder().encode("two-process fixture package"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "extension-lease-child.ts"), path, uuid("11"), "1000", "paused-turn", packageDigest], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true,
    env: { ...process.env, BUNZAI_EXTENSION_TEST_KEY: key },
  });
  const readyLine = await line(child.stdout!);
  if (!readyLine) throw new Error(`paused turn child exited before checkpoint: ${await line(child.stderr!)}`);
  const paused = JSON.parse(readyLine) as { owner: string; epoch: number; chatId: string; branchId: string; turnId: string };
  expect(paused).toMatchObject({ owner: uuid("11"), epoch: 1 });

  const database = openStageDatabase(path, (await import("./migrations")).MIGRATIONS);
  const cipher = cellCipher(() => subkeys(Buffer.from(key, "base64")));
  attachRowFingerprints(database, cipher);
  const extensions = sqliteExtensionStore(database, cipher, () => 31_001);
  const takeover = await extensions.acquireRuntimeFence(uuid("12"), 31_001, 30_000);
  expect(takeover).toMatchObject({ owner: uuid("12"), epoch: 2, recoveryRequired: true });
  const control = await extensions.readControl("fixture.turn");
  if (!control) throw new Error("paused turn control is missing");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: control.revision + 1 }, control.revision, takeover!)).toBe("saved");
  child.stdin!.write("resume\n"); child.stdin!.end();
  expect(await line(child.stdout!)).toBe("FENCED:FIRST_PARTY_BLOCKED");
  expect(await child.exited).toBe(0);

  const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => 31_001);
  expect((await chats.readMessages(paused.branchId, { limit: 10 })).messages).toHaveLength(0);
  expect(await chats.sceneState(paused.branchId)).toEqual({});
  expect(await chats.dropTurn(paused.turnId)).toBe(true);
  await extensions.releaseRuntimeFence(takeover!);
  database.close();
});

test("a second process revoking during a real Core summary send prevents follow-on writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-extension-summary-lease-")); dirs.push(dir);
  const path = join(dir, "fixture.db"), key = Buffer.alloc(32, 11).toString("base64");
  const packageDigest = sha256HexBytes(new TextEncoder().encode("two-process summary fixture"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "extension-summary-child.ts"), path, uuid("21"), "1000", packageDigest], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true,
    env: { ...process.env, BUNZAI_EXTENSION_TEST_KEY: key },
  });
  const readyLine = await line(child.stdout!);
  if (!readyLine) throw new Error(`summary child exited before turn start: ${await line(child.stderr!)}`);
  const paused = JSON.parse(readyLine) as { owner: string; epoch: number; chatId: string; branchId: string };
  expect(paused).toMatchObject({ owner: uuid("21"), epoch: 1 });
  const waitingLine = await line(child.stdout!);
  if (waitingLine !== "SUMMARY_WAITING") {
    await child.exited;
    throw new Error(`summary child did not pause in its provider: ${waitingLine}; ${await remaining(child.stderr!)}`);
  }

  const database = openStageDatabase(path, (await import("./migrations")).MIGRATIONS);
  const cipher = cellCipher(() => subkeys(Buffer.from(key, "base64")));
  attachRowFingerprints(database, cipher);
  const extensions = sqliteExtensionStore(database, cipher, () => 31_001);
  const takeover = await extensions.acquireRuntimeFence(uuid("22"), 31_001, 30_000);
  expect(takeover).toMatchObject({ owner: uuid("22"), epoch: 2, recoveryRequired: true });
  const control = await extensions.readControl("fixture.summary");
  if (!control) throw new Error("paused summary control is missing");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: control.revision + 1 }, control.revision, takeover!)).toBe("saved");
  child.stdin!.write("resume\n"); child.stdin!.end();
  expect(await line(child.stdout!)).toBe("SUMMARY_FINISHED");
  expect(await child.exited).toBe(0);

  const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => 31_001);
  expect(await chats.summaryOf(paused.branchId)).toBeNull();
  expect((await chats.getChat(paused.chatId))?.summary?.error ?? null).toBeNull();
  expect(await chats.listReceipts(paused.chatId)).toEqual([]);
  expect(await chats.sceneState(paused.branchId)).toEqual({});
  await extensions.releaseRuntimeFence(takeover!);
  database.close();
});
