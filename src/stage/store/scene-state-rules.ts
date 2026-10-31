/**
 * What both ChatStores share about scene state (docs/reference/scene-state.md): the check every delta passes before it
 * is kept, and the rebuild bound to the declared slots. Shared so the memory and SQLite stores cannot drift.
 */
/** The shared slot the library's global variables live in: the stores read it across every live take (ChatStore.globalOps). */
export { GLOBAL_SLOT } from "../../core/scene-state/globals";
import { dropUnchanged, fold } from "../../core/scene-state/fold";
import { isRecord } from "../../core/guards";
import { StudioConflictError } from "../../studio/errors";
import { rebuild, type RebuildInput } from "../../core/scene-state/rebuild";
import { deltaBytes } from "../../core/scene-state/size";
import type { Delta, SceneState, SlotWriter } from "../../core/scene-state/types";
import { SANITY_TEXT } from "../../entities/_shared/sanity";
import { slotOf } from "../../generated/slots";
import type { JsonValue } from "../contracts/chat-store";
import { checkNumber, fail, isJson, onlyKeys } from "./scalar-rules";

/** A list of deltas, each for a declared slot with a path its strategy reads and a JSON value. There is no size cap: a turn's writes are bounded by their sources (the model's output, the macro engine's output cap). Returns a private copy. */
/** The words a refusal uses for each writer. */
const WRITER_WORDS: Readonly<Record<SlotWriter, string>> = { turn: "a reply", background: "a background writer", person: "a person's edit", import: "an import", extension: "an extension" };

/** Only the dedicated host writer door may call this validator; every delta must name its own package prefix. */
export function checkExtensionDeltas(value: unknown, packageId: string): Delta[] {
  if (!/^[a-z0-9][a-z0-9.-]{0,159}$/.test(packageId)) fail("invalid extension slot owner");
  const deltas = checkImportedDeltas(value, "extension");
  const prefix = `ext:${packageId}:`;
  if (deltas.some(({ slot }) => !slot.startsWith(prefix) || !/^[a-z][a-z0-9._-]{0,63}$/.test(slot.slice(prefix.length)))) fail("extension slot is outside its package namespace");
  return deltas;
}

/**
 * Checks deltas as a write by `writer` (the door it came through: SlotWriter), or as a description of held values (`"held"`, a guard's
 * `expect`, which writes nothing). A slot that does not name the writer refuses the whole write.
 */
export function checkDeltas(value: unknown, writer: SlotWriter | "held"): Delta[] {
  if (!Array.isArray(value)) fail("deltas must be a list");
  const out = value.map((raw): Delta => {
    const d = onlyKeys(raw, ["slot", "path", "value", "removed", "at"], "delta");
    if (typeof d.slot !== "string") fail("delta slot must be text");
    const slot = d.slot;
    const def = slotOf(slot);
    if (!def) fail(`unknown slot: ${slot}`);
    if (writer !== "held" && !def.writers?.includes(writer)) fail(`the ${slot} slot does not take writes from ${WRITER_WORDS[writer]}`);
    if (!Array.isArray(d.path) || d.path.length !== (def.diff === "value" ? 0 : 1)) fail(`a delta for ${slot} needs a path of ${def.diff === "value" ? "no names" : "one name"}`);
    const path = d.path.map((p: unknown) => (typeof p === "string" && p !== "" ? p : fail("a delta path name must be non-empty text")));
    const at = checkNumber(d.at, "delta at must be a finite number", 0, Number.MAX_SAFE_INTEGER);
    if (d.removed !== undefined) {
      if (d.removed !== true || d.value !== undefined) fail("a removal carries removed: true and no value");
      return { slot, path, removed: true, at };
    }
    if (d.value === undefined || !isJson(d.value)) fail("a delta value must be JSON");
    const shape = def.shapeAt ? def.shapeAt(path) : def.shape;
    if (def.shapeAt && !shape) fail(`${slot} has no field ${path[0]}`);
    const value = shape ? shape.check(d.value) : structuredClone(d.value);
    if (value === null) fail(`a delta value for ${slot} does not fit that slot`);
    // A keyed-list row is found by the key it sits under, so the row must carry the key its path names.
    if (def.diff === "keyed-list" && isRecord(value) && String(value[def.key!]) !== path[0]) fail(`a row of ${slot} must carry the ${def.key} its path names`);
    return { slot, path, value: value as JsonValue, at };
  });
  return out;
}

/**
 * Deltas that can come from an import or a person's edit (a take's base, a message's own): checked like any, and one write past a hostile-input
 * ceiling (its serialized bytes) refused as unusually large. The ceiling is for one hostile input, so it counts only the incoming write, not what the
 * message already carries. A guard against a hostile file, not a design limit.
 */
export function checkImportedDeltas(value: unknown, writer: SlotWriter): Delta[] {
  const out = checkDeltas(value, writer);
  if (deltaBytes(out) > SANITY_TEXT) fail("these state changes are unusually large");
  return out;
}

/** What of `added` changes `base` (the state a message builds from), so a write of a value already there adds nothing. */
export const changed = (base: SceneState, added: readonly Delta[]): Delta[] => dropUnchanged(base, added, slotOf);

/** A guarded write's expectation (what the caller read at each slot and path) against the state the message shows: refused, with nothing written, when any of it no longer holds. Not stored. */
export function requireHeld(shown: SceneState, expect: unknown): void {
  if (expect === undefined) return;
  if (changed(shown, checkDeltas(expect, "held")).length > 0) throw new StudioConflictError("the message changed since it was read");
}

/** A take's shown path split for a range read: what comes before `from`, and `from` through `to` (the tip when omitted; empty when `to` is earlier). Null when either is not on the path. */
export function sliceShown<T extends { messageId: string }>(path: readonly T[], from: string, to?: string): { before: T[]; range: T[] } | null {
  const first = path.findIndex((p) => p.messageId === from);
  const last = to === undefined ? path.length - 1 : path.findIndex((p) => p.messageId === to);
  return first < 0 || last < 0 ? null : { before: path.slice(0, first), range: path.slice(first, last + 1) };
}

/** A take's base: the state these deltas fold to over nothing. */
export const baseState = (deltas: readonly Delta[]): SceneState => fold({}, deltas, slotOf);

/** The state after a path of shown versions: `rebuild` over the declared slots. */
export const rebuildState = (input: Omit<RebuildInput, "slotOf">): { state: SceneState; fresh: [string, SceneState][] } => rebuild({ ...input, slotOf });
