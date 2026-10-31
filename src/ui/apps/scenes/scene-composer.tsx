/**
 * The scene's composer: the draft, in its own component, so a keystroke calls
 * this component's own `setDraft`, never ScenePage's, and no Bubble re-renders while typing. `onSend`
 * says whether the message went through; the draft clears only then. ArrowUp in an empty draft asks
 * the page to edit the user's last message (RoleCall's useChatKeyboardShortcuts). The unsent draft is
 * kept per scene in the app prefs (RoleCall's useDraftPersistence): saved a second after typing stops
 * and when the scene closes, read back when it opens, emptied when the message goes.
 *
 * Steering (a guided re-roll, RoleCall's steeringMode): the box becomes the instruction for a new version
 * of the last reply. It has its own text, so the unsent draft is kept as it was; Send (a re-roll icon)
 * takes the text, empty meaning a plain re-roll; Esc or Cancel leaves.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { Button, IconButton } from "../../components/button";
import { Ic } from "../../_shared/ic";
import type { AppContext } from "../../app-contract";
import { useDebouncedSave } from "../../_shared/use-debounced-value";
import { isEscapeClose } from "../../_shared/use-escape-key";
import { draftKey, readDraft } from "./composer-tools-core";
import type { ScenesApi } from "../../app-contract-scenes";
import { useComposerGrow } from "./composer-grow";
import { ComposerTools, type ComposerToolsProps } from "./scene-composer-tools";
import { DraftStatusStrip } from "./scene-draft-status";
import { useComposerDrafts } from "./use-composer-drafts";
import { insertAtCaret, publishDraft, registerDraftReplacer, registerInserter } from "./context/draft-bus";
import type { Steering } from "./use-scene-composer";

export function SceneComposer({ api, chatId, prefs, persona, expandTick, name, connected, busy, showAiHint, tools, steering, onSteer, onCancelSteer, onStop, onOpenAiWing, onSend, onEditLast }: {
  api: Pick<ScenesApi, "runSceneDraft">;
  chatId: string;
  prefs: AppContext["prefs"];
  /** The player's name, for the draft tools' ribbon. */
  persona: string;
  /** Counts up each time the message menu asks for expand mode. */
  expandTick: number;
  name: string;
  connected: boolean;
  busy: boolean;
  showAiHint: boolean;
  tools: Omit<ComposerToolsProps, "onExpand">;
  steering: Steering | null;
  onSteer(text: string): void;
  onCancelSteer(): void;
  onStop(): void;
  onOpenAiWing(): void;
  onSend(content: string): Promise<boolean>;
  onEditLast(): boolean;
}): JSX.Element {
  const key = draftKey(chatId);
  const [draft, setDraft] = useState(() => readDraft(prefs.get(key)));
  /** Only a changed draft is written: a save that changes nothing would still rewrite the settings file. */
  const keep = useDebouncedSave<string>((text) => { if (readDraft(prefs.get(key)) !== text) prefs.set(key, text); }, 1000);
  const edit = (text: string): void => { setDraft(text); keep.push(text); publishDraft(chatId, text); };
  const replace = (text: string): void => { keep.cancel(); setDraft(text); publishDraft(chatId, text); prefs.set(key, text); keep.push(text); };
  const drafts = useComposerDrafts({ api, chatId, text: draft, setText: edit });
  const [steerText, setSteerText] = useState("");
  const [seen, setSeen] = useState(steering);
  // Steering begins afresh each time it is asked for: the box starts with the version's old instruction, or empty.
  if (seen !== steering) { setSeen(steering); setSteerText(steering?.initial ?? ""); }
  const field = useRef<HTMLTextAreaElement>(null);
  useComposerGrow(field, steering ? steerText : draft);
  useEffect(() => { if (steering) field.current?.focus(); }, [steering]);
  // Ping and suggested actions put text in the draft at the caret; a steering box is not the draft, so it declines.
  const now = useRef({ draft, steering, edit, replace });
  now.current = { draft, steering, edit, replace };
  useEffect(() => registerInserter(chatId, (piece) => {
    const cur = now.current;
    if (cur.steering) return false;
    const el = field.current;
    const caret = el && document.activeElement === el ? { from: el.selectionStart, to: el.selectionEnd } : { from: cur.draft.length, to: cur.draft.length };
    const next = insertAtCaret(cur.draft, piece, caret.from, caret.to);
    cur.edit(next.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.caret, next.caret); });
    return true;
  }), [chatId]);
  useEffect(() => registerDraftReplacer(chatId, (text) => {
    if (now.current.steering) return false;
    now.current.replace(text);
    return true;
  }), [chatId]);
  // The message menu's Expand as character: the pill strip opens over the box, which takes the outline.
  useEffect(() => { if (expandTick > 0) { drafts.beginExpand(); field.current?.focus(); } }, [expandTick]); // eslint-disable-line react-hooks/exhaustive-deps -- fires on the request alone
  const menu: ComposerToolsProps = {
    ...tools,
    onPick: (id) => { if (id === "polish") { tools.onToggle(); drafts.polish(); } else tools.onPick(id); },
    onExpand: (perspective) => { tools.onToggle(); drafts.expand(perspective); },
  };
  /** A second Enter or click while one send is in flight is dropped, not queued. */
  const sending = useRef(false);
  const submit = async (): Promise<void> => {
    if (steering) { if (!busy) onSteer(steerText.trim()); return; }
    if (busy || sending.current || draft.trim() === "") return;
    sending.current = true;
    try {
      if (await onSend(draft)) { keep.cancel(); setDraft(""); prefs.set(key, ""); publishDraft(chatId, ""); }
    } finally {
      sending.current = false;
    }
  };
  const label = `${name}'s last reply`;
  return (
    <div className="dockbar" data-part="scene.composer">
      <DraftStatusStrip drafts={drafts} persona={persona} />
      {steering && (
        <div className="steer" data-part="scene.composer.steering" role="status">
          <b>Steering {label}</b>
          <span>Your next send becomes the regen instruction. Empty = re-roll without instruction.</span>
          <Button variant="quiet" size="sm" icon="lucide:x" onClick={onCancelSteer}>Cancel</Button>
        </div>
      )}
      <form className={`cap${connected ? "" : " off"}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <ComposerTools {...menu} />
        <textarea ref={field} rows={1} value={steering ? steerText : draft} aria-label="Message"
          placeholder={steering ? "Tell the AI how to retake the message, or hit send with no text to re-roll without instruction…" : connected ? `Message ${name}...` : "Pick a connection to start the scene."}
          onChange={(e) => (steering ? setSteerText(e.target.value) : edit(e.target.value))}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (steering && isEscapeClose(e.nativeEvent)) { e.preventDefault(); onCancelSteer(); }
            else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
            else if (e.key === "ArrowUp" && draft === "" && !steering && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && onEditLast()) e.preventDefault();
          }} />
        {showAiHint && <Button variant="quiet" size="sm" onClick={onOpenAiWing}>Open AI wing</Button>}
        {busy
          ? <IconButton variant="danger" size="sm" label="Stop" icon={<Ic name="lucide:square" fill />} onClick={onStop} />
          : steering
            ? <IconButton variant="primary" size="sm" type="submit" label="Regenerate" title="Regenerate (ESC to cancel)" icon="lucide:rotate-ccw" disabled={!connected} />
            : <IconButton variant="primary" size="sm" type="submit" label="Send" icon="lucide:send" disabled={!connected || draft.trim() === ""} />}
      </form>
    </div>
  );
}
