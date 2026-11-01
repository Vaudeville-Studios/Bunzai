/** Public server composition API: route construction and listener startup have separate owners. */
import { createHandler } from "./server-handler";
import { startUiWithRoutes } from "./server-start";
import type { PackagedAssets } from "./assets";
import type { LibraryHandle } from "./library-root";
export { createHandler, type UiHandler } from "./server-handler";
export {
  INSPECT_BODY_MAX, type UiSecurityContext, createSecurityContext, htmlSecurityHeaders,
  inlineScriptHashes, injectSessionMeta, injectSandboxOriginMeta, readBodyCapped, checkApiRequest,
} from "./server-security";

export function startUi(port: number, studioDir: string, packaged?: PackagedAssets, library?: LibraryHandle) {
  return startUiWithRoutes(createHandler, port, studioDir, packaged, library);
}
