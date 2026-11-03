/** Prompt files survive encrypted saves, reopen, native folder interchange and shared-blob removal. */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import { bytesToBase64 } from "../../core/base64";
import { hashHex } from "../../core/sha256";
import { sheetAsPreset } from "../../core/preset/script-sheet";
import { emptyPromptbookBody } from "../../core/promptbook";
import { buildPiecePatch } from "../../entities/editor-patch";
import type { CanonicalPreset } from "../../entities/preset/schema";
import type { CanonicalPromptbook } from "../../entities/promptbook/schema";
import { parseCanonicalEntity } from "../../entities/runtime-schema";
import { createContentStore } from "./content-store";
import { openStageDatabase, type StageDatabase } from "./sqlite/database";
import { MIGRATIONS } from "./sqlite/migrations";
import { sqliteDocumentBackend } from "./sqlite/document-backend";
import { testCipher } from "./sqlite/test-support";
import { memoryStateStore } from "./memory/state-store";
import { writeHeldPiece } from "../../studio/folder-export-held";
import { importFolderIntoLibrary } from "../../studio/folder-import";
import { StudioValidationError } from "../../studio/errors";

const dirs: string[] = [], databases: StageDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
type Piece = CanonicalPreset | CanonicalPromptbook;
const bytes = new TextEncoder().encode(`%PDF-1.7\nATTACHED_PRIVATE_CONTENT\n${"opaque document bytes\n".repeat(1300)}%%EOF`);
const sha = hashHex(bytes);
const sentinel = `\u0000b:u:application/pdf:${sha}`;
const uri = `data:application/pdf;base64,${bytesToBase64(bytes)}`;

function piece(kind: Piece["kind"], ref?: string): Piece {
  const preset = sheetAsPreset({ name: "Files", content: "Read the attached source." });
  if (ref) preset.prompts[0]!.attachments = [{ name: "guide.pdf", ref }];
  if (kind === "preset") return { schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id: "files", body: preset, profiles: { other: { prompts: preset.prompts } } };
  const book = emptyPromptbookBody("Files");
  book.phases[0]!.preset = preset;
  return { schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id: "files", body: book, profiles: { other: { phases: book.phases } } };
}

function refs(entity: Piece): (string | undefined)[] {
  return entity.kind === "preset"
    ? [entity.body.prompts[0]?.attachments?.[0]?.ref, entity.profiles?.other?.prompts?.[0]?.attachments?.[0]?.ref]
    : [entity.body.phases[0]?.preset.prompts[0]?.attachments?.[0]?.ref, entity.profiles?.other?.phases?.[0]?.preset.prompts[0]?.attachments?.[0]?.ref];
}

test.each(["preset", "promptbook"] as const)("%s attachments are sealed, reopenable and portable without dead refs", async (kind) => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-prompt-files-"));
  dirs.push(dir);
  const path = join(dir, "library.db"), cipher = testCipher();
  let db = openStageDatabase(path, MIGRATIONS);
  let store = createContentStore(sqliteDocumentBackend(db, cipher), () => 1);
  const base = piece(kind);
  const created = await store.save(base);
  const next = piece(kind, sentinel);
  const saved = await store.patch(kind, base.id, created.revision, buildPiecePatch(base, next), [{ key: sha, payload: { kind: "bytes", bytes } }]);
  expect(saved.status).toBe("saved");
  expect(refs((await store.readHeld(kind, base.id))!.entity as Piece)).toEqual([sentinel, sentinel]);
  expect((await store.readAsset(sha, bytes.length)).status).toBe("ok");
  expect(refs((await store.readLight(kind, base.id))!.entity as Piece)).toEqual([sentinel, sentinel]);
  expect((await store.patch(kind, base.id, created.revision, buildPiecePatch(base, next))).status).toBe("stale");
  const before = (await store.read(kind, base.id))!;
  const forged = piece(kind, `\u0000b:u:application/pdf:${"bc".repeat(32)}`);
  const error = await store.patch(kind, base.id, before.revision, buildPiecePatch(next, forged)).then(() => null, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(StudioValidationError);
  expect((await store.read(kind, base.id))!.revision).toBe(before.revision);
  db.close();
  expect(readFileSync(path).includes(Buffer.from("ATTACHED_PRIVATE_CONTENT"))).toBe(false);
  db = openStageDatabase(path, MIGRATIONS);
  databases.push(db);
  store = createContentStore(sqliteDocumentBackend(db, cipher), () => 1);
  const reopened = (await store.read(kind, base.id))!;
  expect(refs(reopened.entity as Piece)).toEqual([uri, uri]);
  const held = (await store.readHeld(kind, base.id))!;
  const folder = join(dir, "export"), kindDir = join(folder, kind);
  mkdirSync(kindDir, { recursive: true });
  const exported = join(kindDir, "files.json");
  await writeHeldPiece(exported, held.entity, (key, max) => store.readAsset(key, max), `${kind} files`);
  expect(refs(parseCanonicalEntity(JSON.parse(readFileSync(exported, "utf8"))) as Piece)).toEqual([uri, uri]);
  const importDb = openStageDatabase(join(dir, "imported.db"), MIGRATIONS);
  databases.push(importDb);
  const imported = createContentStore(sqliteDocumentBackend(importDb, testCipher()), () => 1);
  const result = await importFolderIntoLibrary(folder, { content: imported, state: memoryStateStore() }, { freeSpace: () => 1024 ** 3 });
  expect(result).toMatchObject({ pieces: 1, damaged: [] });
  expect(refs((await imported.read(kind, base.id))!.entity as Piece)).toEqual([uri, uri]);
  const duplicate = (await store.duplicate(kind, base.id))!;
  expect(await store.delete(kind, base.id)).toBe(true);
  await store.purge(Number.MAX_SAFE_INTEGER);
  expect(refs((await store.read(kind, duplicate.id))!.entity as Piece)).toEqual([uri, uri]);
  expect(await store.readAsset(sha, bytes.length)).toMatchObject({ status: "ok", bytes });
  const keeper = (await store.duplicate(kind, duplicate.id))!;
  const without = { ...piece(kind), id: duplicate.id };
  const copy = (await store.read(kind, duplicate.id))!;
  expect((await store.saveIfUnchanged(without, copy.revision)).status).toBe("saved");
  expect(refs((await store.read(kind, duplicate.id))!.entity as Piece)).toEqual([undefined, undefined]);
  expect(refs((await store.read(kind, keeper.id))!.entity as Piece)).toEqual([uri, uri]);
  expect((await store.readAsset(sha, bytes.length)).status).toBe("ok");
  expect(refs((await imported.read(kind, base.id))!.entity as Piece)).toEqual([uri, uri]);
});
