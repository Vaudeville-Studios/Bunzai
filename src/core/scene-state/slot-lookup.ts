/**
 * `makeSlotOf`: the lookup from a slot id to its declaration over the declared slots. An exact id wins; otherwise a family
 * (`tracker-record:*`) covers every id that starts with its prefix and has a member part of 1 to 120 characters, so the store never
 * sees library pieces: it asks for a slot and gets the family's rules. Two families whose prefixes overlap, or one declared twice, are
 * refused at build, so no id can match two.
 */
import type { SlotDef } from "./types";

const MEMBER_MAX = 120;
const EXTENSION_SLOT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+:[a-z][a-z0-9._-]{0,63}$/;

export function makeSlotOf(slots: readonly SlotDef[]): (id: string) => SlotDef | undefined {
  const exact = new Map<string, SlotDef>();
  const families: { prefix: string; def: SlotDef }[] = [];
  for (const def of slots) {
    if (!def.id.endsWith(":*")) {
      exact.set(def.id, def);
      continue;
    }
    const prefix = def.id.slice(0, -1);
    const clash = families.find((f) => f.prefix.startsWith(prefix) || prefix.startsWith(f.prefix));
    if (clash) throw new Error(clash.prefix === prefix ? `slot family ${def.id} is declared twice` : `slot families ${clash.def.id} and ${def.id} overlap`);
    families.push({ prefix, def });
  }
  return (id) => {
    const own = exact.get(id);
    if (own) return own;
    const family = families.find((f) => id.startsWith(f.prefix));
    if (!family || id === `${family.prefix}*` || id.length <= family.prefix.length) return undefined;
    const member = id.slice(family.prefix.length);
    if (family.prefix === "ext:") return EXTENSION_SLOT_ID.test(member) ? family.def : undefined;
    return member.length <= MEMBER_MAX ? family.def : undefined;
  };
}
