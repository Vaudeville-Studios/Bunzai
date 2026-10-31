/** Read-only appearance routes backed by the unified extension runtime. */
import type { StateStore } from "../stage/contracts/state-store";
import type { SettingsStoreLike } from "../studio/contracts";
import type { PackagedAssets } from "./assets";
import type { ThemeReadService } from "../extensions/theme-read-routes";
import { handleThemeReadRoutes } from "../extensions/theme-read-routes";
import { toErrorMessage } from "../error-message";
import { isSha256Hex } from "../core/sha256";
import { err, json, readJsonObject } from "./server-security";
import { z } from "zod";

export type { ThemeReadService } from "../extensions/theme-read-routes";
const bodyLimit = 512 * 1024;

/** Legacy StateStore bytes are accepted for signature compatibility but are never read or written. */
export function createThemeRouteOwner(_packaged: PackagedAssets | undefined, settings: SettingsStoreLike) {
  return async (req: Request, url: URL, _state?: StateStore, reader?: ThemeReadService): Promise<Response> => {
    try {
      if (!reader) return err("unified theme runtime is unavailable", 503);
      const response = await handleThemeReadRoutes(req, url, reader, settings, { json, error: err });
      if (response) return response;
      if (req.method === "POST" && url.pathname === "/api/themes/broken") {
        const body = await readJsonObject(req, bodyLimit);
        if (!body.ok) return body.response;
        const parsed = z.object({ id: z.string().min(1).max(120), digest: z.string().refine(isSha256Hex) }).strict().safeParse(body.value);
        if (!parsed.success) return err("Invalid theme health report.", 400);
        return json({ ok: await reader.markBroken(parsed.data.id, parsed.data.digest) });
      }
      if (req.method === "POST" && url.pathname === "/api/themes/healthy") {
        const body = await readJsonObject(req, bodyLimit);
        if (!body.ok) return body.response;
        if (!z.object({ digest: z.string().refine(isSha256Hex).optional() }).strict().safeParse(body.value).success) return err("Invalid theme health report.", 400);
        await reader.confirmHealthy();
        return json({ ok: true });
      }
      return err(req.method === "POST" ? "Theme management is owned by the Extensions service." : "Theme route not found", req.method === "POST" ? 410 : 404);
    } catch (error) {
      console.error("theme lifecycle refused:", toErrorMessage(error, "unknown error"));
      return err("theme lifecycle could not complete this request", 500);
    }
  };
}

export { handleThemeReadRoutes };
