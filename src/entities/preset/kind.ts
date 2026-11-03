/** The preset kind: prompt blocks and samplers a scene's reply is built from. */
import { defineKind } from "../_shared/kind-descriptor";
import { emptyPresetBody, type PresetBody } from "./schema";

export default defineKind<"preset", PresetBody>({
  id: "preset", order: 50, singular: "Preset", plural: "Presets", short: "set", receiptWord: "preset",
  blurb: "Prompts and samplers", icon: "lucide:sliders-horizontal", accent: "var(--deck-preset)", libraryDeck: true,
  sceneField: "preset",
  links: [{ field: "behaviorRefs", to: "regex", label: "Behavior", embedded: true }, { field: "quickReplyRefs", to: "quickreply", label: "Quick replies" }],
  blank: () => emptyPresetBody("Untitled preset"), blankId: "preset",
  editor: { id: "preset", label: "Preset editor", load: "light" },
  media: ["body.prompts.#.attachments.#.ref", "profiles.*.prompts.#.attachments.#.ref"],
  deckTitle: "Writing", deckBlurb: "Presets, Script Sheets and Promptbooks",
  asPreset: (b) => b,
  describe: (b) => [
    `name     ${b.name || "(unnamed)"}`,
    `prompts  ${b.prompts.length}`,
    `groups   ${b.groups?.length ?? 0}`,
    `choices  ${b.choices?.length ?? 0}`,
  ],
});
