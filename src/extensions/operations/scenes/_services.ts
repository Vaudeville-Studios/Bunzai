/** Narrow projections from the canonical ChatStore; implementations filter scope before reads. */
import type { JsonValue } from "../../contracts/value";
import type { ResourceRef } from "../../contracts/operation";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { SceneSettingChange, SceneSettingSelector, SceneSettingValue } from "../../../stage/contracts/scene-settings";

export interface ExtensionSceneServices {
  previewCreateScene(input: { characterId: string; characterVersion: number; personaId?: string; personaVersion?: number; title?: string }, scope: readonly ResourceRef[]): Promise<JsonValue>;
  createScene(input: { characterId: string; characterVersion: number; personaId?: string; personaVersion?: number; title?: string }, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<JsonValue>;
  list(scope: readonly ResourceRef[], limit: number): Promise<readonly JsonValue[]>;
  read(sceneId: string, scope: readonly ResourceRef[]): Promise<JsonValue | null>;
  readDetails(sceneId: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  listTakes(sceneId: string, scope: readonly ResourceRef[], limit: number): Promise<readonly JsonValue[]>;
  readTake(sceneId: string, takeId: string, scope: readonly ResourceRef[]): Promise<JsonValue | null>;
  listMessages(sceneId: string, takeId: string, fromSeq: number | undefined, limit: number, scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue>;
  readMessage(sceneId: string, takeId: string, seq: number, scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  listMessageVersions(sceneId: string, takeId: string, seq: number, fromIndex: number, scope: readonly ResourceRef[]): Promise<JsonValue>;
  sendMessage(sceneId: string, takeId: string, content: string, expectedVersion: number, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<JsonValue | null>;
  editMessage(sceneId: string, takeId: string, seq: number, content: string, expectedVersion: number, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<JsonValue | null>;
  deleteMessage(sceneId: string, takeId: string, seq: number, expectedVersion: number, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<JsonValue | null>;
  forkTake(sceneId: string, takeId: string, messageId: string, swipeId: string | undefined, name: string, expectedVersion: number, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<JsonValue | null>;
  previewSceneSetting(sceneId: string, selector: SceneSettingSelector, change: SceneSettingChange, scope: readonly ResourceRef[]): Promise<{ before: SceneSettingValue; after: SceneSettingValue; revision: string } | null>;
  applySceneSetting(sceneId: string, selector: SceneSettingSelector, change: SceneSettingChange, expectedRevision: string, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<{ status: "saved"; revision: string } | { status: "stale" } | null>;
}
