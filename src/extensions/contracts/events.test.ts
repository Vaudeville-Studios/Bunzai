/** Tests closed extension event IDs and safe lifecycle payload projection. */
import { expect, test } from "bun:test";
import { extensionEventPayloadSchema, EXTENSION_EVENT_IDS } from "./events";

test("scene-open events have a closed identifier-only payload", () => {
  expect(EXTENSION_EVENT_IDS).toContain("scene.opened");
  expect(extensionEventPayloadSchema.parse({ type: "scene.opened", sceneId: "scene-1" })).toEqual({ type: "scene.opened", sceneId: "scene-1" });
  expect(() => extensionEventPayloadSchema.parse({ type: "scene.opened", sceneId: "scene-1", prompt: "private" })).toThrow();
  expect(extensionEventPayloadSchema.parse({ type: "content.changed", kind: "character", id: "vera", revision: "r2", invalidations: ["body"] })).toEqual({ type: "content.changed", kind: "character", id: "vera", revision: "r2", invalidations: ["body"] });
  expect(() => extensionEventPayloadSchema.parse({ type: "content.changed", kind: "character", id: "vera", revision: "r2", invalidations: ["body"], body: { name: "Vera" } })).toThrow();
});
