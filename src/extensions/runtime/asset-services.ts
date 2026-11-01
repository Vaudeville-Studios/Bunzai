/** Exposes only stored blobs referenced by the selected canonical piece's declared media slots. */
import { mediaBlobReference } from "../../entities/piece-parts-blob";
import { isCanonicalMediaReference } from "../../entities/_shared/media-reference";
import type { ContentStore } from "../../stage/contracts/content-store";
import type { ResourceRef } from "../contracts/operation";
import type { ContentKind } from "../../entities/capabilities/types";
import type { ExtensionAssetReference, ExtensionAssetServices } from "../operations/assets/_services";

const selected = (scope: readonly ResourceRef[], kind: string, id: string): boolean => scope.some((ref) => ref.kind === kind && ref.id === id);
const MAX_REFERENCES = 256;
const MAX_WALK_NODES = 20_000;

function referencedAssets(kind: string, body: unknown): ExtensionAssetReference[] {
  const found = new Map<string, string | null>();
  const stack: { value: unknown; path: readonly (string | number)[] }[] = [{ value: body, path: ["body"] }];
  let walked = 0;
  while (stack.length) {
    if (++walked > MAX_WALK_NODES) throw new Error("piece media inventory exceeds its scan bound");
    const { value, path } = stack.pop()!;
    if (typeof value === "string") {
      if (!isCanonicalMediaReference(kind, path)) continue;
      const ref = mediaBlobReference(value);
      if (ref && !found.has(ref.sha)) found.set(ref.sha, ref.mime ?? null);
    } else if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) stack.push({ value: value[index], path: [...path, index] });
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) stack.push({ value: child, path: [...path, key] });
    }
    if (found.size > MAX_REFERENCES) throw new Error("piece has too many distinct media assets for this API");
  }
  return [...found].map(([sha, mime]) => ({ sha, mime, bytes: null })).sort((a, b) => a.sha.localeCompare(b.sha));
}

export function createExtensionAssetServices(store: ContentStore): ExtensionAssetServices {
  const assetsFor = async (kind: ContentKind, id: string, scope: readonly ResourceRef[]) => {
    if (!selected(scope, kind, id)) throw new Error("asset scope is outside the approved grant");
    const held = await store.readHeld(kind, id);
    if (!held || held.entity.kind !== kind || held.entity.id !== id) return [];
    const refs = referencedAssets(kind, held.entity.body);
    return Promise.all(refs.map(async (ref) => {
      const size = await store.assetSize(ref.sha);
      return { ...ref, bytes: size.status === "ok" ? size.bytes : null };
    }));
  };
  return {
    list: assetsFor,
    async read(kind, id, sha, scope, maxBytes) {
      const allowed = await assetsFor(kind, id, scope);
      const ref = allowed.find((asset) => asset.sha === sha);
      if (!ref) return null;
      const blob = await store.readAsset(sha, maxBytes);
      if (blob.status === "missing") return null;
      if (blob.status === "too-large") return { status: "too-large", mime: ref.mime, bytes: ref.bytes ?? maxBytes + 1 };
      if (blob.status !== "ok") return null;
      return { status: "ok", mime: ref.mime, bytes: blob.bytes };
    },
  };
}
