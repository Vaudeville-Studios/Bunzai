/**
 * Every slot file is in the generated list and the list holds nothing else: ids are unique, valid, and named for their file, and
 * `bun run slots` has been run (the generated seam matches what the folder would write). A new slot that misses the list fails here.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSlots, renderSlots } from "../../../scripts/slot-manifest";
import { SLOTS, slotOf } from "../../generated/slots";
import { TRACKER_STATE_MODULES, trackerSlotDef } from "../trackers";
import { FAMILY_ID, SLOT_ID, defineSlot, slotFile } from "./define-slot";
import { makeSlotOf } from "./slot-lookup";
import type { SlotDef } from "./types";

const FOLDER = join(import.meta.dir, "slots");
const files = readdirSync(FOLDER).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => f.slice(0, -3));

describe("the slot list", () => {
  test("holds exactly the slot files, each under its own id (a file that makes a list of slots from a table names them all: tracker.inventory is in tracker.ts)", () => {
    expect([...new Set(SLOTS.map((s): string => (s.id.includes(".") ? s.id.slice(0, s.id.indexOf(".")) : slotFile(s.id))))].sort()).toEqual([...files].sort());
    for (const slot of SLOTS) {
      const sample = slot.id === "ext:*" ? "ext:fixture.extension:x" : slot.id.endsWith(":*") ? slot.id.slice(0, -1) + "x" : slot.id;
      expect(slotOf(sample)).toBe(slot);
    }
    expect(slotOf("nope")).toBeUndefined();
  });

  test("has unique ids that are valid slot ids, and vars is the first slot", () => {
    const ids = SLOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(id.endsWith(":*") ? FAMILY_ID : SLOT_ID);
    expect(ids).toContain("vars");
    expect(ids).toContain("tracker-record:*");
    expect(ids).toContain("tracker-list:*");
  });

  test("keeps every Props tracker module that has state in its own slot, made from the module table", () => {
    expect(SLOTS.filter((s) => s.id.startsWith("tracker.")).map((s) => s.id.slice("tracker.".length)).sort()).toEqual([...TRACKER_STATE_MODULES].sort());
    expect(TRACKER_STATE_MODULES).toHaveLength(12);
    for (const module of TRACKER_STATE_MODULES) expect(slotOf(`tracker.${module}`)?.diff).toBe(trackerSlotDef(module).diff);
    for (const storyboard of ["quests", "cast", "map", "renown"]) expect(slotOf(`tracker.${storyboard}`)).toBeUndefined();
  });

  test("is what the folder would generate, so a slot added without running bun run slots fails", async () => {
    expect(readFileSync(join(import.meta.dir, "..", "..", "generated", "slots.ts"), "utf8").replace(/\r\n/g, "\n")).toBe(renderSlots(await findSlots()));
  });

  test("the generator refuses a slot file that does not declare itself, or sits under another name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bunzai-slots-"));
    try {
      writeFileSync(join(dir, "plain.ts"), "export default {};");
      await expect(findSlots(dir)).rejects.toThrow("must export default defineSlot");
      rmSync(join(dir, "plain.ts"));
      writeFileSync(join(dir, "second.ts"), "export default { id: 'other', scope: 'scene', diff: 'value', default: 0 };");
      await expect(findSlots(dir)).rejects.toThrow("named for its slot id");
      rmSync(join(dir, "second.ts"));
      writeFileSync(join(dir, "wrong.ts"), "export default { id: 'fam:*', scope: 'scene', diff: 'value', default: 0 };");
      await expect(findSlots(dir)).rejects.toThrow("named for its slot id");
      rmSync(join(dir, "wrong.ts"));
      writeFileSync(join(dir, "Bad.ts"), "export default { id: 'Bad:*', scope: 'scene', diff: 'value', default: 0 };");
      await expect(findSlots(dir)).rejects.toThrow("must match");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("slot families", () => {
  const exact: SlotDef = { id: "vars", scope: "scene", diff: "fields", default: {} };
  const rec: SlotDef = { id: "tracker-record:*", scope: "scene", diff: "fields", default: {} };
  const list: SlotDef = { id: "tracker-list:*", scope: "scene", diff: "keyed-list", key: "name", default: [] };

  test("slotOf gives the exact slot, else the family whose prefix the id has, else nothing", () => {
    const of = makeSlotOf([exact, rec, list, { id: "tracker-record:special", scope: "scene", diff: "value", default: 0 }]);
    expect(of("vars")).toBe(exact);
    expect(of("tracker-record:h1")).toBe(rec);
    expect(of("tracker-list:p1")).toBe(list);
    expect(of("tracker-record:special")?.diff).toBe("value");
    expect(of("tracker-record:")).toBeUndefined();
    expect(of("tracker-record")).toBeUndefined();
    expect(of("tracker-record:*")).toBeUndefined();
    expect(of("tracker-record:" + "x".repeat(121))).toBeUndefined();
    expect(of("other:h1")).toBeUndefined();
    expect(of("tracker-recordx:h1")).toBeUndefined();
  });

  test("two families that could match one id are refused, and so is the same family twice", () => {
    expect(() => makeSlotOf([rec, { ...rec, id: "tracker-record:x:*" }])).toThrow("overlap");
    expect(() => makeSlotOf([rec, { ...rec }])).toThrow("twice");
  });

  test("defineSlot takes a family id of one lowercase word and a colon star, and refuses others", () => {
    expect(defineSlot({ id: "fam:*", scope: "scene", diff: "value", default: 0 }).id).toBe("fam:*");
    for (const bad of ["Fam:*", ":*", "fam:x*", "fam*", "a:b:*", "fam:*x"]) expect(() => defineSlot({ id: bad, scope: "scene", diff: "value", default: 0 })).toThrow("must match");
  });

  test("the generated lookup resolves a linked tracker slot to the family, and the checks a store runs accept its deltas", () => {
    expect(slotOf("tracker-record:abc")?.id).toBe("tracker-record:*");
    expect(slotOf("tracker-list:abc")?.diff).toBe("keyed-list");
  });

  test("extension slots require a package namespace and bounded slot id", () => {
    expect(slotOf("ext:fixture.extension:memory")?.id).toBe("ext:*");
    expect(slotOf(`ext:${"a".repeat(65)}:memory`)).toBeUndefined();
    expect(slotOf("ext:fixture.extension:Uppercase")).toBeUndefined();
    expect(slotOf("ext:memory")).toBeUndefined();
    expect(slotOf(`ext:fixture.extension:${"a".repeat(65)}`)).toBeUndefined();
  });
});

describe("who may write each slot", () => {
  test("every registered slot names its writers, so no slot is writable by default and a new one must say who writes it", () => {
    expect(SLOTS.filter((def) => ((def as SlotDef).writers?.length ?? 0) === 0).map((def) => def.id)).toEqual([]);
  });

  test("the library's globals are written only by a reply, and the summary never by one", () => {
    expect(slotOf("global")?.writers).toEqual(["turn"]);
    expect(slotOf("summary")?.writers).not.toContain("turn");
  });
});
