/** Foreign preset export reports every attached block that cannot travel, even with a codec-owned report. */
import { expect, test } from "bun:test";
import { CANONICAL_SCHEMA_VERSION } from "./core/canonical";
import { serializeReport } from "./core/reports";
import { sheetAsPreset } from "./core/preset/script-sheet";
import type { PresetAdapter } from "./core/adapter";
import type { CanonicalPreset } from "./entities/preset/schema";
import { emitPieces } from "./convert";
import stPreset from "./formats/sillytavern/preset";

const attached = (): CanonicalPreset => {
  const body = sheetAsPreset({ name: "Files", content: "Read the attached source." });
  body.prompts[0]!.enabled = false;
  body.prompts[0]!.attachments = [{ name: "guide.pdf", ref: "data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=" }];
  return { schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id: "files", body, profiles: { other: { prompts: body.prompts } } };
};

test("a real foreign preset reports disabled and profile attachment loss", () => {
  const entity = attached();
  const out = emitPieces(stPreset, entity, undefined).output;
  expect(out.report?.dropped).toContain("prompts.0.attachments");
  expect(out.report?.dropped).toContain("profiles.other.prompts.0.attachments");
  expect(out.report?.warnings.join(" ")).toContain("attachments");
  expect(entity.body.prompts[0]!.attachments).toHaveLength(1);
});

test("a codec-owned clean report cannot hide attachments; native output retains them", () => {
  const codec: PresetAdapter = {
    ...stPreset,
    id: "reported-preset",
    fromCanonical: () => ({ text: "{}", suggestedExtension: "json", report: serializeReport(undefined, "declared") }),
  };
  const entity = attached();
  expect(emitPieces(codec, entity, undefined).output.report?.counts.dropped).toBe(2);
  const native: PresetAdapter = { ...codec, native: true, fromCanonical: (value) => ({ text: JSON.stringify(value), suggestedExtension: "json" }) };
  const out = emitPieces(native, entity, undefined).output;
  expect(out.report?.dropped).toEqual([]);
  expect(JSON.parse(out.text!).body.prompts[0].attachments).toEqual(entity.body.prompts[0]!.attachments);
});
