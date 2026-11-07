/**
 * A provider that speaks the OpenAI chat format at a fixed address: all a spoke of that shape has to say is who it is and where.
 * Starts with "_", so the registry does not read it as a provider.
 */
import type { ProviderGroup, ProviderSpoke } from "../spoke";
import { openAICompatModels } from "../models";

export interface CompatProvider {
  id: string;
  label: string;
  brand: string;
  /** Where chat completions hang from, without `/chat/completions`. */
  base: string;
  group?: ProviderGroup;
  defaultModel?: string;
  /** Takes no key at all. */
  keyless?: boolean;
  /** Publishes no `/models` list at this address, so a model is typed. */
  noList?: boolean;
}

export function compatSpoke(p: CompatProvider): ProviderSpoke {
  return {
    id: p.id, label: p.label, brand: p.brand, host: new URL(p.base).host,
    ...(p.group ? { group: p.group } : {}), ...(p.defaultModel ? { defaultModel: p.defaultModel } : {}), ...(p.keyless ? { keyless: true } : {}),
    async model({ apiKey, baseURL, headers, model }, fetch) {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({ name: p.id, baseURL: baseURL ?? p.base, ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), fetch })(model);
    },
    ...(p.noList ? {} : { listModels: async ({ apiKey, baseURL }, fetch) => openAICompatModels(baseURL ?? p.base, apiKey, fetch) }),
    scene: { base: (c) => c.baseURL ?? p.base },
  };
}
