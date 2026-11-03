/** The character kind: who the person writes and plays with. */
import { defineKind } from "../_shared/kind-descriptor";
import { emptyCharacterBody, type CharacterBody } from "./schema";

export default defineKind<"character", CharacterBody>({
  gallery: true,
  id: "character", order: 10, singular: "Character", plural: "Characters", short: "char", receiptWord: "character card",
  blurb: "Your cast", icon: "lucide:user", accent: "var(--deck-character)", libraryDeck: true,
  links: [{ field: "knowledgeRefs", to: "lorebook", label: "Lorebooks", embedded: true }, { field: "behaviorRefs", to: "regex", label: "Behavior" }],
  namePath: ["identity", "name"],
  media: [
    "body.media.portrait.ref", "body.media.assets.#.ref", "body.presentation.background.ref",
    "body.variants.#.overrides.media.portrait.ref", "body.variants.#.overrides.media.assets.#.ref",
    "body.variants.#.overrides.presentation.background.ref",
  ],
  blank: () => emptyCharacterBody("Untitled character"), blankId: "character",
  editor: { id: "character", label: "Character editor", load: "full" },
  describe: (b) => {
    const g = b.greetings;
    return [
      `name     ${b.identity.name || "(unnamed)"}`,
      `greeting ${g.firstMessage ? `${g.firstMessage.slice(0, 60)}...` : "(none)"}`,
      `alts     ${g.alternateGreetings?.length ?? 0}`,
      `tags     ${b.discovery.tags?.join(", ") || "(none)"}`,
    ];
  },
});
