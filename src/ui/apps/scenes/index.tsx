/**
 * Scenes: the library's chats, RoleCall's /scenes list and scene page (approved wireframes
 * rc-port/scenes.html and rc-port/chat.html). The list opens a scene; the Library's Start Scene hands
 * one over (_shared/scene-handoff.ts). Scenes live in the encrypted library's ChatStore.
 */
import { OverlayWidgets } from "./overlay";
import { useEffect, useState, type JSX } from "react";
import { useDramaturgCacheLifetime } from "./props/dramaturg/dramaturg-live";
import type { AppContext, BunzaiApp } from "../../app-contract";
import { handedScene, handedSceneTicket, handedSceneLoadId, handOffScene, onSceneHandoff, SCENES_APP } from "../../_shared/scene-handoff";
import { LIST_STYLE } from "./list-style";
import { SCENE_STYLE } from "./scene-style";
import { CAST_STYLE } from "./cast/cast-style";
import { PARTICIPANTS_STYLE } from "./cast/cast-participants-style";
import { TURN_STYLE } from "./scene-turn-style";
import { WING_STYLE } from "./scene-wing-style";
import { REASONING_STYLE } from "./scene-reasoning-style";
import { SCENE_VARIANTS_STYLE } from "./variants-style";
import { STAGE_STYLE } from "./stage-style";
import { CONTEXT_STYLE } from "./context/context-style";
import { THIS_TURN_STYLE } from "./context/this-turn-style";
import { LORE_STATE_STYLE } from "./context/lore-state-style";
import { NEXT_SEND_STYLE } from "./context/next-send-style";
import { MEMORY_STYLE } from "./context/memory-style";
import { STAGE_LOOK_STYLE } from "./stage-look-style";
import { TOOLS_STYLE } from "./tools-style";
import { COMPOSER_STYLE } from "./composer-style";
import { HISTORY_STYLE } from "./scene-history-style";
import { COMPARE_STYLE } from "./scene-compare-style";
import { CORRECT_STYLE } from "./scene-correct-style";
import { INSPECTOR_STYLE } from "./scene-inspector-style";
import { DRAFT_STYLE } from "./scene-draft-style";
import { FIND_STYLE } from "./scene-find-style";
import { PRESET_STYLE } from "./preset-style";
import { PARAMS_STYLE } from "./generation-params-style";
import { PROMPTING_STYLE } from "./prompting-style";
import { REGEX_STYLE } from "./scene-regex-style";
import { CHOICES_STYLE } from "./scene-choices-style";
import { LORE_STYLE } from "./lore-style";
import { LORE_ENTRY_STYLE } from "./lore-style-entry";
import { COMPENDIUM_SHELL_STYLE } from "./compendium/compendium-style-shell";
import { COMPENDIUM_ACTIVITY_STYLE } from "./compendium/compendium-style-activity";
import { GRAPH_STYLE } from "./compendium/graph/graph-style";
import { POPOUT_STYLE } from "./popout/popout-style";
import { COMPENDIUM_DASH_STYLE } from "./compendium/compendium-style-dash";
import { COMPENDIUM_BROWSE_STYLE } from "./compendium/compendium-style-browse";
import { COMPENDIUM_TREE_STYLE } from "./compendium/compendium-style-tree";
import { BOOTH_STYLE } from "./booth-style";
import { BOOTH_TOOLS_STYLE } from "./booth-tools-style";
import { GENERATION_STYLE } from "./generation/generation-style";
import { LOADOUT_STYLE } from "./loadout/loadout-style";
import { PROPS_STYLE } from "./props/props-style";
import { TRACKER_STYLE } from "./props/trackers/tracker-style";
import { BATTLE_STYLE } from "./props/trackers/battle/battle-style";
import { CYCLES_STYLE } from "./props/trackers/cycles/cycles-style";
import { CODEX_STYLE } from "./props/trackers/codex/codex-style";
import { SPELLBOOK_STYLE } from "./props/trackers/spellbook/spellbook-style";
import { EVENTS_STYLE } from "./props/trackers/events/events-style";
import { BONDS_STYLE } from "./props/trackers/bonds/bonds-style";
import { CORRUPTION_STYLE } from "./props/trackers/corruption/corruption-style";
import { PARTY_STYLE } from "./props/trackers/party/party-style";
import { ITEMS_STYLE } from "./props/trackers/items/items-style";
import { REFRESH_STYLE } from "./props/trackers/refresh/refresh-style";
import { STORYBOARDS_STYLE } from "./compendium/storyboards/storyboards-style";
import { BACKDROP_STYLE } from "./scene-backdrop-style";
import { MUSIC_STYLE } from "./stage-music-style";
import { SPOTIFY_STYLE } from "./stage-spotify-style";
import { HARE_STYLE } from "./props/trackhare/hare-style";
import { DIRECTOR_STYLE } from "./props/story-director/director-style";
import { DRAMATURG_STYLE } from "./props/dramaturg/dramaturg-style";
import { TOKENS_STYLE } from "./props/trackhare/tokens-style";
import { TREE_STYLE } from "./scene-tree-style";
import { FINAL_CUT_STYLE } from "./final-cut/fc-style";
import { FINAL_CUT_ACTIVITY_STYLE } from "./final-cut/fc-activity-style";
import { BranchTree } from "./scene-tree";
import { ScenePage } from "./scene-page";
import { LayoutGate } from "./layout-chooser/layout-gate";
import { ScenesList } from "./scenes-list";
import { icSvg } from "../../_shared/ic-svg";

const MARK_SVG =
  icSvg("lucide:drama", 18);

function Scenes({ ctx }: { ctx: AppContext }): JSX.Element {
  useDramaturgCacheLifetime();
  const [open, setOpen] = useState(handedScene);
  const [navigationTicketId, setNavigationTicketId] = useState(handedSceneTicket);
  const [loadId, setLoadId] = useState(handedSceneLoadId);
  const [tree, setTree] = useState<string | null>(null);
  useEffect(() => onSceneHandoff(() => { setOpen(handedScene()); setNavigationTicketId(handedSceneTicket()); setLoadId(handedSceneLoadId()); setTree(null); }), []);
  return (
    <>
      <style>{LIST_STYLE + SCENE_STYLE + CAST_STYLE + PARTICIPANTS_STYLE + TOOLS_STYLE + COMPOSER_STYLE + HISTORY_STYLE + COMPARE_STYLE + DRAFT_STYLE + CORRECT_STYLE + INSPECTOR_STYLE + FIND_STYLE + TURN_STYLE + WING_STYLE + REASONING_STYLE + PRESET_STYLE + PROMPTING_STYLE + REGEX_STYLE + CHOICES_STYLE + LORE_STYLE + LORE_ENTRY_STYLE + COMPENDIUM_SHELL_STYLE + COMPENDIUM_DASH_STYLE + COMPENDIUM_BROWSE_STYLE + COMPENDIUM_TREE_STYLE + COMPENDIUM_ACTIVITY_STYLE + GRAPH_STYLE + POPOUT_STYLE + BOOTH_STYLE + BOOTH_TOOLS_STYLE + GENERATION_STYLE + LOADOUT_STYLE + BACKDROP_STYLE + PROPS_STYLE + TRACKER_STYLE + BATTLE_STYLE + ITEMS_STYLE + REFRESH_STYLE + PARTY_STYLE + CORRUPTION_STYLE + BONDS_STYLE + EVENTS_STYLE + SPELLBOOK_STYLE + CYCLES_STYLE + CODEX_STYLE + STORYBOARDS_STYLE + HARE_STYLE + DRAMATURG_STYLE + DIRECTOR_STYLE + TOKENS_STYLE + SCENE_VARIANTS_STYLE + PARAMS_STYLE + MUSIC_STYLE + SPOTIFY_STYLE + TREE_STYLE + FINAL_CUT_STYLE + FINAL_CUT_ACTIVITY_STYLE + STAGE_STYLE + STAGE_LOOK_STYLE + CONTEXT_STYLE + THIS_TURN_STYLE + LORE_STATE_STYLE + NEXT_SEND_STYLE + MEMORY_STYLE}</style>
      {open && tree === open
        ? <BranchTree ctx={ctx} chatId={open} onBack={() => setTree(null)} onOpen={() => setTree(null)} />
        : open
        ? <LayoutGate key={open} ctx={ctx}><ScenePage ctx={ctx} chatId={open} navigationTicketId={navigationTicketId} loadId={loadId} onBack={() => handOffScene(null)} onTree={setTree} /></LayoutGate>
        : <ScenesList ctx={ctx} onOpen={(id) => handOffScene(id)} />}
    </>
  );
}

const app: BunzaiApp = {
  OverlayWidgets,
  manifest: {
    id: SCENES_APP,
    title: "Scenes",
    markSvg: MARK_SVG,
    accent: "#8b5cf6", // hardcode-ok: this app's own identity color in the shell manifest, not theme chrome
    order: 25,
    subtitle: "Chat & play",
  },
  Component: Scenes,
};

export default app;
