/** The persona kind: who the person plays. */
import { defineKind } from "../_shared/kind-descriptor";
import { emptyPersonaBody, type PersonaBody } from "./schema";

export default defineKind<"persona", PersonaBody>({
  gallery: true,
  id: "persona", order: 30, singular: "Persona", plural: "Personas", short: "pers", receiptWord: "persona",
  blurb: "Who you play", icon: "lucide:circle-user", accent: "var(--deck-persona)", libraryDeck: true,
  links: [{ field: "knowledgeRefs", to: "lorebook", label: "Lorebooks" }],
  media: ["body.media.portrait.ref", "body.presentation.imageUrl"],
  blank: () => emptyPersonaBody("Untitled persona"), blankId: "persona",
  editor: { id: "persona", label: "Persona editor", load: "full" },
  describe: (b) => [
    `name     ${b.name || "(unnamed)"}`,
    `brief    ${b.brief ? `${b.brief.slice(0, 60)}...` : "(none)"}`,
    `content  ${b.content ? `${b.content.length} chars` : "(empty)"}`,
    `sections ${b.sections ? Object.keys(b.sections).join(", ") : "(none)"}`,
  ],
});
