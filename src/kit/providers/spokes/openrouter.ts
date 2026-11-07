/** OpenRouter: one key, many models. */
import type { ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";
import { stopList, logitBias } from "../../../stage/params/dialects";

const openrouter: ProviderSpoke = {
  id: "openrouter",
  group: "Major",
  label: "OpenRouter",
  brand: "#94A3B8",
  host: "openrouter.ai",
  defaultModel: "anthropic/claude-opus-4-8",
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({ apiKey, baseURL, headers, fetch }).chat(model);
  },
  async listModels({ apiKey, baseURL }, fetch) {
    return openAICompatModels(baseURL ?? "https://openrouter.ai/api/v1", apiKey, fetch);
  },
  // openrouter.ai/docs/api-reference/parameters; n is not listed there.
  scene: { params: { frequency_penalty: true, presence_penalty: true, repetition_penalty: true, min_p: true, top_a: true, top_k: true, seed: true, logprobs: true, top_logprobs: true, response_format: true, stop: stopList("stop", 4), logit_bias: logitBias() }, base: (c) => c.baseURL ?? "https://openrouter.ai/api/v1", support: { streamUsage: true, reasoningEffort: "openrouter" } },
};

export default openrouter;
