/** Cohere: through its OpenAI compatibility endpoint. */
import { compatSpoke } from "./_compat";

export default compatSpoke({ id: "cohere", label: "Cohere", brand: "#39594D", base: "https://api.cohere.ai/compatibility/v1", group: "Specialized", noList: true, defaultModel: "command-a-03-2025" });
