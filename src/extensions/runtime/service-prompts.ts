/** Local prompt preview and scene picker manager APIs. */
import { decodeJsonValue } from "../contracts/value";
import { appendExtensionPrompts } from "../../studio/scene-turn-prompts";
import { ExtensionServiceError } from "./service-errors";
import { extensionPromptPreviewSchema, extensionPromptScenesSchema, type ExtensionPromptPreview, type ExtensionPromptScene } from "./service-api";

export interface ExtensionPromptRuntimeApi {
  previewPrompts(sceneId: string, draft: string, signal?: AbortSignal): Promise<ExtensionPromptPreview>;
  promptScenes(): Promise<readonly ExtensionPromptScene[]>;
  hasPromptContributors(sceneId: string): Promise<boolean>;
  applyPromptContributions(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]>;
}

type ApplyPrompt = ExtensionPromptRuntimeApi["applyPromptContributions"];
type HasPromptHooks = ExtensionPromptRuntimeApi["hasPromptContributors"];

export function createExtensionPromptManagerApi(input: {
  requireFence(): Promise<unknown>;
  preview?(sceneId: string, draft: string, signal: AbortSignal): Promise<ExtensionPromptPreview>;
  previewCore?(sceneId: string, draft: string, signal: AbortSignal, apply: ApplyPrompt, hasHooks: HasPromptHooks): Promise<ExtensionPromptPreview | null>;
  scenes?(): Promise<readonly ExtensionPromptScene[]>;
  hasHooks?(sceneId: string): Promise<boolean>;
  apply(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]>;
}): ExtensionPromptRuntimeApi {
  return {
    async previewPrompts(sceneId, draft, signal = new AbortController().signal) {
      await input.requireFence();
      if (signal.aborted) throw new ExtensionServiceError("CANCELLED", "The local prompt preview was cancelled.");
      const core = await input.previewCore?.(sceneId, draft, signal, input.apply, input.hasHooks ?? (async () => false));
      if (core) return extensionPromptPreviewSchema.parse(core);
      if (!input.preview) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Local prompt preview is unavailable on this host.");
      const preview = extensionPromptPreviewSchema.parse(await input.preview(sceneId, draft, signal));
      const additions = await input.apply(sceneId, preview.messages, signal);
      return decodeJsonValue({ ...preview, messages: appendExtensionPrompts(preview.messages, [], additions).messages }) as unknown as ExtensionPromptPreview;
    },
    async promptScenes() {
      await input.requireFence();
      if (!input.scenes) throw new ExtensionServiceError("UNSUPPORTED_HOST", "Scene selection is unavailable on this host.");
      return extensionPromptScenesSchema.parse(await input.scenes());
    },
    async hasPromptContributors(sceneId) { await input.requireFence(); return input.hasHooks ? input.hasHooks(sceneId) : false; },
    async applyPromptContributions(sceneId, messages, signal) { return input.apply(sceneId, messages, signal); },
  };
}
