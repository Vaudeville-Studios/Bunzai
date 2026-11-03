/** Binary slots come from each kind's `media` in its kind.ts; gallery art remains an explicit subset. */
import { expect, test } from "bun:test";
import { KINDS } from "../../generated/kinds";
import { ART_KINDS, isCanonicalMediaReference as is } from "./media-reference";

const p = (s: string): string[] => s.split(".");

test("every slot the kinds keep pictures in, and nothing beside them", () => {
  for (const s of [
    "body.media.portrait.ref", "body.media.assets.3.ref", "body.presentation.background.ref",
    "body.variants.0.overrides.media.portrait.ref", "body.variants.1.overrides.media.assets.2.ref",
    "body.variants.0.overrides.presentation.background.ref",
  ]) expect(is("character", p(s))).toBe(true);
  expect(is("persona", p("body.media.portrait.ref"))).toBe(true);
  expect(is("persona", p("body.presentation.imageUrl"))).toBe(true);
  expect(is("pack", p("body.pack.items.4.ref"))).toBe(true);
  expect(is("pack", p("body.groups.happy.items.0.ref"))).toBe(true);
  for (const kind of ["character", "lorebook", "preset", "not-a-kind"]) expect(is(kind, p("original.st.sourceMedia.b64"))).toBe(true);

  expect(is("character", p("body.media.assets.x.ref"))).toBe(false);
  expect(is("pack", p("body.groups.happy.items.x.ref"))).toBe(false);
  expect(is("persona", p("body.media.assets.0.ref"))).toBe(false);
  expect(is("lorebook", p("body.media.portrait.ref"))).toBe(false);
});

test("the declared slots are exactly these: storage treats them as media, so a new one is a deliberate change here", () => {
  expect(Object.fromEntries(KINDS.filter((k) => k.media).map((k) => [k.id, k.media]))).toEqual({
    character: [
      "body.media.portrait.ref", "body.media.assets.#.ref", "body.presentation.background.ref",
      "body.variants.#.overrides.media.portrait.ref", "body.variants.#.overrides.media.assets.#.ref",
      "body.variants.#.overrides.presentation.background.ref",
    ],
    persona: ["body.media.portrait.ref", "body.presentation.imageUrl"],
    pack: ["body.pack.items.#.ref", "body.groups.*.items.#.ref"],
    preset: ["body.prompts.#.attachments.#.ref", "profiles.*.prompts.#.attachments.#.ref"],
    promptbook: ["body.phases.#.preset.prompts.#.attachments.#.ref", "profiles.*.phases.#.preset.prompts.#.attachments.#.ref"],
  });
});

test("the kinds with art are the ones that declare picture slots", () => {
  expect(ART_KINDS).toEqual(["character", "persona", "pack"]);
});
