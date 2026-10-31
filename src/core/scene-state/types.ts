/**
 * Scene state's shapes (docs/reference/scene-state.md): a slot is one named piece of scene state, a delta is what one
 * reply version changed in it, and the state is every slot's value after the versions that are shown. Types only.
 */
import type { JsonValue } from "../../stage/contracts/chat-store";
import type { Shape } from "../trackers/shape";

/** What one reply version changed: a value at a path inside one slot, or its removal. Values, never operations. */
export interface Delta {
  slot: string;
  path: string[];
  value?: JsonValue;
  removed?: true;
  /** Epoch ms of the write. */
  at: number;
}

/**
 * Who writes scene state, by the door the write comes through (docs/reference/scene-state.md, "Who may write"): `turn` is a reply as it is
 * written (its macros, its tools, the Spellbook's tick: pending on the checkpoint, stamped at commit), `background` a writer that names a
 * reply after it landed (the Story Director's round, the chat summary's writer), `person` the person's own edit, `import` what a take
 * starts with (a chat import). The writer is decided by the door, never taken from a request; who may call each door is held by
 * stage/store/scene-state-guard.test.ts.
 */
export type SlotWriter = "turn" | "background" | "person" | "import" | "extension";

/** How a slot's changes are cut into deltas and folded back: the whole value, one delta per field, or one per row of a list. */
export type DiffStrategy = "value" | "fields" | "keyed-list";

export interface SlotDef {
  /** The slot id; ending in `:*` it is a family covering every id with that prefix (slot-lookup.ts). */
  id: string;
  /** "scene": rebuilt from one take's shown history. "shared": spans every scene (the library's global variables); a take's fold skips it, and its value is folded from the versions shown in every live take (globals.ts). */
  scope: "scene" | "shared";
  diff: DiffStrategy;
  /** A keyed-list's row field: a row is addressed by its text. */
  key?: string;
  /** Who may write the slot (SlotWriter); a writer it does not name is refused at every store door, and a slot that names none takes no write. */
  writers?: readonly SlotWriter[];
  /** What the slot holds before any delta. */
  default: JsonValue;
  /** The rule every written value passes (a row of a keyed-list, a field of a fields slot, the whole of a value slot): the stores refuse a delta whose value does not fit it. A slot without one is checked by its writer. */
  shape?: Shape<unknown>;
  /** For a fields slot whose fields differ in kind: the rule one named field passes, or null for a name the slot does not have (the stores then refuse the delta). It stands in for `shape`. */
  shapeAt?: (path: readonly string[]) => Shape<unknown> | null;
}

/** A "fields" slot keeps each field with when it was first written and last written. */
export interface Field { value: JsonValue; createdAt: number; updatedAt: number }

/** Every slot's value, by slot id, after the shown versions. A slot no delta touched is absent. */
export type SceneState = { [slot: string]: JsonValue };

/** A keyframe is kept after every this many shown messages along a path. */
export const KEYFRAME_EVERY = 50;
