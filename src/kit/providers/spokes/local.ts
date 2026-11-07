/**
 * A local OpenAI-compatible server (LM Studio, llama.cpp, Kobold): keyless, zero egress. These size their context window when they
 * load a model. Ollama has its own spoke (spokes/ollama.ts): through this OpenAI-compatible path Ollama cannot be told its window and
 * silently cuts a long prompt.
 */
import type { ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";
import { LOCAL_PARAMS } from "../../../stage/params/dialects";

const local: ProviderSpoke = {
  id: "local",
  group: "Custom",
  label: "Local OpenAI-compatible (LM Studio, llama.cpp)",
  brand: "#5AD07A",
  // No fixed host: the egress allowlist is derived from the user's base URL (localhost).
  defaultModel: "llama3.1",
  keyless: true,
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: "local",
      baseURL: baseURL ?? "http://localhost:11434/v1",
      apiKey,
      headers,
      fetch,
    })(model);
  },
  async listModels({ apiKey, baseURL }, fetch) {
    return openAICompatModels(baseURL ?? "http://localhost:11434/v1", apiKey, fetch);
  },
  // LM Studio, llama.cpp, Kobold: RoleCall's adaptForLlamaCpp.
  scene: { params: LOCAL_PARAMS, base: (c) => c.baseURL ?? "http://localhost:11434/v1" },
};

export default local;
