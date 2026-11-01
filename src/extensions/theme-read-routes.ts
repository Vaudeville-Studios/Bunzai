/** Purpose: serve only effective, digest-bound theme reads from the unified Extensions authority. */
import type { EffectiveThemeAppearance } from "./theme-contract";
import { themeAssetResponse } from "./theme-contract";
import type { SettingsStoreLike } from "../studio/contracts";
import { DEFAULT_STUDIO_THEME } from "../studio/settings-shape";

export interface ThemeReadService {
  effective(themeId: string | null | undefined): Promise<EffectiveThemeAppearance>;
  asset(themeId: string, assetId: string, digest: string): Promise<{ type: string; body: string | Uint8Array<ArrayBuffer> } | null>;
  confirmHealthy(): Promise<void>;
  markBroken(id: string, digest: string): Promise<void | boolean>;
  revisionStamp(): { epoch: string; revision: number } | Promise<{ epoch: string; revision: number }>;
}
export interface ThemeReadReplies {
  json(value: unknown): Response;
  error(message: string, status?: number): Response;
}

/** Returns null for unrelated paths; mutating lifecycle routes are owned by Extensions. */
export async function handleThemeReadRoutes(
  request: Request, url: URL, service: ThemeReadService, settings: SettingsStoreLike, reply: ThemeReadReplies,
): Promise<Response | null> {
  if (url.pathname === "/api/themes/effective" && request.method === "GET") {
    const stored = await settings.read();
    return reply.json(await service.effective(stored.theme ?? DEFAULT_STUDIO_THEME));
  }
  if (url.pathname === "/api/themes/revision" && request.method === "GET") return reply.json(await service.revisionStamp());
  const asset = /^\/api\/themes\/assets\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (asset && request.method === "GET") {
    let id: string, assetId: string;
    try { id = decodeURIComponent(asset[1]!); assetId = decodeURIComponent(asset[2]!); }
    catch { return reply.error("invalid theme asset path", 400); }
    const file = await service.asset(id, assetId, url.searchParams.get("digest") ?? "");
    return file === null ? reply.error("theme asset is unavailable", 404) : themeAssetResponse(file);
  }
  return null;
}
