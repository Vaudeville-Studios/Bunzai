/** The OpenAI-compatible providers from RoleCall's list: registered, reachable only at their own host, and able to drive a scene. */
import { expect, test } from "bun:test";
import { spokes } from "./registry";

const ADDED: Record<string, string> = {
  ai21: "https://api.ai21.com/studio/v1", aimlapi: "https://api.aimlapi.com/v1", cometapi: "https://api.cometapi.com/v1", electronhub: "https://api.electronhub.ai/v1",
  fireworks: "https://api.fireworks.ai/inference/v1", perplexity: "https://api.perplexity.ai", xai: "https://api.x.ai/v1", moonshot: "https://api.moonshot.ai/v1",
  siliconflow: "https://api.siliconflow.com/v1", zai: "https://api.z.ai/api/paas/v4", minimax: "https://api.minimax.io/v1", pollinations: "https://text.pollinations.ai/openai",
};

test("each is registered, at its own host, and its scene address is RoleCall's", async () => {
  const catalog = await spokes();
  for (const [id, base] of Object.entries(ADDED)) {
    const spoke = catalog.get(id);
    if (!spoke) throw new Error(`${id} is not registered`);
    expect(spoke.host).toBe(new URL(base).host);
    expect(spoke.scene!.base({ kind: id, model: "m" })).toBe(base);
    expect(spoke.scene!.native).toBeUndefined();
  }
});

test("only Pollinations runs without a key, and the two with no list ask for a typed model", async () => {
  const catalog = await spokes();
  expect(Object.keys(ADDED).filter((id) => catalog.get(id)!.keyless)).toEqual(["pollinations"]);
  expect(Object.keys(ADDED).filter((id) => !catalog.get(id)!.listModels).sort()).toEqual(["perplexity", "pollinations"]);
});
