/** Azure OpenAI: the person's own resource, through its OpenAI-format v1 endpoint. The model is the deployment's name. */
import type { ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";
import { OPEN_PARAMS } from "../../../stage/params/dialects";

const azure: ProviderSpoke = {
  id: "azure",
  group: "Enterprise",
  label: "Azure OpenAI",
  brand: "#0078D4",
  baseUrlExample: "https://your-resource.openai.azure.com/openai/v1",
  // No fixed host: each person's resource has its own, and the egress allowlist is that base URL.
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({ name: "azure", baseURL: baseURL ?? "", ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), fetch })(model);
  },
  async listModels({ apiKey, baseURL }, fetch) {
    return baseURL ? openAICompatModels(baseURL, apiKey, fetch) : [];
  },
  scene: { params: OPEN_PARAMS, base: (c) => c.baseURL ?? "" },
};

export default azure;
