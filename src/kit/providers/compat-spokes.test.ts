/** The OpenAI-compatible providers from RoleCall's list: registered, reachable only at their own host, and able to drive a scene. */
import { expect, test } from "bun:test";
import { chatCompletionsUrl } from "rp-core";
import { resolveChatCompletionsUrl } from "../../stage/provider/openai-compatible-request";
import { spokes } from "./registry";
import { vertexAddress } from "./spokes/vertexai";

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

// RoleCall's chat addresses (apps/rc/src/lib/providers/definitions.ts): both of Bunzai's transports must reach exactly these.
const CHAT: Record<string, string> = {
  ai21: "https://api.ai21.com/studio/v1/chat/completions", aimlapi: "https://api.aimlapi.com/v1/chat/completions", cometapi: "https://api.cometapi.com/v1/chat/completions",
  electronhub: "https://api.electronhub.ai/v1/chat/completions", fireworks: "https://api.fireworks.ai/inference/v1/chat/completions", perplexity: "https://api.perplexity.ai/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions", moonshot: "https://api.moonshot.ai/v1/chat/completions", siliconflow: "https://api.siliconflow.com/v1/chat/completions",
  zai: "https://api.z.ai/api/paas/v4/chat/completions", minimax: "https://api.minimax.io/v1/chat/completions", pollinations: "https://text.pollinations.ai/openai/chat/completions",
};

test("each reaches its exact chat address, on the old engine's transport and on rp-core's", async () => {
  const catalog = await spokes();
  for (const [id, url] of Object.entries(CHAT)) {
    const scene = catalog.get(id)!.scene!, config = { kind: id, model: "m" };
    const exact = scene.chatUrl?.(config);
    expect(`${id} ${resolveChatCompletionsUrl({ baseUrl: scene.base(config), ...(exact ? { chatCompletionsEndpoint: exact } : {}) })}`).toBe(`${id} ${url}`);
    expect(`${id} ${exact ?? chatCompletionsUrl(scene.base(config))}`).toBe(`${id} ${url}`);
  }
});

test("Vertex posts to Google's OpenAI address, with no version added", () => {
  expect(resolveChatCompletionsUrl(vertexAddress("my-project"))).toBe("https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/endpoints/openapi/chat/completions");
});
