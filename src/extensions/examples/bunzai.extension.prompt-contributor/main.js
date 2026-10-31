import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  events: {
    "gentle-tone": async ({ sceneId, stage }) => {
      const result = await bunzai.operations.promptsContribute({
        sceneId,
        stage,
        text: "Keep the reply considerate and leave room for the other character's choice."
      });
      return { accepted: result.accepted };
    }
  }
});
