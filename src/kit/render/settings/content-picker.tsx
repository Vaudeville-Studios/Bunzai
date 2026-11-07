/** @jsxImportSource @opentui/react */
/**
 * Provider picker: the drop-in spokes as flat .li rows (the picker pane is always the active pane in
 * this mode, so the current row lights up: row background, rose gutter accent, bright text). Each
 * row leads with a brand square echoing the rose logo mark. Clicking a row picks it. More providers than
 * the terminal has rows: the list follows the selection, so the row being chosen is always on screen.
 */
import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { theme } from "../theme";
import type { SettingsState } from "./model";
import { SelectableRow } from "../primitives/selectable-row";

/** The rows the settings frame and this heading leave of the terminal. */
const CHROME_ROWS = 14;

/** Where the visible run of `total` rows starts, keeping `index` inside it, as near the middle as the ends allow. */
export function pickerWindow(total: number, index: number, rows: number): number {
  const shown = Math.max(1, rows);
  return Math.max(0, Math.min(index - Math.floor(shown / 2), total - shown));
}

export function Picker({
  state,
  onPick,
}: {
  state: SettingsState;
  onPick: (index: number) => void;
}): ReactNode {
  const rows = Math.max(1, useTerminalDimensions().height - CHROME_ROWS);
  const first = pickerWindow(state.choices.length, state.pickerIndex, rows);
  return (
    <box flexDirection="column">
      <box paddingLeft={2}>
        <text fg={theme.mut}>Choose a provider</text>
      </box>
      <box flexDirection="column" paddingTop={1}>
        {state.choices.slice(first, first + rows).map((choice, offset) => {
          const index = first + offset;
          const selected = index === state.pickerIndex;
          return (
            <SelectableRow key={choice.id} selected={selected} onMouseDown={() => onPick(index)}>
              <text fg={choice.brand}>{"■ "}</text>
              <text fg={selected ? theme.text : theme.soft}>{choice.label}</text>
            </SelectableRow>
          );
        })}
      </box>
    </box>
  );
}
