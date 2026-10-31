/** Scene extension setting previews share native validators, redact private request values, and hash stable revisions. */
import { describe, expect, test } from "bun:test";
import type { Chat } from "../contracts/chat-store";
import { sceneSettingChangeSchema, sceneSettingSelectorSchema } from "../contracts/scene-settings";
import { applySceneSettingChange, projectSceneSetting, sceneSettingCompareValue, sceneSettingRevision } from "./scene-settings";

const chat: Chat = {
  id: "scene-1", title: "Test", cast: { character: { id: "char-1", version: 1 } }, activeBranchId: "take-1",
  createdAt: 1, updatedAt: 1, snapshotVersion: 1,
  connection: { id: "provider-1", model: "model-1" },
  preset: { kind: "preset", id: "preset-1", toggles: {}, samplers: { temperature: 0.7, customHeaders: "Authorization: secret", customBody: "token=secret" } },
  director: { instructions: "private direction", archive: { notes: [], hidden: [] } },
};

describe("scene setting contract and projection", () => {
  test("selector/change require exact keys and tracker module", () => {
    expect(sceneSettingSelectorSchema.safeParse({ group: "connection", extra: true }).success).toBe(false);
    expect(sceneSettingSelectorSchema.safeParse({ group: "tracker" }).success).toBe(false);
    expect(sceneSettingChangeSchema.safeParse({ group: "lore", value: null, ignored: true }).success).toBe(false);
    expect(sceneSettingChangeSchema.safeParse({ group: "tracker", module: "knowledge", patch: { context: "always" } }).success).toBe(true);
  });

  test("projection excludes connection credentials and director archive, redacts preset request data", () => {
    expect(projectSceneSetting(chat, { group: "connection" })).toEqual({ id: "provider-1", model: "model-1" });
    expect(projectSceneSetting(chat, { group: "director" })).toEqual({ instructions: "private direction" });
    expect(projectSceneSetting(chat, { group: "preset" })).toEqual({
      value: { kind: "preset", id: "preset-1", toggles: {}, samplers: { temperature: 0.7 } },
      redacted: ["samplers.customHeaders", "samplers.customBody"],
    });
  });

  test("checked sparse changes merge through canonical rules and preserve hidden preset values", () => {
    const changed = applySceneSettingChange(chat, { group: "preset" }, { group: "preset", value: { kind: "preset", id: "preset-2", toggles: {}, samplers: { temperature: 0.4 } } });
    expect(changed.preset?.id).toBe("preset-2");
    expect(changed.preset?.samplers.customHeaders).toBe("Authorization: secret");
    expect(() => applySceneSettingChange(chat, { group: "preset" }, { group: "preset", value: { kind: "preset", id: "preset-2", toggles: {}, samplers: { customBody: "new-secret" } } })).toThrow("private request fields");
    const prompting = applySceneSettingChange(chat, { group: "prompting" }, { group: "prompting", patch: { note: { text: "note", position: "in_chat", depth: 2, frequency: 1 } } });
    expect(prompting.prompting?.note?.text).toBe("note");
    expect(() => applySceneSettingChange(chat, { group: "prompting" }, { group: "prompting", patch: { unexpected: true } })).toThrow();
  });

  test("revision hash sorts object keys and changes when a selected value changes", () => {
    expect(sceneSettingRevision({ b: 2, a: { y: true, x: 1 } })).toBe(sceneSettingRevision({ a: { x: 1, y: true }, b: 2 }));
    expect(sceneSettingRevision({ a: 1 })).not.toBe(sceneSettingRevision({ a: 2 }));
    const preset = { group: "preset" as const };
    expect(sceneSettingRevision(sceneSettingCompareValue(chat, preset))).not.toBe(sceneSettingRevision(sceneSettingCompareValue({ ...chat, preset: { ...chat.preset!, samplers: { ...chat.preset!.samplers, customHeaders: "Authorization: changed" } } }, preset)));
  });
});
