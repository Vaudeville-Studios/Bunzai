/** VAUDEVILLE Familiar, Basic, Immersive and Desktop 98, and the paper layouts (Letters, Notebook, Storybook), using Bunzai's existing scene bodies. */
import { useEffect, useRef, useState, type JSX } from "react";
import { useEscapeKey } from "../../../_shared/use-escape-key";
import { useSceneWidth, isCompact } from "../messenger/use-messenger-focus";
import { IconButton, ListRow } from "../../../components/button";
import { Ic } from "../../../_shared/ic";
import { DialogCore } from "../../../components/dialog-core";
import { ProgramPortals, ProgramSlot, useProgramHolders } from "../messenger/shell/program-holders";
import type { LayoutProps } from "./layout-props";
import { Desktop98 } from "./desktop98";
import { ADDITIONAL_LAYOUT_STYLE } from "./layout-style";
import { PAPER_LAYOUT_STYLE } from "./paper-layout-style";
import { Storybook } from "./storybook";

/** The header kicker above the character's name, per reading layout. */
const KICKER: Partial<Record<LayoutProps["layout"], string>> = { familiar: "Your scene", letters: "Correspondence with", notebook: "Journal" };

export function AdditionalLayout(p: LayoutProps): JSX.Element {
  return <><style>{ADDITIONAL_LAYOUT_STYLE + PAPER_LAYOUT_STYLE}</style>{p.layout === "desktop98" ? <Desktop98 {...p} /> : p.layout === "storybook" ? <Storybook {...p} /> : <ReadingLayout {...p} />}</>;
}

function ReadingLayout(p: LayoutProps): JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  const width = useSceneWidth(shell);
  const [menu, setMenu] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  const holderOf = useProgramHolders();
  const tools = useRef<HTMLButtonElement>(null);
  const close = (): void => { p.onWing(null); setMenu(false); };
  useEffect(() => { if (p.wing) setVisited((v) => v.includes(p.wing!) ? v : [...v, p.wing!]); }, [p.wing]);
  const { onSurface } = p;
  useEffect(() => { onSurface(menu || p.wing !== null); return () => onSurface(false); }, [menu, p.wing, onSurface]);
  const familiar = p.layout === "familiar", tabs = p.layout === "notebook";
  const inline = (familiar || tabs) && !isCompact(width);
  const toggle = (id: string): void => p.onWing(p.wing === id ? null : id);
  useEscapeKey(close, inline && p.wing !== null);
  const nav = <nav className="alt-tools" aria-label="Scene tools">
    {/* bounded-ok: the same finite wing catalog as the Full Chat rails. */}
    {p.wings.map((w) => <ListRow key={w.id} variant="option" label={w.label} leading={<Ic name={w.icon} />} selected={p.wing === w.id} onClick={() => { toggle(w.id); setMenu(false); }} />)}
  </nav>;
  const panel = <><header className="alt-panel-heading"><strong>{p.wings.find((w) => w.id === p.wing)?.label ?? "Scene settings"}</strong><IconButton variant="quiet" icon="lucide:x" label="Close scene settings" onClick={close} /></header>
    <div className="alt-panel-body">{p.wing ? <ProgramSlot holder={holderOf(p.wing)} /> : nav}</div></>;
  return <div ref={shell} className="alt-layout" data-chat-layout={p.layout}>
    <div className="alt-backdrop">{p.backdrop}</div>
    {familiar && <aside className="alt-rail" data-wing-panel-ignore-outside><nav className="alt-tools" aria-label="Familiar navigation">{/* bounded-ok: the finite scene wing catalog. */}{p.wings.map((w) => <IconButton key={w.id} variant="quiet" icon={w.icon} label={w.label} aria-pressed={p.wing === w.id} onClick={() => toggle(w.id)} />)}</nav></aside>}
    {tabs && <aside className="nb-tabs" data-wing-panel-ignore-outside><nav className="alt-tools" aria-label="Notebook tabs">{/* bounded-ok: the finite scene wing catalog. */}{p.wings.map((w) => <ListRow key={w.id} label={w.label} leading={<Ic name={w.icon} />} accent={w.tone} selected={p.wing === w.id} aria-pressed={p.wing === w.id} onClick={() => toggle(w.id)} />)}</nav></aside>}
    <main className="alt-main">
      <header className="alt-header"><IconButton variant="quiet" icon="lucide:arrow-left" label="Back to Scenes" onClick={p.onBack} />
        <div className="alt-now"><small>{KICKER[p.layout] ?? "Now playing"}</small><strong>{p.name}</strong></div>
        <div className="alt-actions">{p.actions}</div>
        <IconButton ref={tools} variant="quiet" icon="lucide:settings" label="Scene settings" onClick={() => setMenu(true)} />
      </header>
      <div className="alt-chat">{p.children}</div>
    </main>
    {(menu || p.wing) && (inline ? <aside className="alt-familiar-drawer" data-wing-panel-ignore-outside aria-label="Scene settings">{panel}</aside> : <DialogCore placement="center" ariaLabel={p.wings.find((w) => w.id === p.wing)?.label ?? "Scene settings"} onDismiss={close} className="alt-drawer" overlayClassName="alt-scrim">{panel}</DialogCore>)}
    <ProgramPortals ids={visited} programs={p.wings} holderOf={holderOf} render={(w) => p.renderWing(w.id)} />
  </div>;
}
