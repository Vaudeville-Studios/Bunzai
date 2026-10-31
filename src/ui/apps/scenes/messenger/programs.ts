/**
 * The Messenger's rail: one program per Bunzai wing tab, in RoleCall's order (programs.ts:15-28 GROUPS, left wings then right) with its TITLES (programs.ts:29-36) and the approved
 * wireframe's glyphs (rc-port/messenger.html). A program is a wing and the tab it opens on; the page draws the wing's own panel for it (scene-wings.tsx `bare`), so nothing is copied.
 * Regex lives in the Final Cut wing here but keeps RoleCall's place after Guides; Participants and Writing Helpers are RoleCall tabs (programs.ts:16-18) the wireframe left out.
 * RoleCall folds the sampler into "Generation" (programs.ts:44); Bunzai keeps it in the AI wing, so it is its own "Samplers" program. A Prop with a panel (Story Director, the
 * trackers) gets a program while it is on, drawn through the Prop's own panel, as RoleCall's activities are (programs.ts:89-97).
 */
import { useRef } from "react";
import type { PieceStore } from "../../../_shared/piece-store";
import { useLibraryHasTrackers } from "./panels/trackers/use-library-has-trackers";
import type { IconName } from "../../../_shared/ic";
import type { AppContext } from "../../../app-contract";
import type { OpenScene } from "../../../../studio/scenes";
import type { PopoutKind } from "../popout/popout-kind";
import type { SceneProp } from "../props/prop-contract";
import { STAGE_TABS } from "../scene-stage-wing";
import { hasOwnProgram, messengerKind, trackersProgram } from "./panels";

export interface Program {
  id: string;
  /** The wing whose panel opens ("props" for a Prop's panel). */
  wing: string;
  /** The wing tab it opens on; absent leaves the wing's own choice. */
  tab?: string;
  title: string;
  icon: IconName;
  /** A Prop's own panel, drawn in place of a wing. */
  panel?: PopoutKind;
}

const at = (wing: string, tab: string | undefined, id: string, title: string, icon: IconName): Program => ({ id, wing, title, icon, ...(tab ? { tab } : {}) });

const BEFORE_STAGE: readonly Program[] = [
  at("booth", undefined, "quickplay", "Control Booth", "lucide:zap"),
  at("cast", "character", "characters", "Characters", "lucide:contact-round"),
  at("cast", "persona", "persona", "My Persona", "lucide:user-round"),
  at("cast", "participants", "participants", "Participants", "lucide:users-round"),
  at("world", "lorebook", "lorebook", "Lorebooks", "lucide:book-open"),
  at("world", "compendium", "compendium", "Compendium", "lucide:library-big"),
  at("prompting", "preset", "prompts", "Generation", "lucide:sliders-horizontal"),
  at("prompting", "guides", "guides", "Guides", "lucide:compass"),
  at("finalcut", "regex", "regex", "Regex Workshop", "lucide:regex"),
  at("prompting", "note", "author-note", "Scene Note", "lucide:sticky-note"),
  at("prompting", "tools", "writing-tools", "Writing Helpers", "lucide:pen-line"),
  at("props", undefined, "props", "Add / Remove Features", "lucide:puzzle"),
  at("finalcut", "cut", "post-production", "Final Cut", "lucide:scissors"),
  at("ai", "model", "model", "AI Connection", "lucide:plug"),
  at("ai", "generation", "sampler", "Samplers", "lucide:gauge"),
  at("stage", undefined, "display", "Control Panel", "lucide:monitor-cog"),
];
/** The Stage tabs after Appearance, each shown while the wing's own `visible` says so (scene-stage-wing.tsx STAGE_TABS). */
const STAGE: Record<string, Program> = {
  gallery: at("stage", "gallery", "image-gallery", "My Pictures", "lucide:image"),
  music: at("stage", "music", "mood-music", "Music", "lucide:audio-lines"),
  spotify: at("stage", "spotify", "spotify", "Spotify", "lucide:music"),
  wardrobe: at("stage", "wardrobe", "wardrobe", "Wardrobe", "lucide:shirt"),
};
const AFTER_STAGE: readonly Program[] = [
  at("context", "inspector", "inspector", "Context Inspector", "lucide:scan-search"),
  at("context", "memory", "memory", "Memory", "lucide:history"),
];

/** Every program the open scene has right now; none until the scene is read. */
export { useLibraryHasTrackers } from "./panels/trackers/use-library-has-trackers";

/** The programs the Messenger shows for this scene (none outside the Messenger), the same list while nothing about it changed. */
export function useScenePrograms(messenger: boolean, scene: OpenScene | undefined, propsOn: readonly string[] | null, props: readonly SceneProp[], prefs: AppContext["prefs"], pieces: PieceStore | undefined): Program[] {
  const libraryHasTrackers = useLibraryHasTrackers(pieces);
  return useStablePrograms(messenger ? buildPrograms(scene, propsOn, props, prefs, libraryHasTrackers) : []);
}

/** `libraryHasTrackers`: the library holds a tracker, so the Trackers program is reachable even with none linked and no built-in on. */
export function buildPrograms(scene: OpenScene | undefined, propsOn: readonly string[] | null, props: readonly SceneProp[], prefs: AppContext["prefs"], libraryHasTrackers = false): Program[] {
  if (!scene) return [];
  const stage = STAGE_TABS.filter((t) => t.visible({ scene, propsOn, prefs })).flatMap((t) => STAGE[t.id] ?? []);
  const panels = props.flatMap((p) => (p.panel && hasOwnProgram(p) && propsOn?.includes(p.id) ? [{ id: `prop-${p.id}`, wing: "props", title: p.name, icon: p.icon, panel: messengerKind(p.panel) }] : []));
  return [...BEFORE_STAGE, ...stage, ...AFTER_STAGE, ...(scene.core ? [at("core", undefined, "core", "rp-core", "lucide:cpu")] : []), ...panels, ...trackersProgram(props, propsOn, scene.chat.prompting?.trackers, libraryHasTrackers)];
}

/** The same list while nothing about it changed, so the shell's effects do not run again on every message. */
export function useStablePrograms(next: Program[]): Program[] {
  const held = useRef(next);
  const same = held.current.length === next.length && held.current.every((p, i) => p.id === next[i]!.id && p.title === next[i]!.title && p.panel === next[i]!.panel);
  if (!same) held.current = next;
  return held.current;
}
