import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  commands: {
    audit: async () => {
      let lines;
      try {
        const characters = await bunzai.operations.contentList({
          scope: { type: "library" },
          kinds: ["character"],
          fields: ["id", "kind", "name"],
          limit: 20
        });
        lines = characters.map((character) => character.name || character.id);
        if (lines.length === 0) lines = ["No characters were found in the approved library scope."];
      } catch {
        lines = ["Library access was denied. Review this extension and grant content.list to refresh the audit."];
      }
      await bunzai.operations.uiPanelSet({
        contributionId: "audit-panel",
        descriptor: {
          version: 1,
          root: { type: "list", items: lines.map((text) => ({ type: "text", text })) }
        }
      });
      return { updated: true };
    }
  }
});
