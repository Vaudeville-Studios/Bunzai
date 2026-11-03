/**
 * The "New <kind>" button on a deck's shelf, for every kind the Library may create blank (canCreateBlank);
 * a kind without one renders nothing (packs are imported or made in the Workbench, libraryNew: false). `compact` renders the crumb-row variant so
 * POPULATED decks keep a create door too - create used to exist only on empty shelves.
 */
import type { JSX } from "react";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import { toErrorMessage } from "../../_shared/error-message";
import { canCreateBlank, createBlank } from "../../_shared/new-piece";
import { kindOf } from "../../../generated/kinds";
import { Button, Tile } from "../../components/button";

export interface NewInDeckButtonProps {
  kind: string;
  ctx: AppContext;
  /** append the freshly created summary to the deck (parent dedupes by kind+id). */
  onCreated: (summary: StudioEntitySummary) => void;
  /** crumb-row variant for populated decks (the full stamp lives on the empty ghost shelf) */
  compact?: boolean;
  /** the dashed tile that closes a row of cards, as the old shelves' New set and New persona cards did */
  tile?: boolean;
}

export function NewInDeckButton({ kind, ctx, onCreated, compact = false, tile = false }: NewInDeckButtonProps): JSX.Element | null {
  const k = kindOf(kind);
  if (!k || !canCreateBlank(kind)) return null;
  const word = k.singular.toLowerCase();
  const spec = { label: `New ${word}`, word };
  const create = (): void => {
    void (async () => {
      try {
        const summary = await createBlank(ctx, kind);
        onCreated(summary);
        ctx.workbench.open(summary);
        ctx.setStatus(`opened ${spec.word} · ${summary.name}`);
      } catch (err) {
        ctx.setStatus(toErrorMessage(err, `could not create the ${spec.word}`));
      }
    })();
  };
  if (tile) {
    return (
      <Tile kind="add" size="fill" data-part="library.new.tile" label={spec.label} icon={<span className="rnewlbl">+ {spec.label}</span>} onClick={create} />
    );
  }
  if (compact) {
    return (
      <><Button size="sm" data-part="library.new.compact" onClick={create}>
        + {spec.label}
      </Button>{kind === "character" && <Button size="sm" variant="quiet" icon="lucide:message-square" data-part="library.new.interview" onClick={() => ctx.openApp("table-read")}>Table Read</Button>}</>
    );
  }
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <Button variant="primary" onClick={create}>
        {spec.label}
      </Button>
      {kind === "character" && <Button variant="quiet" icon="lucide:message-square" data-part="library.new.interview" onClick={() => ctx.openApp("table-read")}>Create through a Table Read</Button>}
    </div>
  );
}
