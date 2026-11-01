/** Materialize verified package images and fonts for static browser mode, where CSS cannot call the API shim. */
import type { EffectiveThemeAppearance, ThemeFileRef } from "../../extensions/theme-contract";
import { isSha256Hex, sha256HexBytes } from "../../core/sha256";
import { readStreamCapped } from "../../core/stream-bytes";
import { isInertSvg } from "../_shared/svg-safety";

const MAX_BYTES = 128_000;
const MAX_SVG_BYTES = 96_000;

export interface ThemeAssetUrlDeps {
  fetchAsset(url: string): Promise<Response>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}

const defaults: ThemeAssetUrlDeps = {
  fetchAsset: (url) => fetch(url),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
};

export async function readThemeAssetResponse(response: Response, file: { digest: string; mediaType: string }, signal?: AbortSignal): Promise<Uint8Array> {
  const { digest, mediaType } = file;
  const cap = mediaType === "image/svg+xml" ? MAX_SVG_BYTES : MAX_BYTES;
  if (!response.ok || (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() !== mediaType) throw new Error("theme asset response refused");
  if (!response.body) throw new Error("theme asset body unavailable");
  const read = await readStreamCapped(response.body, cap, { signal });
  if (!read.ok) throw read.reason === "too-large" ? new Error("theme asset exceeds its bound") : read.error;
  const bytes = read.bytes;
  if (mediaType === "image/svg+xml" && !isInertSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) throw new Error("theme asset is not inert SVG");
  if (!isSha256Hex(digest) || sha256HexBytes(bytes) !== digest) throw new Error("theme asset digest mismatch");
  return bytes;
}

const readFile = (response: Response, file: ThemeFileRef & { mediaType: string }): Promise<Uint8Array> => readThemeAssetResponse(response, file);

export function createThemeAssetUrls(deps: Partial<ThemeAssetUrlDeps> = {}) {
  const io = { ...defaults, ...deps };
  let generation = 0;
  let active: string[] = [];
  let refs: string | null = null, mapped: Record<string, string> = {};
  const release = (): void => { generation++; active.splice(0).forEach(io.revokeUrl); refs = null; mapped = {}; };
  return {
    release,
    async materialize(appearance: EffectiveThemeAppearance, isCurrent: () => boolean): Promise<Record<string, string> | null> {
      const owner = ++generation;
      const nextRefs = JSON.stringify([appearance.digest, appearance.assets, appearance.fonts]);
      if (refs === nextRefs && isCurrent()) return mapped;
      const created: string[] = [];
      try {
        const nextMapped: Record<string, string> = {};
        for (const asset of [...appearance.assets, ...appearance.fonts]) {
          const bytes = await readFile(await io.fetchAsset(asset.url), asset);
          if (owner !== generation || !isCurrent()) throw new Error("theme appearance superseded");
          const url = io.createUrl(new Blob([bytes.buffer as ArrayBuffer], { type: asset.mediaType }));
          created.push(url);
          nextMapped[asset.id] = url;
        }
        if (owner !== generation || !isCurrent()) { created.forEach(io.revokeUrl); return null; }
        active.splice(0).forEach(io.revokeUrl);
        active = created;
        refs = nextRefs; mapped = nextMapped;
        return mapped;
      } catch (error) {
        created.forEach(io.revokeUrl);
        if (owner === generation && isCurrent()) throw error;
        return null;
      }
    },
  };
}
