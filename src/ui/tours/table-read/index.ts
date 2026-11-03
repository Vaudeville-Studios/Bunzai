/** The Table Read's discovered tutorial explains the model choice, manual field ownership and explicit save. */
import type { Tour } from "../tour-contract";

const tour: Tour = {
  manifest: { appId: "table-read", title: "Create by conversation" },
  steps: [
    { id: "idea", title: "Start with the first spark", body: "Choose a saved model and tell the Understudy what you already know. Cold Read keeps it brief, Deep Dive follows the interesting gaps, and Rapid Fire gives you 90 seconds of choices after its questions are ready." },
    { id: "card", title: "The card takes shape beside you", body: "Answer with a quick choice or your own words. You can edit any field on the living card and keep your change. Fields you keep stay yours, even when the interviewer suggests something later." },
    { id: "review", title: "You decide when they are ready", body: "Review current draft works without another model call. Finish with the interviewer asks the model to bring your answers together. Neither saves a character until you press Save character. Your saved card opens in the normal Workbench." },
  ],
};
export default tour;
