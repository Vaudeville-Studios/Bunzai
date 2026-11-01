import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  commands: {
    "rename-mira": async () => {
      const preview = await bunzai.operations.contentDraftCharacterIdentityUpdate({
        target: { id: "mira" },
        patch: { name: "Mira Vale", tagline: "Keeper of the north archive" }
      });
      if (!preview.draft) return { status: "unavailable" };
      const result = await bunzai.operations.contentDraftApply({
        kind: "character",
        id: "mira",
        draftId: preview.draft.id,
        fingerprint: preview.draft.fingerprint
      });
      return { status: result.status, changes: preview.draft.changes };
    }
  }
});
