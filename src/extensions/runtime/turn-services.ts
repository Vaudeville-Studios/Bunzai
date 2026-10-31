/** Binds extension turn controls to the existing RoleplayCore and one canonical ChatStore. */
import type { ChatConnection, ChatStore } from "../../stage/contracts/chat-store";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { RoleplayCore, TurnEvent } from "../../rp-core";
import type { ProviderRequestGuard } from "../../rp-core";
import type { ProviderRequest } from "../../stage/contracts/provider";
import type { ResourceRef } from "../contracts/operation";
import type { ExtensionTurnKind, ExtensionTurnOutcome, ExtensionTurnStatus } from "../contracts/turns";
import { sceneTurnRegexAnswerSchema } from "../contracts/host-actions";
import type { OperationPrincipal } from "../contracts/operation";
import type { ExtensionTurnServices } from "../operations/turns/_services";
import type { ExtensionTurnFollowOn } from "../operations/turns/_services";
import type { HostActionPort } from "./host-action-port";
import { StudioConflictError, StudioNotFoundError, StudioValidationError } from "../../studio/errors";
import { NoConnectionError } from "../../studio/scene-turn";
import { MAX_EXTENSION_TURN_ACCOUNTING_UNITS, MAX_EXTENSION_TURN_OUTPUT_TOKENS, MAX_EXTENSION_TURN_PROMPT_BYTES, MAX_EXTENSION_TURN_REQUESTS } from "../contracts/limits";
import { accessOf, canWrite } from "../../core/compendium";
import { readVault } from "../../kit/providers/vault";
import type { ProviderConfig } from "../../kit/providers/config";
import { providerConfigFingerprint } from "../../kit/providers/config-fingerprint";
import { hasErrorName } from "../../core/guards";
import { assertExtensionSceneNotCore, type ExtensionCoreSceneOwnership } from "./core-scene-guard";

interface OwnedTurn { turnId: string; kind: ExtensionTurnKind }
export type ExtensionTurnConnectionReader = (connectionId: string, model: string) => Promise<{ fingerprint: string } | null>;

async function readSavedConnection(connectionId: string, model: string): Promise<{ fingerprint: string } | null> {
  const provider = (await readVault()).providers.find((candidate) => candidate.id === connectionId);
  if (!provider) return null;
  return { fingerprint: providerConfigFingerprint(provider, model) };
}

export function createExtensionTurnServices(core: RoleplayCore, chats: ChatStore, hostActions?: Pick<HostActionPort, "request">, connectionReader: ExtensionTurnConnectionReader = readSavedConnection, isCoreScene?: ExtensionCoreSceneOwnership): ExtensionTurnServices {
  const owned = new Map<string, Map<string, OwnedTurn>>();
  const lookup = (packageId: string, sceneId: string): OwnedTurn | undefined => owned.get(packageId)?.get(sceneId);
  const save = (packageId: string, sceneId: string, value: OwnedTurn) => {
    const scenes = owned.get(packageId) ?? new Map<string, OwnedTurn>();
    scenes.set(sceneId, value); owned.set(packageId, scenes);
  };
  const clear = (packageId: string, sceneId: string, turnId: string) => {
    const scenes = owned.get(packageId);
    if (scenes?.get(sceneId)?.turnId !== turnId) return;
    scenes.delete(sceneId); if (scenes.size === 0) owned.delete(packageId);
  };
  const inScope = (scope: readonly ResourceRef[], sceneId: string) => scope.some((item) => item.kind === "scene" && item.id === sceneId);

  return {
    async review(sceneId, _kind, expectedVersion, scope, followOn: ExtensionTurnFollowOn) {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      if (!inScope(scope, sceneId)) return null;
      const chat = await chats.getChat(sceneId);
      if (!chat?.connection) return null;
      const connection = await connectionReader(chat.connection.id, chat.connection.model);
      if (!connection) return null;
      if (followOn.summary && chat.summary?.settings?.auto !== true) return null;
      if (followOn.compendium) {
        if (!chat.compendium?.on || followOn.lorebookIds.length === 0) return null;
        const configuredBooks = new Set(chat.lore?.added ?? []);
        if (followOn.lorebookIds.some((id) => !configuredBooks.has(id) || !canWrite(accessOf(chat.compendium, id))
          || !scope.some((resource) => resource.kind === "lorebook" && resource.id === id))) return null;
      } else if (followOn.lorebookIds.length !== 0) return null;
      const page = await chats.readMessages(chat.activeBranchId, { limit: 1 });
      const branchVersion = page.branchVersion ?? -1;
      if (branchVersion !== expectedVersion) return null;
      return { connectionId: chat.connection.id, model: chat.connection.model, configFingerprint: connection.fingerprint, branchVersion };
    },
    async run(principal: OperationPrincipal, sceneId: string, connectionId: string, approvedModel: string, approvedFingerprint: string, kind: ExtensionTurnKind, expectedVersion: number, scope: readonly ResourceRef[], commit: ExtensionCommitContext, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<ExtensionTurnOutcome> {
      await assertCurrent();
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      const packageId = principal.packageId;
      if (!inScope(scope, sceneId)) throw new Error("PERMISSION_DENIED: turn target is outside approved scene scope");
      if (lookup(packageId, sceneId)) throw new StudioConflictError("This extension already owns a running turn in the scene.");
      const chat = await chats.getChat(sceneId);
      if (!chat) throw new StudioNotFoundError("that scene does not exist");
      if (chat.connection?.id !== connectionId || chat.connection.model !== approvedModel) return { sceneId, status: "conflict", turnId: null, messageId: null };
      const currentConnection = await connectionReader(connectionId, approvedModel);
      if (!currentConnection || currentConnection.fingerprint !== approvedFingerprint) return { sceneId, status: "conflict", turnId: null, messageId: null };
      const page = await chats.readMessages(chat.activeBranchId, { limit: 1 });
      if ((page.branchVersion ?? -1) !== expectedVersion) return { sceneId, status: "conflict", turnId: null, messageId: null };
      let turnId: string | null = null;
      let terminal: ExtensionTurnOutcome | null = null;
      let resolve!: (result: ExtensionTurnOutcome) => void;
      const completed = new Promise<ExtensionTurnOutcome>((done) => { resolve = done; });
      const stop = () => { if (turnId) void core.stop(sceneId, turnId); };
      let requests = 0;
      let reservedUnits = 0;
      const guard: ProviderRequestGuard = async (actualConnection: ChatConnection, request: ProviderRequest, io, send, resolved) => {
        if (signal.aborted) throw new Error("CANCELLED: turn was cancelled before provider send");
        await assertCurrent();
        await assertExtensionSceneNotCore(isCoreScene, sceneId);
        if (signal.aborted) throw new Error("CANCELLED: turn was cancelled before provider send");
        const currentConfig = await connectionReader(connectionId, approvedModel);
        if (!resolved || resolved.providerConfigFingerprint !== approvedFingerprint || !currentConfig || currentConfig.fingerprint !== approvedFingerprint) throw new StudioValidationError("The saved or resolved provider configuration changed after host review; review the turn again.");
        await assertCurrent();
        if (signal.aborted) throw new Error("CANCELLED: turn was cancelled before provider send");
        if (actualConnection.id !== connectionId || actualConnection.model !== approvedModel || request.model !== approvedModel) {
          throw new StudioValidationError("The turn attempted to use a provider connection or model that was not included in its host review.");
        }
        if (requests >= MAX_EXTENSION_TURN_REQUESTS) throw new StudioValidationError("The approved extension turn request limit was reached before another provider call.");
        const promptBytes = new TextEncoder().encode(JSON.stringify(request.messages)).byteLength;
        const requestedOutput = request.options.max_tokens ?? MAX_EXTENSION_TURN_OUTPUT_TOKENS;
        if (!Number.isSafeInteger(requestedOutput) || requestedOutput < 1) throw new StudioValidationError("The scene requested an invalid provider output limit.");
        const outputTokens = Math.min(MAX_EXTENSION_TURN_OUTPUT_TOKENS, requestedOutput);
        const reserved = promptBytes + outputTokens;
        if (promptBytes > MAX_EXTENSION_TURN_PROMPT_BYTES || reservedUnits + reserved > MAX_EXTENSION_TURN_ACCOUNTING_UNITS) {
          throw new StudioValidationError("The extension turn prompt exceeds the reviewed byte and token budget; no provider call was sent.");
        }
        requests++;
        reservedUnits += reserved;
        return send({ ...request, options: { ...request.options, max_tokens: outputTokens } });
      };
      if (signal.aborted) throw new Error("CANCELLED: turn was cancelled before it started");
      signal.addEventListener("abort", stop, { once: true });
      try {
        await core.runTurn({ chatId: sceneId, kind, expectedVersion }, (event: TurnEvent) => {
          if (event.type === "start") { turnId = event.turnId; save(packageId, sceneId, { turnId, kind }); if (signal.aborted) stop(); }
          if (event.type === "regex") {
            const answerFailed = (message: string) => core.answerRegex(sceneId, event.turnId, { kind: "failed", error: message.slice(0, 500) });
            if (!hostActions) { answerFailed("The host regex worker is unavailable."); return; }
            const operation = kind === "continue" ? "turns.continue" : kind === "swipe" ? "turns.regenerate" : "turns.start";
            const principalForHost = { storeId: principal.storeId, packageId, packageDigest: principal.packageDigest, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch };
            void hostActions.request({ action: "scene-turn.regex", operation, packageId, principal: principalForHost,
              sceneId, turnId: event.turnId, rules: event.rules, items: event.items, macros: event.macros, phase: event.phase ?? "prompt" }, signal)
              .then((answer) => {
                const parsed = sceneTurnRegexAnswerSchema.safeParse(answer);
                if (parsed.success) core.answerRegex(sceneId, event.turnId, parsed.data.answer);
                else answerFailed(signal.aborted ? "The regex run was cancelled." : "The host regex worker did not return a valid result.");
              }, (error: unknown) => {
                if (signal.aborted || hasErrorName(error, "AbortError")) core.answerRegex(sceneId, event.turnId, { kind: "cancel" });
                else answerFailed("The host regex worker failed; nothing was sent.");
              });
          }
          if (event.type === "done") terminal = { sceneId, status: "completed", turnId, messageId: event.message.id };
          if (event.type === "conflict") terminal = { sceneId, status: "conflict", turnId: event.turnId, messageId: null };
          if (event.type === "failed") terminal = { sceneId, status: "failed", turnId, messageId: null };
          if (event.type === "stopped") terminal = { sceneId, status: "stopped", turnId, messageId: event.message?.id ?? null };
          if (terminal) resolve(terminal);
        }, commit, guard);
        if (terminal) return terminal;
        return await completed;
      } catch (error) {
        if (error instanceof StudioConflictError || error instanceof StudioNotFoundError || error instanceof StudioValidationError || error instanceof NoConnectionError) {
          return { sceneId, status: "conflict", turnId, messageId: null };
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", stop);
        if (turnId) clear(packageId, sceneId, turnId);
      }
    },
    async cancel(packageId, sceneId, turnId, scope) {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      if (!inScope(scope, sceneId) || lookup(packageId, sceneId)?.turnId !== turnId) return false;
      return core.stop(sceneId, turnId);
    },
    async status(packageId, sceneId, scope): Promise<ExtensionTurnStatus> {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      if (!inScope(scope, sceneId)) throw new Error("PERMISSION_DENIED: turn status is outside approved scene scope");
      const turn = lookup(packageId, sceneId);
      return { sceneId, status: turn ? "running" : "idle", turnId: turn?.turnId ?? null, kind: turn?.kind ?? null };
    },
  };
}

export function unavailableExtensionTurnServices(): ExtensionTurnServices {
  const unavailable = (): never => { throw new Error("UNSUPPORTED_HOST: roleplay turn state is unavailable"); };
  return { review: async () => null, run: async () => unavailable(), cancel: async () => false, status: async () => unavailable() };
}
