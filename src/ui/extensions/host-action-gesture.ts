/** Performs sensitive host actions only from a visible manager button's trusted click handler. */
import type { ExtensionHostActionAnswer, PendingExtensionHostAction } from "../../extensions/contracts/host-actions";
import { canonicalJson } from "../../extensions/contracts/value";
import { MAX_EXTENSION_CLIPBOARD_BYTES } from "../../extensions/contracts/limits";
import type { TrackGroup } from "../apps/scenes/stage-music-core";
import type { MusicPlayer } from "../apps/scenes/stage-music-player";
import type { KindId } from "../../generated/kinds";
import { toErrorMessage } from "../../error-message";

export interface ExtensionHostActionApi {
  claimHostAction(id: string): Promise<PendingExtensionHostAction | null>;
  answerHostAction(id: string, answer: ExtensionHostActionAnswer): Promise<boolean>;
}
export interface ExtensionHostGesturePorts {
  now(): number;
  clipboard?: Pick<Clipboard, "readText" | "writeText">;
  openLink(url: string): void;
  music: MusicPlayer;
  acquireMusic(): void;
  releaseMusic(): void;
  groups: readonly TrackGroup[];
  openScene(sceneId: string, ticketId: string): void | Promise<void>;
  openEditor(kind: KindId, entityId: string): void | Promise<void>;
  previewRegex?(ticket: Extract<PendingExtensionHostAction, { action: "regex.preview" }>): Promise<Extract<ExtensionHostActionAnswer, { status: "regex-result" }>>;
  runSceneRegex?(ticket: Extract<PendingExtensionHostAction, { action: "scene-turn.regex" }>): Promise<Extract<ExtensionHostActionAnswer, { status: "scene-regex-result" }>>;
  applyComposerDraft?(ticket: Extract<PendingExtensionHostAction, { action: "composer.draft.set" }>): Promise<Extract<ExtensionHostActionAnswer, { status: "composer-draft-result" }>>;
}
export type HostActionGestureResult = { status: "completed" | "unconfirmed" | "cancelled"; message?: string };

/** Call directly inside the ticket's host button handler; no guest callback or URL is accepted. */
export async function runExtensionHostActionGesture(requested: PendingExtensionHostAction, api: ExtensionHostActionApi, ports: ExtensionHostGesturePorts): Promise<HostActionGestureResult> {
  if (requested.expiresAt <= ports.now()) return { status: "cancelled", message: "This host action expired." };
  let ticket: PendingExtensionHostAction | undefined;
  let effectStarted = false;
  try {
    ticket = await api.claimHostAction(requested.id) ?? undefined;
    if (!ticket) return { status: "cancelled", message: "This host action is stale or already used." };
    if (canonicalJson(ticket) !== canonicalJson(requested)) {
      await api.answerHostAction(ticket.id, { status: "cancelled" });
      return { status: "cancelled", message: "This host action changed before it was claimed." };
    }
    const claimed = ticket;
    let answer: ExtensionHostActionAnswer = { status: "completed" };
    switch (claimed.action) {
      case "clipboard.read": {
        if (!ports.clipboard) throw new Error("Clipboard access is unavailable in this window.");
        const text = await ports.clipboard.readText();
        if (new TextEncoder().encode(text).byteLength > MAX_EXTENSION_CLIPBOARD_BYTES) throw new Error("Clipboard text exceeds the 64 KiB limit.");
        effectStarted = true; answer = { status: "read", text }; break;
      }
      case "clipboard.write":
        if (!ports.clipboard) throw new Error("Clipboard access is unavailable in this window.");
        effectStarted = true; await ports.clipboard.writeText(claimed.text); break;
      case "links.open":
        effectStarted = true; ports.openLink(claimed.url); break;
      case "ui.scene.open":
        effectStarted = true; await ports.openScene(claimed.sceneId, claimed.id); break;
      case "ui.editor.open":
        effectStarted = true; await ports.openEditor(claimed.kind, claimed.entityId); break;
      case "regex.preview":
        if (!ports.previewRegex) throw new Error("The isolated regex preview worker is unavailable.");
        answer = await ports.previewRegex(claimed); break;
      case "scene-turn.regex":
        if (!ports.runSceneRegex) throw new Error("The isolated scene regex worker is unavailable.");
        answer = await ports.runSceneRegex(claimed); break;
      case "composer.draft.set":
        if (!ports.applyComposerDraft) throw new Error("The scene composer is unavailable.");
        effectStarted = true;
        answer = await ports.applyComposerDraft(claimed); break;
      case "playback.play": {
        const group = ports.groups.find((candidate) => candidate.packId === claimed.packId);
        const track = group?.tracks.find((candidate) => candidate.sha === claimed.assetId);
        if (!group || !track) throw new Error("This local audio track is no longer available.");
        effectStarted = true;
        ports.acquireMusic();
        await ports.music.play(track, group.tracks);
        if (!ports.music.get().playing) throw new Error(ports.music.get().error ?? "The audio player could not start.");
        break;
      }
      case "playback.pause":
        effectStarted = true;
        if (ports.music.get().playing) ports.music.toggle();
        break;
      case "playback.stop":
        effectStarted = true; ports.music.stop(); ports.releaseMusic(); break;
      case "ui.dialog.request":
      case "playback.status":
        await api.answerHostAction(claimed.id, { status: "cancelled" });
        return { status: "cancelled", message: "This action is answered by its host interface." };
    }
    return await api.answerHostAction(claimed.id, answer)
      ? { status: "completed" }
      : { status: "unconfirmed", message: "The action may have completed, but the runtime did not record its result." };
  } catch (error) {
    if (ticket) {
      await api.answerHostAction(ticket.id, effectStarted ? { status: "ambiguous" } : { status: "cancelled" }).catch(() => false);
    }
    if (effectStarted) return { status: "unconfirmed", message: "The action may have completed, but the runtime did not record its result." };
    return { status: "cancelled", message: toErrorMessage(error, "The host action could not be completed.") };
  }
}
