/** Brief local feedback for actual accepted field changes; initial load and unchanged polls stay quiet. */
import { useEffect, useRef } from "react";
import { characterField, TABLE_READ_FIELDS, type TableReadField } from "../../../core/table-read/fields";
import type { TableReadSession } from "../../../core/table-read/schema";
import { FLASH_MS, useFlash } from "../../_shared/use-flash";

export function useFieldUpdates(session: TableReadSession, scope: object): readonly TableReadField[] {
  const previous = useRef({ session, scope });
  const { value, flash, clear } = useFlash<TableReadField[]>(FLASH_MS.notice);
  useEffect(() => {
    const before = previous.current;
    previous.current = { session, scope };
    if (before.session.id !== session.id || before.scope !== scope) { clear(); return; }
    const changed = TABLE_READ_FIELDS.filter((field) => characterField(before.session.body, field) !== characterField(session.body, field));
    if (!changed.length) return;
    flash(changed);
  }, [session, scope, clear, flash]);
  return value ?? [];
}
