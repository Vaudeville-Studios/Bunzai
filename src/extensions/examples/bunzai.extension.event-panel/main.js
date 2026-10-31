import { bunzai } from "bunzai-extension-sdk";

const show = async (text) => bunzai.operations.uiPanelSet({
  contributionId: "opened-panel",
  descriptor: { version: 1, root: { type: "text", text } }
});

bunzai.extension.define({
  commands: {
    subscribe: async () => {
      const result = await bunzai.operations.eventsSubscribe({
        scope: "scene", event: "scene.opened", sceneId: "scene-1"
      });
      await show(result.status === "subscribed" || result.status === "already"
        ? "Listening for this scene's open summary."
        : "Subscription was not changed.");
      return result;
    }
  },
  events: {
    "scene.opened": async (event) => {
      await show("Scene opened: " + event.sceneId);
    }
  }
});
