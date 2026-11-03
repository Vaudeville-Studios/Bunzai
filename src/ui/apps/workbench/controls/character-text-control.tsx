/** Shared character text/prose controls used by the Workbench and unsaved interview draft. */
import type { ChangeEvent, JSX } from "react";
import { ExpandTextarea } from "../../../components/expand";
import { RenderBox } from "../../../components/render-box";
import type { FieldModule } from "../fields";

export function CharacterTextControl({ field, value, onChange, styles, id, disabled, readOnly, maxLength, onFocus, defaultRendered }: {
  field: Pick<FieldModule, "id" | "kind" | "sheetLabel" | "placeholder">;
  value: string;
  onChange(value: string): void;
  styles: Readonly<Record<string, string>>;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  onFocus?(): void;
  defaultRendered?: boolean;
}): JSX.Element {
  const common = { id, value, disabled, readOnly, maxLength, onFocus, "aria-label": field.sheetLabel, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  if (field.kind === "text") return <input {...common} className={styles.in} placeholder={field.placeholder} />;
  if (field.kind !== "prose") throw new Error(`Unsupported character text control: ${field.id}`);
  return <RenderBox value={value} format="markdown" defaultRendered={defaultRendered}>
    <ExpandTextarea {...common} grow label={field.sheetLabel} className={`${styles.in} ${styles.ta}${field.id === "firstMes" || field.id === "mesExample" ? ` ${styles.mono}` : ""}`} spellCheck />
    <span className={styles.cnt}>{`${value.length} chars`}</span>
  </RenderBox>;
}
