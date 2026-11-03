/**
 * The Stage wing's Backdrop row (approved wireframe design/wireframes/backdrops/index.html, screen 1): the picked
 * picture's thumbnail and Change, or the plain words for none, gone and unreadable. RoleCall keeps its background
 * picker in the Stage settings panel's "The Stage" act (StageSettingsPanel.tsx:2116-2136), so this is where it lives
 * here too. The pick is the scene's own (ChatStore rule 36) and is saved the moment it is made.
 */
import { useRef, useState, type CSSProperties, type DragEvent, type JSX } from "react";
import type { AppContext } from "../../app-contract";
import { Ic } from "../../_shared/ic";
import { toErrorMessage } from "../../_shared/error-message";
import type { Chat, ChatBackdrop } from "../../../stage/contracts/chat-store";
import { Button } from "../../components/button";
import { itemOf } from "./scene-backdrop-core";
import { BackdropThumb } from "./scene-backdrop-layer";
import { BackdropPicker } from "./scene-backdrop-picker";
import { useBackdropPack } from "./use-backdrop-pack";
import { createPackWithImages } from "./scene-backdrop-add";
import { isPackPictureName } from "../../../core/media/pack-picture";


export function BackdropRow({ ctx, chat, cardPinned, onChat }: { ctx: AppContext; chat: Chat; cardPinned?: boolean; onChat(chat: Chat): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const loaded = useBackdropPack(ctx, chat.backdrop?.pack);
  const item = chat.backdrop && loaded.state === "ready" ? itemOf(loaded.pack, chat.backdrop) : null;
  const gone = chat.backdrop !== undefined && (loaded.state === "gone" || (loaded.state === "ready" && item === null));
  const pick = async (backdrop: ChatBackdrop | null): Promise<boolean> => {
    setProblem(null);
    try {
      onChat(await ctx.api.setSceneBackdrop(chat.id, backdrop));
      return true;
    } catch (e) {
      setProblem(`Could not change the backdrop: ${toErrorMessage(e)}`);
      return false;
    }
  };
  const addFiles = async (files: FileList | null): Promise<void> => {
    const pictures = files ? [...files].filter((f) => isPackPictureName(f.name)) : [];
    if (pictures.length === 0 || adding) return;
    setAdding(true);
    setProblem(null);
    try {
      const result = await createPackWithImages(ctx, pictures);
      const first = result.items[0];
      if (result.pack && first && !(await pick({ pack: result.pack.id, item: first.id, ...(chat.backdrop?.dim === undefined ? {} : { dim: chat.backdrop.dim }), ...(chat.backdrop?.blur === undefined ? {} : { blur: chat.backdrop.blur }), ...(chat.backdrop?.rate === undefined ? {} : { rate: chat.backdrop.rate }) }))) {
        await ctx.api.deleteEntity("pack", result.pack.id).catch(() => undefined);
      }
      if (result.failed.length) setProblem(`Added ${String(result.added)}. Could not add: ${result.failed.join(", ")}.`);
      else if (!first) setProblem("Could not add those pictures.");
    } catch (e) { setProblem(`Could not add the backdrop: ${toErrorMessage(e)}`); }
    finally { setAdding(false); if (file.current) file.current.value = ""; }
  };
  const dropFiles = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  };
  const hint = gone ? "This scene's backdrop is no longer in your collection, so the scene shows the theme's own look."
    : loaded.state === "failed" ? "This backdrop could not be read right now."
    : chat.backdrop ? `The picture behind the messages${item ? `: ${item.label}.` : "."} Only this scene changes.`
    : cardPinned ? "The character's own background shows until you pick one here. Only this scene changes."
    : "The picture behind the messages. Only this scene changes. None keeps the theme's own look.";
  return (
    <>
      <div className="prop-row" style={{ "--tone": "var(--stage-macro)" } as CSSProperties} data-part="scene.backdrop.row" data-local-file-drop onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
        <span className="prop-ic"><Ic name="lucide:image" size={20} /></span>
        <div><b>Backdrop</b><small>{problem ?? hint}</small></div>
        <div className="bd-act">
          {item && <BackdropThumb refValue={item.ref} {...(item.mime ? { mime: item.mime } : {})} className="bd-thumb" />}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="Add backdrop pictures" onChange={(e) => void addFiles(e.target.files)} />
          <Button size="sm" disabled={adding} onClick={() => file.current?.click()}>{adding ? "Adding..." : chat.backdrop ? "Change" : "Pick"}</Button>
          <Button size="sm" disabled={adding} onClick={() => setOpen(true)}>Choose from collection</Button>
        </div>
      </div>
      {open && <BackdropPicker ctx={ctx} backdrop={chat.backdrop} onPick={async (next) => { await pick(next); }} onClose={() => setOpen(false)} />}
    </>
  );
}
