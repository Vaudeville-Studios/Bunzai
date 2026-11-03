/**
 * The backdrop picker (approved wireframe design/wireframes/backdrops/index.html, screens 2 and 3): a dialog over the
 * scene with None first and a grid of the chosen pack's pictures, a pack choice when the library holds more than one,
 * a name filter, the overlay darkness (RoleCall's "Overlay Darkness", StageSettingsPanel.tsx:1411-1428), and Add
 * image. Picking one hangs it on the scene at once; None undoes it. Differs from RoleCall in one way: RoleCall's
 * choices are presets, a personal library and a URL, while a Bunzai scene picks from a Sprite pack.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from "react";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import { InkDialog } from "../../components/ink-dialog";
import { Slider } from "../../components/slider";
import { SegControl } from "../settings/section-contract";
import { toErrorMessage } from "../../_shared/error-message";
import { useDebouncedSave } from "../../_shared/use-debounced-value";
import type { ChatBackdrop } from "../../../stage/contracts/chat-store";
import { DEFAULT_DIM, MAX_BLUR, MAX_DIM, MAX_RATE, MIN_RATE, blurOf, dimOf, isVideoRef, rateOf } from "./scene-backdrop-core";
import { Button, Tile } from "../../components/button";
import { addImagesToPack, addLinkToPack, createPackWithImages } from "./scene-backdrop-add";
import { BackdropThumb } from "./scene-backdrop-layer";
import { useBackdropPack } from "./use-backdrop-pack";
import { VirtualShelf } from "../../_shared/virtual-list";
import { isPackPictureName } from "../../../core/media/pack-picture";

const GRID_ROW_PX = 90;

const SAVE_DELAY_MS = 300;

export function BackdropPicker({ ctx, backdrop, onPick, onClose }: {
  ctx: AppContext;
  backdrop: ChatBackdrop | undefined;
  onPick(backdrop: ChatBackdrop | null): Promise<void>;
  onClose(): void;
}): JSX.Element {
  const [packs, setPacks] = useState<StudioEntitySummary[] | null>(null);
  const [packId, setPackId] = useState<string | undefined>(backdrop?.pack);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dim, setDim] = useState(backdrop ? dimOf(backdrop) : DEFAULT_DIM);
  const [rate, setRate] = useState(backdrop ? rateOf(backdrop) : 1);
  const [blur, setBlur] = useState(backdrop ? blurOf(backdrop) : 0);
  const [link, setLink] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const shown = useBackdropPack(ctx, packId);

  useEffect(() => {
    let live = true;
    ctx.api.listEntities("pack").then((list) => {
      if (!live) return;
      setPacks(list);
      setPackId((current) => current ?? list[0]?.id);
    }, () => { if (live) setPacks([]); });
    return () => { live = false; };
  }, [ctx]);

  // The sliders drag fast; save once they rest, and when the picker closes with a change still waiting.
  const held = useRef({ backdrop, onPick });
  held.current = { backdrop, onPick };
  const sliders = useDebouncedSave<{ dim: number; rate: number; blur: number }>(async (next) => {
    const { backdrop: current, onPick: pick } = held.current;
    if (!current || (next.dim === (current.dim ?? DEFAULT_DIM) && next.rate === (current.rate ?? 1) && next.blur === blurOf(current))) return;
    const { rate: _old, blur: _oldBlur, ...rest } = current;
    await pick({ ...rest, dim: next.dim, ...(next.rate === 1 ? {} : { rate: next.rate }), ...(next.blur === 0 ? {} : { blur: next.blur }) });
  }, SAVE_DELAY_MS, (e) => setNote(`Could not save the backdrop. ${toErrorMessage(e, "")}`.trim()));
  /** A pick carries the sliders' values itself, so a value still waiting must not save over it afterwards. */
  const pickNow = (next: ChatBackdrop | null): void => { sliders.cancel(); void onPick(next); };
  const playing = shown.state === "ready" && backdrop && backdrop.pack === packId ? shown.pack.items.find((i) => i.id === backdrop.item) : undefined;
  const isVideo = playing ? isVideoRef(playing.ref, playing.mime) : false;

  const items = useMemo(() => {
    if (shown.state !== "ready") return [];
    const words = query.trim().toLowerCase();
    return words ? shown.pack.items.filter((i) => i.label.toLowerCase().includes(words)) : shown.pack.items;
  }, [shown, query]);

  const add = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setAdding(true);
    setNote(null);
    try {
      const accepted = [...files].filter((f) => isPackPictureName(f.name) || ["video/mp4", "video/webm", "video/quicktime"].includes(f.type));
      const result = packId
        ? { ...await addImagesToPack(ctx, packId, accepted), pack: undefined }
        : await createPackWithImages(ctx, accepted);
      if (!packId && result.pack) { setPacks((current) => [...(current ?? []), result.pack!]); setPackId(result.pack.id); }
      shown.reload();
      setNote(result.failed.length > 0 ? `Added ${String(result.added)}. Could not add: ${result.failed.join(", ")}.` : `Added ${String(result.added)}.`);
    } catch (error) { setNote(`Could not add those files. ${toErrorMessage(error, "")}`.trim()); }
    finally { setAdding(false); if (file.current) file.current.value = ""; }
  };

  const dropFiles = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    void add(event.dataTransfer.files);
  };

  const addLink = async (): Promise<void> => {
    if (!link.trim() || !packId) return;
    setAdding(true);
    setNote(null);
    const result = await addLinkToPack(ctx, packId, link);
    if (result.added > 0) { setLink(""); shown.reload(); }
    setNote(result.added > 0 ? "Added the link's file to this pack." : (result.reason ?? "Could not add that link."));
    setAdding(false);
  };

  const empty = packs !== null && packs.length === 0;
  return (
    <InkDialog onDismiss={onClose} ariaLabel="Pick a backdrop" sheetClassName="bdk">
      <h2>Pick a backdrop</h2>
      {empty ? (
        <>
          <p className="hint">Nothing in your collection to pick from yet. Add pictures here or drop them below to create a backdrop pack.</p>
          <div className="gscroll" data-local-file-drop onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
            <p className="hint">Drop pictures here</p>
          </div>
          {note && <p className="hint" role="status">{note}</p>}
        </>
      ) : (
        <>
          {packs && packs.length > 1 && packId && (
            <SegControl options={packs.map((p) => ({ value: p.id, label: p.name || "Untitled pack" }))} current={packId} onPick={(id) => { setPackId(id); setQuery(""); }} />
          )}
          <div className="bar">
            <input type="search" value={query} placeholder="Filter by name" aria-label="Filter by name" onChange={(e) => setQuery(e.target.value)} />
            <span className="hint">{shown.state === "ready" ? `${String(shown.pack.items.length)} ${shown.pack.items.length === 1 ? "picture" : "pictures"}` : ""}</span>
          </div>
          <div className="gscroll" data-local-file-drop role="listbox" aria-label="Backdrops" onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
            <VirtualShelf items={items} keyOf={(i) => i.id} rowClass="grow" estimate={GRID_ROW_PX}
              head={
                <Tile kind="thumb" size="fill" role="option" aria-selected={!backdrop} selected={!backdrop} label="None" art="None" onClick={() => pickNow(null)} />
              }
              render={(i) => {
                const on = backdrop?.pack === packId && backdrop?.item === i.id;
                return (
                  <Tile data-pick={i.id} kind="thumb" size="fill" role="option" aria-selected={on} selected={on} label={i.label}
                    onClick={() => packId && pickNow({ pack: packId, item: i.id, ...(dim === DEFAULT_DIM ? {} : { dim }), ...(blur === 0 ? {} : { blur }) })}
                    art={<><BackdropThumb refValue={i.ref} {...(i.mime ? { mime: i.mime } : {})} /><span className="cap">{i.label}</span></>} />
                );
              }} />
          </div>
          {shown.state === "loading" && <p className="hint">Loading...</p>}
          {(shown.state === "gone" || shown.state === "failed") && <p className="hint">This pack could not be read. Pick another, or choose None.</p>}
          {backdrop && isVideo && (
            <label className="dim"><span>Video speed</span>
              <Slider value={rate} min={MIN_RATE} max={MAX_RATE} step={0.05} onChange={(v) => { setRate(v); sliders.push({ dim, rate: v, blur }); }} format={(v) => v.toFixed(2) + "x"} aria-label="Video speed" />
            </label>
          )}
          {backdrop && (
            <label className="dim"><span>Overlay darkness</span>
              <Slider value={dim} min={0} max={MAX_DIM} step={0.05} onChange={(v) => { setDim(v); sliders.push({ dim: v, rate, blur }); }} format={(v) => `${String(Math.round(v * 100))}%`} aria-label="Overlay darkness" />
            </label>
          )}
          {backdrop && (
            <label className="dim"><span>Blur</span>
              <Slider value={blur} min={0} max={MAX_BLUR} step={1} onChange={(v) => { setBlur(v); sliders.push({ dim, rate, blur: v }); }} format={(v) => `${String(v)} px`} aria-label="Blur" />
            </label>
          )}
          <div className="bar">
            <input type="url" value={link} placeholder="Add from a link: https picture or video" aria-label="Add from a link" disabled={adding} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addLink(); }} />
            <Button onClick={() => void addLink()} disabled={adding || !link.trim()}>Add link</Button>
          </div>
          <p className="hint">{note ?? "Picking one hangs it on this scene at once, and None undoes it. Add image puts new pictures and videos into this pack; a link is fetched once and kept in the pack."}</p>
        </>
      )}
      <div className="actions">
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple hidden aria-label="Add backdrop media to collection" onChange={(e) => void add(e.target.files)} />
        <Button onClick={() => file.current?.click()} disabled={adding}>{adding ? "Adding..." : "Add image or video"}</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </InkDialog>
  );
}
