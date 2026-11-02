/** Full Chat's rail, pause affordance and wing slots, separated from the shared scene transcript. */
import type { JSX } from "react";
import { Tile } from "../../../components/button";
import { Ic } from "../../../_shared/ic";
import { WingRails } from "../scene-wings";
import { WingSlot } from "../scene-wing-frame";
import type { Wing } from "../scene-wing-data";
export function FullChatWings({ wing, side, extra, onWing, renderWing }: { wing: string | null; side: "l" | "r" | undefined; extra: readonly Wing[]; onWing(id: string | null): void; renderWing(id: string): JSX.Element }): JSX.Element {
  return <>
    <WingRails open={wing} onToggle={(id) => onWing(wing === id ? null : id)} extra={extra} />
    {wing && <><div className="wback" aria-hidden="true" /><div data-part="scene.paused"><Tile kind="icon" size="lg" label="Close the wing" icon={<Ic name="lucide:pause" size={26} />} caption="SCENE PAUSED" onClick={() => onWing(null)} /></div></>}
    {(["l", "r"] as const).map((sd) => <WingSlot key={sd} side={sd} open={side === sd}>{wing && side === sd && renderWing(wing)}</WingSlot>)}
  </>;
}
