/**
 * The one shape a provider is (hub-and-spoke). A provider is a drop-in file in spokes/ that
 * default-exports a ProviderSpoke; registry.ts discovers them like the tool and format loaders.
 * One file owns everything about that provider: its label and brand for the setup screen, the one
 * host the egress gate allows, whether it can run keyless, and how it builds its AI SDK model.
 * Adding a provider is copy-paste: duplicate spokes/_template.ts, nothing central to edit.
 */
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "./config";
import type { ModelInfo } from "./models";
import type { ChatFn } from "./provider";
import type { OpenAICompatibleSupport } from "../../stage/provider/openai-compatible-request";
import type { ParamSupport } from "../../stage/params/wire";
import type { Provider } from "../../stage/contracts/provider";

/**
 * How a scene reaches this provider (item 9): scenes send through the
 * stage's OpenAI-compatible provider, so a spoke that speaks chat completions says where, and what
 * that server supports. The address stays under the spoke's one egress host.
 */
export interface SceneEndpoint {
  /** The base URL chat completions hang from (`/chat/completions` is appended). Also the address
   * `scene.ts` checks against the spoke's egress host when `native` names a different transport. */
  base(config: ProviderConfig): string;
  support?: OpenAICompatibleSupport;
  /** The generation parameters this provider accepts, and the one wire name each goes under (stage/params/wire.ts). Absent means only the penalties every OpenAI-compatible server reads. */
  params?: ParamSupport;
  /**
   * Send through a native transport instead of the OpenAI-compatible spoke. `"anthropic"` is
   * Anthropic's own Messages API (`src/stage/provider/anthropic.ts`): explicit cache breakpoints and
   * no system-message hoisting, in exchange for a request shape only that spoke builds. Absent means
   * the OpenAI-compatible spoke, as before.
   */
  native?: "anthropic";
  /**
   * Resolves one model description and native provider together, so budgeting and the request use the same traits.
   * The fetch is guarded to the connection's one host; cancellation includes metadata discovery.
   */
  resolve?(config: ProviderConfig, fetch: FetchFunction, label: string, signal?: AbortSignal): Promise<{ provider: Provider; traits: ModelTraits }>;
}

/** One model's abilities as its server reports them; a field left out is not known. */
export interface ModelTraits {
  /** The tokens a request may use: the smaller of the connection's chosen window and the model's own. */
  window?: number;
  tools?: boolean;
  thinks?: boolean;
}

/** A provider-specific choice the setup form renders as a chip row (RC's schema-driven fields),
 * e.g. NanoGPT's plan. The picked value lands in config.options under the option's key. */
export interface SpokeOption {
  key: string;
  label: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  defaultValue: string;
}

/** Where the Providers list shows a spoke, in RoleCall's order. Absent: OpenAI compatible. */
export const PROVIDER_GROUPS = ["Major", "OpenAI compatible", "Regional", "Specialized", "Free", "Custom"] as const;
export type ProviderGroup = (typeof PROVIDER_GROUPS)[number];

export interface ProviderSpoke {
  group?: ProviderGroup;
  /** Stable id stored in config.kind. */
  id: string;
  /** Display name for the setup screen preset card. */
  label: string;
  /** Brand hex for the setup card (researched, exact). */
  brand: string;
  /** The one host this provider talks to, for the egress allowlist. Omit for base-URL-only (custom). */
  host?: string;
  /** A sensible model id to pre-fill in the setup form. */
  defaultModel?: string;
  /** May run without a key (local / openai-compatible endpoints). */
  keyless?: boolean;
  /**
   * Where a keyless local server answers when the connection names no base URL (Ollama's `http://localhost:11434`).
   * The egress gate then allows that one host. Its presence also marks a spoke that supplies `chat` as an HTTP one.
   */
  defaultBaseURL?: string;
  /**
   * Does this provider accept images in a user message?
   *
   * DECLARED, not assumed. Kit used to caption every pasted picture "shown to you only - Kit's
   * providers take text", which was a blanket claim about other people's software and wrong for most
   * of them: the subscription providers and every current frontier model read images happily. A
   * capability belongs to the spoke that knows it.
   *
   * Absent means NO, deliberately. Sending an image to a text-only model is not a soft failure that
   * degrades to text, it is a request that errors, so the safe default is the one that never breaks a
   * turn - and a spoke that gains vision says so in one line.
   */
  images?: boolean;
  /** Provider-specific setup choices (plan tiers, endpoint variants). Rendered by the form. */
  options?: ReadonlyArray<SpokeOption>;
  /** Build the AI SDK model, lazy-importing the vendor adapter and wiring the guarded fetch.
   * Optional only for a spoke that supplies `chat` instead; every spoke must have one or the other. */
  model?(config: ProviderConfig, fetch: FetchFunction): Promise<LanguageModel>;
  /**
   * Supply the chat function directly, for a provider that is NOT an HTTP model.
   *
   * The Claude subscription provider runs a local CLI over stdio, so there is no request for
   * guardedFetch to gate and no LanguageModel to build. Faking one would be dishonest twice over: it
   * would claim an HTTP shape that does not exist, and it would imply the egress gate is watching
   * something it cannot see. A spoke that sets this is asked for its chat and never for its model.
   *
   * A spoke with `chat` must say what it does about egress in its own file, because the ledger's
   * usual source, our own fetch, is not in the path. `system` is Kit's system prompt (its tool protocol
   * and the screen's ambient context), for a spoke whose transport carries one.
   */
  chat?(config: ProviderConfig, signal?: AbortSignal, system?: string): Promise<ChatFn>;
  /** Query the provider's live model list (through the guarded fetch). Omit when the provider has
   * no usable models endpoint; the setup form then falls back to manual model entry. */
  listModels?(config: ProviderConfig, fetch: FetchFunction, signal?: AbortSignal): Promise<ModelInfo[]>;
  /**
   * Where scenes send. Absent: scenes cannot use this provider yet, and the AI wing says so.
   *
   * Having a scene endpoint is also what gives a scene's turn its tools (the narrator's tool loop, the tracker update, Final Cut
   * tool passes, the Director's tool-call mode): every connection carries them, local and custom servers included, except a model
   * that refuses tools whatever its host (`sceneTools` in scene.ts). A server that still refuses them answers an error, and the
   * turn reports it in one sentence instead of quietly sending without tools.
   */
  scene?: SceneEndpoint;
}

/** Whether a spoke makes HTTP requests: it builds an AI SDK model, or it answers at a default address. A spoke with only its own `chat` and no address (a CLI) makes none, so it gets no network. */
export const speaksHttp = (spoke: ProviderSpoke): boolean => spoke.chat === undefined || spoke.defaultBaseURL !== undefined;

/** Whether the setup form asks for a base URL: an HTTP spoke with no fixed host. Required only when there is no default address either. */
export const asksBaseURL = (spoke: ProviderSpoke): boolean => spoke.host === undefined && speaksHttp(spoke);
