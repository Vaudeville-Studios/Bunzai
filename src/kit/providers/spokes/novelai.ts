/** NovelAI: its own text API, not the OpenAI format. No tools, and the models are the ones RoleCall offers. */
import type { ProviderSpoke } from "../spoke";
import { createNovelAIProvider } from "../../../stage/provider/novelai";

const BASE = "https://text.novelai.net";

const novelai: ProviderSpoke = {
  id: "novelai",
  group: "Specialized",
  label: "NovelAI",
  brand: "#F5F3C2",
  host: new URL(BASE).host,
  defaultModel: "kayra-v1",
  async listModels() {
    return [{ id: "kayra-v1" }, { id: "clio-v1" }, { id: "erato-v1" }];
  },
  scene: {
    base: () => BASE,
    async resolve(config, fetch) {
      return { provider: createNovelAIProvider({ id: config.id ?? config.kind, apiKey: config.apiKey ?? "", baseUrl: BASE }, { fetch }), traits: {} };
    },
  },
};

export default novelai;
