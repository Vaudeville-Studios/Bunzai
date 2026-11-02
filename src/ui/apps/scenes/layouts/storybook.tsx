/**
 * Storybook: the scene as an open book. The left page holds the character's portrait over a contents page of the scene's
 * tools, and an open tool takes that page's place; the right page is the conversation. Below the compact width the book
 * closes to one page and the left page opens as a dialog from the header.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { useEscapeKey } from "../../../_shared/use-escape-key";
import { useSceneWidth, isCompact } from "../messenger/use-messenger-focus";
import { IconButton, ListRow } from "../../../components/button";
import { Ic } from "../../../_shared/ic";
import { DialogCore } from "../../../components/dialog-core";
import { ProgramPortals, ProgramSlot, useProgramHolders } from "../messenger/shell/program-holders";
import type { LayoutProps } from "./layout-props";

export function Storybook(p: LayoutProps): JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  const compact = isCompact(useSceneWidth(shell));
  const [contents, setContents] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  const holderOf = useProgramHolders();
  const close = (): void => { p.onWing(null); setContents(false); };
  useEffect(() => { if (p.wing) setVisited((v) => v.includes(p.wing!) ? v : [...v, p.wing!]); }, [p.wing]);
  const { onSurface } = p;
  useEffect(() => { onSurface(contents || p.wing !== null); return () => onSurface(false); }, [contents, p.wing, onSurface]);
  useEscapeKey(close, !compact && p.wing !== null);
  const wing = p.wings.find((w) => w.id === p.wing);
  const heading = (title: string): JSX.Element => <header className="alt-panel-heading"><strong>{title}</strong><IconButton variant="quiet" icon="lucide:x" label="Close scene settings" onClick={close} /></header>;
  const page = wing
    ? <>{heading(wing.label)}<div className="alt-panel-body"><ProgramSlot holder={holderOf(wing.id)} /></div></>
    : <>{compact && heading("Contents")}<div className="sb-contents">
      <figure className="sb-portrait">{p.portrait}<figcaption>{p.name}</figcaption></figure>
      <nav className="alt-tools" aria-label="Scene tools"><small>Contents</small>
        {/* bounded-ok: the finite scene wing catalog. */}
        {p.wings.map((w) => <ListRow key={w.id} label={w.label} subtitle={w.blurb} leading={<Ic name={w.icon} />} accent={w.tone} onClick={() => p.onWing(w.id)} />)}
      </nav>
    </div></>;
  return <div ref={shell} className="alt-layout" data-chat-layout="storybook">
    <div className="alt-backdrop">{p.backdrop}</div>
    <div className="sb-book">
      {!compact && <aside className="sb-page sb-left" data-wing-panel-ignore-outside aria-label={wing?.label ?? "Contents"}>{page}</aside>}
      <main className="sb-page alt-main">
        <header className="alt-header"><IconButton variant="quiet" icon="lucide:arrow-left" label="Back to Scenes" onClick={p.onBack} />
          <div className="alt-now"><small>Once upon a scene</small><strong>{p.name}</strong></div>
          <div className="alt-actions">{p.actions}</div>
          {compact && <IconButton variant="quiet" icon="lucide:book-open" label="Scene settings" onClick={() => setContents(true)} />}
        </header>
        <div className="alt-chat">{p.children}</div>
      </main>
    </div>
    {compact && (contents || wing) && <DialogCore placement="center" ariaLabel={wing?.label ?? "Scene settings"} onDismiss={close} className="alt-drawer" overlayClassName="alt-scrim">{page}</DialogCore>}
    <ProgramPortals ids={visited} programs={p.wings} holderOf={holderOf} render={(w) => p.renderWing(w.id)} />
  </div>;
}
