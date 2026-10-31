/** Proves asset reads are tied to a selected piece's canonical media slots and bounded byte request. */
import { expect, test } from "bun:test";
import { bytesToBase64 } from "../../core/base64";
import { sha256HexBytes } from "../../core/sha256";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { createExtensionAssetServices } from "./asset-services";

test("only referenced body media blobs list and read under the exact piece scope", async () => {
  const bytes = Uint8Array.from({ length: 20_000 }, (_, index) => index % 251);
  const base64 = bytesToBase64(bytes);
  const store = createContentStore(memoryDocumentBackend());
  await store.create({
    schemaVersion: "1", kind: "character", id: "mira",
    body: { identity: { name: "Mira" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: { portrait: { role: "portrait", ref: `data:image/png;base64,${base64}` } }, attribution: {}, discovery: {} },
  });
  const services = createExtensionAssetServices(store);
  const scope = [{ kind: "character", id: "mira" }];
  const [asset] = await services.list("character", "mira", scope);
  expect(asset).toEqual({ sha: sha256HexBytes(bytes), mime: "image/png", bytes: bytes.byteLength });
  expect(await services.read("character", "mira", asset!.sha, scope, 100)).toEqual({ status: "too-large", mime: "image/png", bytes: bytes.byteLength });
  const read = await services.read("character", "mira", asset!.sha, scope, bytes.byteLength);
  expect(read?.status).toBe("ok");
  if (read?.status === "ok") expect(read.bytes).toEqual(bytes);
  expect(await services.read("character", "mira", "f".repeat(64), scope, bytes.byteLength)).toBeNull();
  await expect(services.list("character", "other", scope)).rejects.toThrow();
});
