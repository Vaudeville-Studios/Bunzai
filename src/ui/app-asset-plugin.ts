/** Embed trusted app PNG imports in browser bundles without separate runtime asset routes. */
import type { BunPlugin } from "bun";

export const appAssetPlugin: BunPlugin = {
  name: "app-png-data-url",
  setup(build) {
    build.onLoad({ filter: /[/\\]apps[/\\][^/\\]+[/\\][^/\\]+\.png$/ }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(`data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`)};`,
      loader: "js",
    }));
  },
};
