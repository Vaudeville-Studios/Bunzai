/** Google AI (Gemini): native. */
import type { ProviderSpoke } from "../spoke";
import { parseModelsPayload } from "../models";

const google: ProviderSpoke = {
  id: "google",
  group: "Major",
  label: "Google AI (Gemini)",
  brand: "#4796E3",
  host: "generativelanguage.googleapis.com",
  // Gemini has been multimodal from the start.
  images: true,
  defaultModel: "gemini-2.5-pro",
  async model({ apiKey, baseURL, headers, model }, fetch) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({ apiKey, baseURL, headers, fetch })(model);
  },
  async listModels({ apiKey }, fetch) {
    // Google authenticates model listing with the key in the query, only ever to its own host.
    const key = encodeURIComponent(apiKey ?? "");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`,
      {},
    );
    if (!response.ok) return [];
    const models = parseModelsPayload(await response.json());
    return models.map((info) => ({ ...info, id: info.id.replace(/^models\//, "") }));
  },
  // Gemini's OpenAI-compatible endpoint: same host, so the same egress rule.
  // Gemini's OpenAI endpoint: its page lists no sampler fields; response_format is its documented structured output, the rest is what every OpenAI-compatible relay accepts.
  scene: { params: { frequency_penalty: true, presence_penalty: true, seed: true, response_format: true, stop: true }, base: (c) => c.baseURL ?? "https://generativelanguage.googleapis.com/v1beta/openai", support: { reasoningEffort: "gemini" } },
};

export default google;
