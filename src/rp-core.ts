/** Headless roleplay API over Bunzai's canonical turn engine and caller-owned stores and providers. */
import { runTurn, type Connected, type TurnDeps, type TurnEvent } from "./studio/scene-turn";
import { closeTurnRuntime, createTurnRuntime, runOwnedTask, type TurnRuntime } from "./studio/scene-turn-runtime";
import { stopTurn, turnRunning } from "./studio/scene-turn-running";
import type { ExtensionCommitContext } from "./stage/contracts/extension-store";
import { answerReview } from "./studio/scene-turn-review";
import { answerRegex } from "./studio/scene-turn-regex";
import { commitAnyway, discardWaiting, resumeScene } from "./studio/scene-turn-resume";
import { dramaturgBusy, prepareDramaturgTurn, stopDramaturg } from "./studio/scene-dramaturg";
import type { Provider, ProviderCompletion, ProviderRequest } from "./stage/contracts/provider";
import type { ChatConnection } from "./stage/contracts/chat-store";

export type { TurnEvent, Connected } from "./studio/scene-turn";
export type { ReviewDecision } from "./studio/scene-turn-review";
export type { RegexAnswer } from "./studio/scene-turn-regex";
export type { ChatStore, ChatConnection } from "./stage/contracts/chat-store";
export type { StateStore } from "./stage/contracts/state-store";
export type { Provider, ProviderRequest, ProviderCompletion } from "./stage/contracts/provider";
export type RoleplayDependencies = Omit<TurnDeps, "runtime"> & {
  /** Host jobs triggered by a turn; tracked through shutdown without holding the reply stream. */
  afterEvent?(input: TurnInput, event: TurnEvent, extensionCommit?: ExtensionCommitContext, providerGuard?: ProviderRequestGuard): Promise<void>;
};
export type TurnInput = Parameters<typeof runTurn>[1];
export type ProviderRequestGuard = (connection: ChatConnection, request: ProviderRequest, io: Parameters<Provider["send"]>[1], send: (request: ProviderRequest) => Promise<ProviderCompletion>, resolved?: { providerConfigFingerprint?: string }) => Promise<ProviderCompletion>;

/** Create once per opened ChatStore; close and await before closing the stores. */
export function createRoleplayCore(dependencies: RoleplayDependencies, runtime: TurnRuntime = createTurnRuntime()) {
  const deps: TurnDeps = { ...dependencies, runtime };
  return {
    runTurn: async (input: TurnInput, emit: Parameters<typeof runTurn>[2], extensionCommit?: ExtensionCommitContext, providerGuard?: ProviderRequestGuard) => {
      const followOnTasks: Promise<unknown>[] = [];
      const turnDeps = providerGuard ? { ...deps, connect: async (connection: ChatConnection, signal?: AbortSignal) => {
        const connected = await deps.connect(connection, signal);
        if (!connected) return null;
        const provider = connected.provider;
        return { ...connected, provider: { ...provider, send: (request: ProviderRequest, io?: Parameters<Provider["send"]>[1]) => providerGuard(connection, request, io, (next) => provider.send(next, io), connected) } };
      } } : deps;
      await runTurn(turnDeps, input, (event) => {
        emit(event);
        if (!runtime.closed && dependencies.afterEvent) {
          const task = runOwnedTask(runtime, () => dependencies.afterEvent!(input, event, extensionCommit, providerGuard)).catch(() => undefined);
          if (extensionCommit) followOnTasks.push(task);
        }
      }, extensionCommit);
      // An extension invocation owns its signal and admission until approved follow-on
      // jobs settle. First-party turns keep the existing detached-job behavior.
      if (extensionCommit) await Promise.all(followOnTasks);
    },
    stop: (chatId: string, turnId: string) => stopTurn(runtime, chatId, turnId),
    isRunning: (chatId: string) => turnRunning(runtime, chatId),
    answerReview: (chatId: string, turnId: string, decision: Parameters<typeof answerReview>[3]) => answerReview(runtime, chatId, turnId, decision),
    answerRegex: (chatId: string, turnId: string, answer: Parameters<typeof answerRegex>[3]) => answerRegex(runtime, chatId, turnId, answer),
    resume: (chatId: string) => resumeScene(runtime, deps.chats, chatId),
    commitAnyway: (chatId: string, turnId: string) => commitAnyway(runtime, deps.chats, chatId, turnId),
    discardWaiting: (chatId: string, turnId: string) => discardWaiting(runtime, deps.chats, chatId, turnId),
    dramaturg: {
      prepare: (input: Parameters<typeof prepareDramaturgTurn>[1]) => prepareDramaturgTurn(deps, input),
      isRunning: (chatId: string) => dramaturgBusy(runtime, chatId),
      stop: (chatId: string, revision?: number) => stopDramaturg(runtime, chatId, revision),
    },
    close: () => closeTurnRuntime(runtime),
  };
}

export type RoleplayCore = ReturnType<typeof createRoleplayCore>;
