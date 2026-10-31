/** Skill extension previews edit inert canonical values without running macro or script text. */
import { expect, test } from "bun:test";
import { CANONICAL_SCHEMA_VERSION } from "../../../core/canonical";
import type { CanonicalSkill } from "../schema";
import capability from "./instruction";

test("skill instructions remain data and the preview preserves every unrelated field and escrow", () => {
  const entity: CanonicalSkill = { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "skill", id: "sword", body: {
    name: "Sword", description: "A skill", text: "Old", when: "mentioned", triggers: [], secondaryTriggers: [], selectiveLogic: "and_any", caseSensitive: false, matchWholeWords: true, scanDepth: 5, closeWhenUnmentioned: false,
  }, original: { source: { raw: { keep: true } } } };
  const input = capability.input.parse({ target: { id: "sword" }, patch: { text: "New {{regex::x::x::bad}}", description: "Updated" } });
  const result = capability.preview(entity, input);
  expect(result.entity.body).toMatchObject({ text: "New {{regex::x::x::bad}}", description: "Updated", when: "mentioned" });
  expect(result.entity.original).toEqual(entity.original);
  expect(entity.body.text).toBe("Old");
  expect(result.changes.map(({ path }) => path)).toEqual(["body.description", "body.text"]);
  expect(capability.extensionExposure?.hosts).toEqual(["desktop", "browser", "terminal"]);
});
