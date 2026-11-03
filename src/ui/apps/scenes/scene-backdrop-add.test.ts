/** Adding images to a pack from the backdrop picker: unique labels, and saves of at most eight files. */
import { expect, test } from "bun:test";
import type { AppContext } from "../../app-contract";
import { addImagesToPack, createPackWithImages, uniqueLabel } from "./scene-backdrop-add";

test("a label comes from the file name and never repeats one already in the pack", () => {
  expect(uniqueLabel(new Set(), "harbor.jpg")).toBe("harbor");
  expect(uniqueLabel(new Set(["harbor"]), "Harbor.png")).toBe("Harbor 2");
  expect(uniqueLabel(new Set(["harbor", "harbor 2"]), "harbor.png")).toBe("harbor 3");
});

const pack = { schemaVersion: "1", kind: "pack", id: "st", body: { name: "Backdrops", pack: { items: [] } } };

function rig(failName?: string) {
  const patches: { uploads: string[]; items: number }[] = [];
  let body = structuredClone(pack.body) as { pack: { items: unknown[] } };
  const api = {
    uploadAsset: async (file: File) => {
      if (file.name === failName) throw new Error("no");
      return { sha: "a".repeat(64), mime: "image/jpeg", bytes: 1, ref: `receipt-${file.name}`, asset: `\u0000b:u:image/jpeg:${"a".repeat(64)}` };
    },
    getLightEditableEntity: async () => ({ entity: { ...pack, body }, revision: "r1" }),
    patchEditedEntity: async (_k: string, _id: string, _rev: string, patch: { head?: { body?: { pack?: { items: unknown[] } } } }, uploads: string[]) => {
      body = { ...body, pack: { items: patch.head?.body?.pack?.items ?? body.pack.items } } as typeof body;
      patches.push({ uploads, items: body.pack.items.length });
      return { revision: "r2" };
    },
    discardAssetUploads: async () => undefined,
  };
  return { ctx: { api } as unknown as AppContext, patches };
}

test("thirty-nine files go in five saves of at most eight, every receipt named once", async () => {
  const { ctx, patches } = rig();
  const files = Array.from({ length: 39 }, (_, i) => new File(["x"], `bg${String(i)}.jpg`));
  const result = await addImagesToPack(ctx, "st", files);
  expect(result.added).toBe(39);
  expect(result.failed).toEqual([]);
  expect(result.items).toHaveLength(39);
  expect(patches.map((p) => p.uploads.length)).toEqual([8, 8, 8, 8, 7]);
  expect(patches.at(-1)!.items).toBe(39);
  expect(new Set(patches.flatMap((p) => p.uploads)).size).toBe(39);
});

test("a file that will not stage is listed as failed and the rest still go in", async () => {
  const { ctx } = rig("bg1.jpg");
  const result = await addImagesToPack(ctx, "st", [new File(["x"], "bg0.jpg"), new File(["x"], "bg1.jpg")]);
  expect(result.added).toBe(1);
  expect(result.failed).toEqual(["bg1.jpg"]);
});

test("a newly created empty backdrop pack is removed when every image fails to stage", async () => {
  const { ctx } = rig("bad.jpg");
  const api = ctx.api as unknown as Record<string, (...args: never[]) => unknown>;
  let deleted = "";
  api.saveEntity = async () => ({ id: "empty-pack", kind: "pack", name: "Backdrops", accent: "" });
  api.deleteEntity = async (_kind, id) => { deleted = id as string; return { deleted: true }; };
  const result = await createPackWithImages(ctx, [new File(["x"], "bad.jpg")]);
  expect(result.added).toBe(0);
  expect(result.failed).toEqual(["bad.jpg"]);
  expect(deleted).toBe("empty-pack");
});

test("a link is staged by the studio and added; a refusal comes back in the studio's words", async () => {
  const { ctx, patches } = rig();
  (ctx.api as unknown as { uploadAssetFromUrl: (u: string) => Promise<unknown> }).uploadAssetFromUrl = async () => ({ sha: "a".repeat(64), mime: "video/mp4", bytes: 1, ref: "receipt-link", asset: "x" });
  const { addLinkToPack } = await import("./scene-backdrop-add");
  expect((await addLinkToPack(ctx, "st", "https://cdn.example/clips/Rain.mp4?x=1")).added).toBe(1);
  expect(patches[0]!.uploads).toEqual(["receipt-link"]);
  (ctx.api as unknown as { uploadAssetFromUrl: (u: string) => Promise<unknown> }).uploadAssetFromUrl = async () => { throw new Error("Only https links can be added."); };
  const refused = await addLinkToPack(ctx, "st", "http://x.example/a.png");
  expect(refused).toMatchObject({ added: 0, failed: ["http://x.example/a.png"], reason: "Only https links can be added." });
});
