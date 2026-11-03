/** The sprite pack kind: a named set of pictures (expressions and art). */
import { defineKind } from "../_shared/kind-descriptor";
import { emptyPackBody, type PackBody } from "./schema";

export default defineKind<"pack", PackBody>({
  gallery: true,
  id: "pack", order: 40, singular: "Pack", plural: "Packs", short: "pack", receiptWord: "sprite pack",
  blurb: "Expressions and art", icon: "lucide:package", accent: "var(--deck-pack)", libraryDeck: true,
  searchWords: ["sprite pack", "sprite packs"],
  heavy: true,
  blank: () => emptyPackBody("New pack"), blankId: "pack", libraryNew: false, sceneField: "backdrop",
  media: ["body.pack.items.#.ref", "body.groups.*.items.#.ref"],
  editor: { id: "pack", label: "Pack editor", load: "light" },
  describe: (b) => [
    `name     ${b.name || "(unnamed)"}`,
    `assets   ${b.pack.items.length}`,
    `groups   ${Object.keys(b.groups ?? {}).length}`,
  ],
});
