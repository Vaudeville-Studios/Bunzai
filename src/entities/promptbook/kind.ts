/** Promptbooks join the Writing deck while retaining their complete phase workflow in native exports. */
import { defineKind } from "../_shared/kind-descriptor";
import { BOOK_CARD_KINDS, type PromptbookBody } from "./schema";
import { emptyPromptbookBody, replyPhase } from "../../core/promptbook";
import { bookAgentIds, bookCardIds, renameBookLinks } from "./links";

export default defineKind<"promptbook", PromptbookBody>({
  id: "promptbook", order: 56, singular: "Promptbook", plural: "Promptbooks", short: "book", receiptWord: "promptbook",
  blurb: "A workflow for your story", icon: "lucide:book-open", accent: "var(--deck-preset)", libraryDeck: true, deck: "preset", sceneField: "preset",
  blank: () => emptyPromptbookBody("My Promptbook"), blankId: "promptbook",
  editor: { id: "promptbook", label: "Promptbook editor", load: "light" },
  asPreset: (book) => ({ ...replyPhase(book).preset, name: book.name }),
  presetExports: false,
  media: ["body.phases.#.preset.prompts.#.attachments.#.ref", "profiles.*.phases.#.preset.prompts.#.attachments.#.ref"],
  links: [...BOOK_CARD_KINDS.map((kind) => ({ field: `cards:${kind}`, to: kind, label: kind, embedded: true, read: (body: unknown) => bookCardIds(body, kind) })), { field: "phaseAgents", to: "agent", label: "Agents", embedded: true, read: bookAgentIds }],
  renameLinks: renameBookLinks,
  describe: (book) => [`name     ${book.name}`, `phases   ${book.phases.length}`],
});
