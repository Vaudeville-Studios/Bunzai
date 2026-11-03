/**
 * PromptEditPanel - the EDIT PROMPT tab of the right rail (a faithful transcription of RC's
 * PromptEditPanelV4). Returns the rail's CONTENT, not the <aside>: the rail is owned by the editor
 * so it can tab between this (per-BLOCK truth) and LiveBuild (whole-PRESET truth).
 * Edits the SELECTED block's METADATA: name, role, a token-count card, injection
 * order (+ hint), placement (per-lens select + the conditional hint for the non-relative stops),
 * injection depth (in an accent card when at-depth), a content-preview notice with char/token
 * counts, the Advanced flags (system prompt / forbid overrides) + marker card, and the capability-
 * driven macro reference. Field labels carry a "?" help dot (RC's PROMPT_TOOLTIPS text). Content is
 * edited INLINE in the list (RC's split). Edits apply live via onPatch; the ehead Save persists.
 * NOT ported (deliberate): RC's per-block Cancel/Save footer (vaud saves the whole preset from the
 * ehead) and its non-marker "Use + Add marker slot" card (vaud has no marker-slot picker yet).
 */
import { Button, IconButton } from "../../../components/button";
import { Ic } from "../../../_shared/ic";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { PresetAttachment, PresetGroup, PresetPrompt, PromptRole } from "../../../../entities/preset";
import type { StagedAssetUpload } from "../../../app-contract-editor";
import { PROMPT_ATTACHMENT_BLOCK_COUNT } from "../../../../core/media/limits";
import { readAssetSize, useArtSrc } from "../../../_shared/art-cache";
import { embeddedMediaBytes, parseUploadedRef } from "../../../../entities/piece-parts-blob";
import {
  blockTokens,
  groupSections,
  macroGroupsForProfile,
  PRESET_PLACEMENT_LABELS,
  type PresetWriteForProfile,
} from "../../../../core/preset";
import { MacroReference } from "./macro-reference";
import { HelpDot } from "./help-dot";
import { PROMPT_HELP } from "./help";
import s from "./sidebar.module.css";
import f from "./preset.module.css";

const ROLES: readonly PromptRole[] = ["system", "user", "assistant", "tool"];
const DEPTH_PLACEMENTS = new Set(["in_chat", "append"]);

/** Faithful RC hint copy shown under the placement select for the non-relative stops. */
const PLACEMENT_HINTS: Record<string, string> = {
  append:
    "Glued onto the end of the depth-th-from-last message of this prompt's role (system uses the user's message). Keeps message alternation intact.",
  append_preset:
    "Pinned to the very end of the assembled prompt, after chat history, post-history prompts, and the author's note. Holds regardless of list order.",
  prepend_preset:
    "Pinned to the very top of the assembled prompt, before relative prompts and everything else. Holds regardless of list order.",
};

export interface PromptEditPanelProps {
  /** Parent identity keeps uploads scoped when prompt ids repeat across editors, such as book phases. */
  ownerKey: string;
  block: PresetPrompt | null;
  /** placement stops the active Write-for lens carries (placementsForProfile) */
  stops: readonly string[];
  /** the selected Write-for lens - drives which macro groups the reference shows */
  writeFor: PresetWriteForProfile;
  /** categories this preset has; the picker is hidden entirely when there are none */
  groups: readonly PresetGroup[];
  onSetGroup: (groupId: string | null) => void;
  onClose: () => void;
  onPatch: (patch: Partial<PresetPrompt>) => void;
  uploads: readonly StagedAssetUpload[];
  stageAsset: (file: File, signal?: AbortSignal) => Promise<StagedAssetUpload>;
  pinUploads: (refs: readonly string[]) => void;
  discardUploads: (refs: readonly string[]) => Promise<void>;
  onAddAttachment: (attachment: PresetAttachment, receipt: string) => boolean;
  onRemoveAttachment: (ref: string, occurrence: number) => void;
}

const UNCATEGORIZED = "__none__";

export function PromptEditPanel({
  ownerKey,
  block,
  stops,
  writeFor,
  groups,
  onSetGroup,
  onClose,
  onPatch,
  uploads,
  stageAsset,
  pinUploads,
  discardUploads,
  onAddAttachment,
  onRemoveAttachment,
}: PromptEditPanelProps): JSX.Element {
  const macroGroups = useMemo(() => macroGroupsForProfile(writeFor), [writeFor]);
  const blockId = block?.id;
  const uploadOwner = blockId === undefined ? undefined : `${ownerKey}\u0000${blockId}`;
  const activeBlock = useRef(uploadOwner);
  activeBlock.current = uploadOwner;
  const upload = useRef<AbortController | null>(null);
  const [uploadingBlock, setUploadingBlock] = useState<string | null>(null);
  useEffect(() => () => { upload.current?.abort(); }, [uploadOwner]);
  const categoryOptions = useMemo(() => {
    const names = new Map(groups.map((group) => [group.id, group.name || "Untitled category"]));
    return groupSections([], groups)
      .filter((section) => section.group !== null)
      .map((section) => ({
        group: section.group!,
        label: [...section.ancestorIds, section.group!.id]
          .map((id) => names.get(id) ?? "Untitled category")
          .join(" / "),
      }));
  }, [groups]);
  return (
    <>
      <div className={s.sideHead}>
        <span className={s.sideHeadTitle}>{block ? block.name || "Untitled block" : "Edit Prompt"}</span>
        {block && (
          <IconButton label="Close editor" variant="quiet" size="sm" icon="lucide:x" onClick={onClose} />
        )}
      </div>

      {block === null ? (
        <div className={s.sideEmpty}>
          <p className={s.sideEmptyTitle}>No prompt selected</p>
          <p className={s.sideEmptyHint}>Select a block from the list to view and edit its settings.</p>
        </div>
      ) : (
        <div className={s.sideBody}>
          <div className={s.sideRow}>
            <label className={f.sfield}>
              <span className={f.flabel}>Name</span>
              <input
                className={f.field}
                value={block.name}
                placeholder="Block name"
                aria-label="Block name"
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </label>
            <label className={f.sfield}>
              <span className={f.flabel}>
                Role
                <HelpDot help={PROMPT_HELP.role} />
              </span>
              <select
                className={f.field}
                value={block.role}
                aria-label="Block role"
                onChange={(e) => onPatch({ role: e.target.value as PromptRole })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {groups.length > 0 && (
            <label className={f.sfield}>
              <span className={f.flabel}>Category</span>
              <select
                className={f.field}
                value={block.groupId ?? UNCATEGORIZED}
                aria-label="Category"
                onChange={(e) => onSetGroup(e.target.value === UNCATEGORIZED ? null : e.target.value)}
              >
                <option value={UNCATEGORIZED}>Uncategorized</option>
                {categoryOptions.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ ({ group, label }) => (
                  <option key={group.id} value={group.id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={s.tokenCard}>
            <span className={s.tokenCardLabel}>Token count</span>
            <span className={s.tokenCardVal}>{block.marker ? "slot" : blockTokens(block)}</span>
          </div>

          <label className={f.sfield}>
            <span className={f.flabel}>
              Injection order
              <HelpDot help={PROMPT_HELP.injectionOrder} />
            </span>
            <input
              className={f.field}
              type="number"
              value={block.injectionOrder}
              aria-label="Injection order"
              onChange={(e) => onPatch({ injectionOrder: Number(e.target.value) })}
            />
            <span className={s.sideHintLine}>Lower values appear first in context.</span>
          </label>

          <label className={f.sfield}>
            <span className={f.flabel}>
              Placement
              <HelpDot help={PROMPT_HELP.placement} />
            </span>
            <select
              className={f.field}
              value={block.placement}
              aria-label="Placement"
              onChange={(e) => onPatch({ placement: e.target.value })}
            >
              {stops.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (stop) => (
                <option key={stop} value={stop}>
                  {PRESET_PLACEMENT_LABELS[stop]?.label ?? stop}
                  {PRESET_PLACEMENT_LABELS[stop]?.hint ? ` - ${PRESET_PLACEMENT_LABELS[stop]!.hint}` : ""}
                </option>
              ))}
              {!stops.includes(block.placement) && (
                <option value={block.placement}>
                  {PRESET_PLACEMENT_LABELS[block.placement]?.label ?? block.placement} (held from another lens)
                </option>
              )}
            </select>
            {PLACEMENT_HINTS[block.placement] && (
              <span className={s.sideHint}>{PLACEMENT_HINTS[block.placement]}</span>
            )}
          </label>

          <section className={s.attachments} aria-label="Prompt block attachments">
            <strong>Attachments</strong>
            <p className={s.sideHint}>Files stay attached to this block. System and assistant block files are sent as a companion user message.</p>
            {block.marker || block.role === "tool" ? <p role="note">Attachments are unavailable on markers and tool-result blocks.</p> : (block.attachments?.length ?? 0) >= PROMPT_ATTACHMENT_BLOCK_COUNT ? <p role="note">A prompt block can have at most {PROMPT_ATTACHMENT_BLOCK_COUNT} attachments.</p> : <label className={f.sfield}>
              <span className={f.flabel}>Add a file</span>
              <input className={f.field} type="file" disabled={uploadingBlock === uploadOwner} accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.csv,.json" aria-label="Add prompt attachment" onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (!file || uploadingBlock === uploadOwner || !uploadOwner) return;
                const owner = uploadOwner;
                const controller = new AbortController();
                upload.current = controller;
                setUploadingBlock(owner);
                void stageAsset(file, controller.signal).then((grant) => {
                  if (controller.signal.aborted || activeBlock.current !== owner || !onAddAttachment({ name: file.name, ref: grant.asset }, grant.ref)) {
                    void discardUploads([grant.ref]);
                    return;
                  }
                  pinUploads([grant.ref]);
                }).catch(() => undefined).finally(() => {
                  if (upload.current === controller) upload.current = null;
                  setUploadingBlock((current) => current === owner ? null : current);
                });
              }} />
            {uploadingBlock === uploadOwner && <span role="status">Staging file…</span>}
            </label>}
            {block.attachments?.map(/* bounded-ok: canonical block schema caps attachments at eight */ (attachment, occurrence) => <AttachmentRow key={`${attachment.ref}:${occurrence}`} attachment={attachment} uploads={uploads} onRemove={() => onRemoveAttachment(attachment.ref, occurrence)} />)}
            {!block.attachments?.length && <span className={s.sideHint}>No files attached.</span>}
          </section>

          {DEPTH_PLACEMENTS.has(block.placement) && (
            <div className={s.sideDepthCard}>
              <label className={f.sfield}>
                <span className={f.flabel}>
                  Injection depth
                  <HelpDot help={PROMPT_HELP.injectionDepth} />
                </span>
                <input
                  className={f.field}
                  type="number"
                  min={0}
                  value={block.injectionDepth}
                  aria-label="Injection depth"
                  onChange={(e) => onPatch({ injectionDepth: Number(e.target.value) })}
                />
              </label>
            </div>
          )}

          <p className={s.sideContentNote}>
            Edit this block's content inline. Click its expand arrow in the list.
            <span className={s.sideContentCount}>
              {block.content.length} characters · ~{blockTokens(block)} tokens
            </span>
          </p>

          <div className={s.sideAdvanced}>
            <span className={s.sideAdvancedLabel}>Advanced</span>
            <label className={s.sideCheck}>
              <span>
                System prompt
                <HelpDot help={PROMPT_HELP.systemPrompt} />
              </span>
              <input
                type="checkbox"
                checked={block.systemPrompt}
                onChange={(e) => onPatch({ systemPrompt: e.target.checked })}
              />
            </label>
            <label className={s.sideCheck}>
              <span>Forbid overrides</span>
              <input
                type="checkbox"
                checked={block.forbidOverrides}
                onChange={(e) => onPatch({ forbidOverrides: e.target.checked })}
              />
            </label>
            {block.marker && (
              <p className={s.sideMarker}>
                <span>
                  Marker slot
                  <HelpDot help={PROMPT_HELP.marker} />
                </span>
                : {block.markerSlot ?? "unset"} · its content splices in at build.
              </p>
            )}
          </div>

          <MacroReference groups={macroGroups} />
        </div>
      )}
    </>
  );
}

function AttachmentRow({ attachment, uploads, onRemove }: { attachment: PresetAttachment; uploads: readonly StagedAssetUpload[]; onRemove(): void }): JSX.Element {
  const staged = uploads.find((upload) => upload.asset === attachment.ref);
  const parsed = parseUploadedRef(attachment.ref);
  const embedded = embeddedMediaBytes(attachment.ref);
  const sha = parsed?.sha;
  const embeddedSize = embedded?.bytes.byteLength;
  const mime = staged?.mime ?? parsed?.mime ?? embedded?.mime ?? "unknown type";
  const [bytes, setBytes] = useState<number | null>(staged?.bytes ?? embeddedSize ?? null);
  const art = useArtSrc(mime.startsWith("image/") ? attachment.ref : null);
  useEffect(() => {
    if (staged) { setBytes(staged.bytes); return; }
    if (embeddedSize !== undefined) { setBytes(embeddedSize); return; }
    setBytes(null);
    if (!sha) return;
    const controller = new AbortController();
    void readAssetSize(`/api/asset/${sha}`, controller.signal).then(setBytes).catch(() => undefined);
    return () => controller.abort();
  }, [sha, staged, embeddedSize]);
  return <div className={s.attachment}>
    {mime.startsWith("image/") ? <img ref={art.ref as (node: HTMLImageElement | null) => void} src={art.src} alt="" /> : <span className={s.attachmentIcon} aria-hidden="true"><Ic name="lucide:file-text" size={20} /></span>}
    <span><strong>{attachment.name}</strong><small>{mime} · {bytes === null ? "size unavailable" : `${bytes.toLocaleString()} bytes`}</small></span>
    <Button size="sm" variant="quiet" onClick={onRemove}>Remove</Button>
  </div>;
}
