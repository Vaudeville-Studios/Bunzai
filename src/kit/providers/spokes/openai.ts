/** OpenAI: native. */
import type { ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";
import { OPENAI_PARAMS } from "../../../stage/params/dialects";

const openai: ProviderSpoke = {
  id: "openai",
  label: "OpenAI",
  brand: "#10A37F",
  host: "api.openai.com",
  // GPT-4o and every frontier model since take image parts.
  images: true,
  defaultModel: "gpt-4o",
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey, baseURL, headers, fetch })(model);
  },
  async listModels({ apiKey, baseURL }, fetch) {
    return openAICompatModels(baseURL ?? "https://api.openai.com/v1", apiKey, fetch);
  },
  // platform.openai.com chat create.
  scene: { params: OPENAI_PARAMS, base: (c) => c.baseURL ?? "https://api.openai.com/v1", support: { streamUsage: true, reasoningEffort: "openai", pdfAttachments: true } },
};

export default openai;
