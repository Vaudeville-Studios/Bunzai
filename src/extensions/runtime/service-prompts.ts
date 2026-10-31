/** Local prompt preview and scene picker manager APIs. */
import { decodeJsonValue } from "../contracts/value";
import { appendExtensionPrompts } from "../../studio/scene-turn-prompts";
import { ExtensionServiceError } from "./service-errors";
import { extensionPromptPreviewSchema, extensionPromptScenesSchema, type ExtensionPromptPreview, type ExtensionPromptScene } from "./service-api";

export interface ExtensionPromptRuntimeApi {
  previewPrompts(sceneId: string, draft: string, signal?: AbortSignal): Promise<ExtensionPromptPreview>;
  promptScenes(): Promise<readonly ExtensionPromptScene[]>;
  applyPromptContributions(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]>;
}

export function createExtensionPromptManagerApi(input: {
  requireFence(): Promise<unknown>;
  preview?(sceneId: string, draft: string, signal: AbortSignal): Promise<ExtensionPromptPreview>;
  scenes?(): Promise<readonly ExtensionPromptScene[]>;
  apply(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]>;
}): ExtensionPromptRuntimeApi {
  return {
    async previewPrompts(sceneId, draft, signal = new AbortController().signal) {
      await input.requireFence();
      if (!input.preview) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Local prompt preview is unavailable on this host.");
      if (signal.aborted) throw new ExtensionServiceError("CANCELLED", "The local prompt preview was cancelled.");
      const preview = extensionPromptPreviewSchema.parse(await input.preview(sceneId, draft, signal));
      const additions = await input.apply(sceneId, preview.messages, signal);
      return decodeJsonValue({ ...preview, messages: appendExtensionPrompts(preview.messages, [], additions).messages }) as unknown as ExtensionPromptPreview;
    },
    async promptScenes() {
      await input.requireFence();
      if (!input.scenes) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Scene selection is unavailable on this host.");
      return extensionPromptScenesSchema.parse(await input.scenes());
    },
    async applyPromptContributions(sceneId, messages, signal) { return input.apply(sceneId, messages, signal); },
  };
}
