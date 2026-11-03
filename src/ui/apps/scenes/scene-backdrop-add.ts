/**
 * Adds pictures and videos to a pack from the backdrop picker, through the pack editor's own chain: stage each file
 * (`uploadAsset`, or `uploadAssetFromUrl` for a link), then one patch save of the pack (`addPackItem`, `buildPiecePatch`,
 * `patchEditedEntity`) naming the staged receipts. A save carries at most ASSET_BATCH_COUNT files, the cap the pack editor's
 * staging admits, so a folder of 39 goes in five saves. A file that will not stage is listed, never silently dropped.
 * The pack is RoleCall's "saved backgrounds" library here: adding to it is "Save to library" (StageSettingsPanel.tsx:713-746).
 */
import { labelFromFilename, newPackItemId, normalizeLabel } from "../../../core/media";
import { addPackItem } from "../../../entities/pack/operations";
import { parseCanonicalEntity } from "../../../entities/runtime-schema";
import type { AppContext } from "../../app-contract";
import type { StagedAssetUpload } from "../../app-contract-editor";
import { buildPiecePatch } from "../../_shared/editor-patch";
import { ASSET_BATCH_COUNT } from "../../../core/media/limits";
import { toErrorMessage } from "../../../error-message";
import { createBlank } from "../../_shared/new-piece";
import { isPackPictureName } from "../../../core/media/pack-picture";

/** A label from the file name (or, when `literal`, the name itself: a title the person typed keeps its dots) that no label in `taken` already uses (a repeat gets " 2", " 3", ...). */
export function uniqueLabel(taken: ReadonlySet<string>, fileName: string, literal = false): string {
  const base = literal ? fileName.trim() : labelFromFilename(fileName);
  let label = base;
  for (let n = 2; taken.has(normalizeLabel(label)); n++) label = `${base} ${String(n)}`;
  return label;
}

export interface AddResult { added: number; failed: string[]; items: { id: string; label: string }[] }

/** One thing to add: its name for the label and the report, and how to stage it. */
export interface Source { name: string; stage(): Promise<StagedAssetUpload>; /** `name` is a title the person typed, not a file name. */ literal?: boolean }

export async function addToPack(ctx: AppContext, packId: string, sources: readonly Source[]): Promise<AddResult> {
  const result: AddResult = { added: 0, failed: [], items: [] };
  for (let at = 0; at < sources.length; at += ASSET_BATCH_COUNT) {
    const staged: { name: string; asset: string; mime: string; ref: string; literal: boolean }[] = [];
    for (const source of sources.slice(at, at + ASSET_BATCH_COUNT)) {
      try {
        const up = await source.stage();
        staged.push({ name: source.name, asset: up.asset, mime: up.mime, ref: up.ref, literal: source.literal === true });
      } catch {
        result.failed.push(source.name);
      }
    }
    if (staged.length === 0) continue;
    try {
      const loaded = await ctx.api.getLightEditableEntity(`kind=pack&id=${encodeURIComponent(packId)}`);
      const baseline = parseCanonicalEntity(loaded.entity);
      if (baseline.kind !== "pack") throw new Error("not a pack");
      const taken = new Set(baseline.body.pack.items.map((i) => normalizeLabel(i.label)));
      let body = baseline.body;
      const addedItems: { id: string; label: string }[] = [];
      for (const s of staged) {
        const label = uniqueLabel(taken, s.name, s.literal);
        taken.add(normalizeLabel(label));
        const id = newPackItemId();
        body = addPackItem(body, { id, label, ref: s.asset, mime: s.mime });
        addedItems.push({ id, label });
      }
      await ctx.api.patchEditedEntity("pack", packId, loaded.revision, buildPiecePatch(baseline, { ...baseline, body }), staged.map((s) => s.ref), "manual");
      result.added += staged.length;
      result.items.push(...addedItems);
    } catch {
      await ctx.api.discardAssetUploads(staged.map((s) => s.ref)).catch(() => undefined);
      result.failed.push(...staged.map((s) => s.name));
    }
  }
  return result;
}

export const addImagesToPack = (ctx: AppContext, packId: string, files: readonly File[]): Promise<AddResult> =>
  addToPack(ctx, packId, files.map((file) => ({ name: file.name, stage: () => ctx.api.uploadAsset(file) })));

/** Create the canonical pack first, then use the same staged receipt adoption/CAS path as existing packs. */
export async function createPackWithImages(ctx: AppContext, files: readonly File[]): Promise<AddResult & { pack?: import("../../app-contract").StudioEntitySummary }> {
  const pictures = files.filter((file) => isPackPictureName(file.name));
  if (pictures.length === 0) return { added: 0, failed: files.map((file) => file.name), items: [] };
  const created = await createBlank(ctx, "pack", "Backdrops");
  let result: AddResult;
  try { result = await addImagesToPack(ctx, created.id, pictures); }
  catch (error) {
    await ctx.api.deleteEntity("pack", created.id).catch(() => undefined);
    throw error;
  }
  result.failed.push(...files.filter((file) => !isPackPictureName(file.name)).map((file) => file.name));
  if (result.added === 0) {
    await ctx.api.deleteEntity("pack", created.id).catch(() => undefined);
    return result;
  }
  return { ...result, pack: created };
}

/** One link, fetched by the studio (server-asset-fetch.ts), staged and added; the label is `title` when given, else the link's file name. */
export async function addLinkToPack(ctx: AppContext, packId: string, url: string, title?: string): Promise<AddResult & { reason?: string }> {
  let reason: string | undefined;
  const link = url.trim();
  const result = await addToPack(ctx, packId, [{
    name: title?.trim() || (link.split(/[?#]/)[0] ?? link),
    ...(title?.trim() ? { literal: true } : {}),
    stage: async () => {
      try { return await ctx.api.uploadAssetFromUrl(link); } catch (e) { reason = toErrorMessage(e, "") || undefined; throw e; }
    },
  }]);
  return reason === undefined ? result : { ...result, reason };
}
