/** Resolve a scene connection through the shared vault and provider spokes for desktop and terminal. */
import type { ChatConnection } from "../../stage/contracts/chat-store";
import type { Connected } from "../../studio/scene-turn";
import type { ProviderConfig } from "./config";
import { readVault } from "./vault";
import { knownContext } from "./known-context";
import { spokes } from "./registry";
import { resolveSceneProvider, sceneTools } from "./scene";
import { providerConfigFingerprint } from "./config-fingerprint";

/** The scene's pick, resolved against Kit's saved connections: null when Kit no longer has it. */
export async function connect(pick: ChatConnection, signal?: AbortSignal): Promise<Connected | null> {
  const saved = (await readVault()).providers.find((p) => p.id === pick.id);
  if (!saved) return null;
  return connectTo(saved, pick.model, signal);
}

/** One model's capabilities and provider from the same resolution, including fail-closed unknown native tools. */
export async function connectTo(saved: ProviderConfig, model: string, signal?: AbortSignal): Promise<Connected> {
  const resolvedConfig = { ...saved, model };
  const resolved = await resolveSceneProvider(resolvedConfig, signal);
  const context = resolved.traits?.window ?? knownContext(model) ?? (model === saved.model ? saved.context : undefined);
  const tools = resolved.traits ? resolved.traits.tools === true : sceneTools((await spokes()).get(saved.kind), model);
  return {
    provider: resolved.provider,
    providerConfigFingerprint: providerConfigFingerprint(saved, model),
    kind: saved.kind,
    ...(context ? { context } : {}),
    ...(tools ? { tools: true } : {}),
  };
}
