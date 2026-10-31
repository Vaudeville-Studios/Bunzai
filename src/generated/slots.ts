/**
 * Generated scene-state slot list. Run `bun run slots` to update it; do not edit it by hand.
 * The truth is src/core/scene-state/slots/<id>.ts. Static imports, so the browser bundle and the single-file builds reach every slot without walking a folder.
 */
import { makeSlotOf } from "../core/scene-state/slot-lookup";
import type { SlotDef } from "../core/scene-state/types";
import slot0 from "../core/scene-state/slots/ext";
import slot1 from "../core/scene-state/slots/global";
import slot2 from "../core/scene-state/slots/skills";
import slot3 from "../core/scene-state/slots/summary";
import slot4 from "../core/scene-state/slots/tracker-list";
import slot5 from "../core/scene-state/slots/tracker-record";
import slot6 from "../core/scene-state/slots/tracker";
import slot7 from "../core/scene-state/slots/vars";

/** Every scene-state slot, by id. */
export const SLOTS = [slot0, slot1, slot2, slot3, slot4, slot5, ...slot6, slot7] as const;

/** A slot's declaration, or undefined for an id that is not a slot: an exact id, else the family that covers it (tracker-record:<pieceId>). */
export const slotOf: (id: string) => SlotDef | undefined = makeSlotOf(SLOTS);
