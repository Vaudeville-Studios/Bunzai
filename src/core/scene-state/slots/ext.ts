/** Extension-owned per-scene key/value slots. The dedicated ChatStore door enforces package namespace. */
import { defineSlot } from "../define-slot";

export default defineSlot({ id: "ext:*", scope: "scene", diff: "fields", writers: ["extension"], default: {} });
