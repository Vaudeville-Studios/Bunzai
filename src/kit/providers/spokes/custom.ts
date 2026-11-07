/** Custom (OpenAI-compatible): any proxy or endpoint the user pastes a base URL for. */
import type { ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";
import { OPEN_PARAMS } from "../../../stage/params/dialects";

const custom: ProviderSpoke = {
  id: "custom",
  group: "Custom",
  label: "Custom (OpenAI-compatible)",
  brand: "#E11D48",
  // No fixed host: the egress allowlist is the user's base URL.
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: "custom",
      baseURL: baseURL ?? "",
      apiKey,
      headers,
      fetch,
    })(model);
  },
  async listModels({ apiKey, baseURL }, fetch) {
    if (!baseURL) return [];
    return openAICompatModels(baseURL, apiKey, fetch);
  },
  // An unknown OpenAI-compatible server: every parameter goes out as RoleCall's generic dialect sends it; the server decides.
  scene: { params: OPEN_PARAMS, base: (c) => c.baseURL ?? "" },
};

export default custom;
