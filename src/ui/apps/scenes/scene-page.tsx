/**
 * The scene page: RoleCall's StandardLayout (approved wireframe rc-port/chat.html). The header with
 * the take pill (Scene Takes) and, when the Library holds a newer card, the Update available badge;
 * the opening-message picker until the first send; the messages as RoleCall shows them (the full
 * macro engine against the scene's frozen cast, ADR-012 amendment), with Edit, Copy, Branch from
 * here, and the delete menu, and a restore line where a cut was; the composer; and the wings. Sending
 * asks the scene's connection for a reply (approved wireframe rc-port/scene-turn.html): Starting, the reply
 * streaming in, Stop, Regenerate and the SwipeCounter on the last reply, the arrow keys, RoleCall's failure card,
 * and Bunzai's cut-off line and "scene changed" card. With no connection the capsule points at the AI wing (model
 * picker); Prompting holds the preset, World the lorebooks, Props the registered Props switch (ChatStore rule 21),
 * and a prop that is on may draw on the stage itself. Seven surfaces take a theme's variant (scene.layout, .message,
 * .composer, .swipes, .wings, .hud, .reasoning): CSS in ./variants for all of them, markup only in the readout and the reasoning blocks.
 *
 * PERF: the composer's draft lives in its own component
 * (SceneComposer) so a keystroke never touches ScenePage state. Every Bubble action prop is one of
 * the `dispatch*` functions below - defined once with `useCallback(..., [])`, so their identity never
 * changes - which read the page's current scene/editing/peek/busy through `liveRef` instead of
 * closing over render-scoped values. That, plus Bubble/Prose being memoized (scene-bubble.tsx,
 * prose.tsx) and `charArt`/`userArt` being memoized elements instead of a function called per row,
 * is what lets a finished bubble skip re-rendering while the composer is typed into or a reply
 * streams into its own LiveBubble (scene-turn-parts.tsx).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { ThemeSlot } from "../../_shared/theme-slot";
import type { AppContext } from "../../app-contract";
import { copyText } from "../../_shared/clipboard";
import { Ic } from "../../_shared/ic";
import { useSurfaceVariant } from "../../_shared/surface-variant";
import { useDismissHoldMenus } from "./use-dismiss-hold-menus";
import { toErrorMessage } from "../../_shared/error-message";
import { trashScene } from "./trash-scene";
import { chatDisplay } from "../../../core/chat-display";
import { bodyOf, isRecord, str } from "../../../core/guards";
import type { Message } from "../../../stage/contracts/chat-store";
import { greetingsOf, type OpenScene, type SceneAction, type TakeSummary } from "../../../studio/scenes";
import { Bubble } from "./scene-bubble";
import { SceneHud } from "./scene-hud";
import { isNewer, UpdateBadge, UpdateCardDialog, type CardState } from "./scene-card";
import { CutFromDialog, CutLine, type CutScope } from "./scene-cuts";
import { ZoomArt } from "./scene-portrait-zoom";
import { CHAR_TONE, USER_TONE, useSceneAccents } from "./scene-accents";
import { DeleteTakeDialog, ForkDialog, TakesControl } from "./scene-takes";
import { WingPanel, WingRails } from "./scene-wings";
import { wingOf, propWings } from "./scene-wing-data";
import { WingSlot } from "./scene-wing-frame";
import { useWingShell } from "./use-wing-shell";
import { SwapLine } from "./cast/swap-line";
import { useUserArt } from "./cast/use-user-art";
import { BackdropLayer } from "./scene-backdrop-layer";
import { characterBackdrop } from "./scene-backdrop-core";
import { SamplerHistoryContext } from "./sampler-history";
import { useSceneReasoning } from "./scene-reasoning";
import { reasoningOf } from "./scene-reasoning-core";
import { sceneStageProps } from "./props/prop-contract";
import { useRegisteredProps } from "./scene-prop-wing";
import { WING_POPOUTS } from "./popout/kinds";
import { popoutKindsFor } from "./popout/popout-core";
import { PopoutHost, PopoutSlot } from "./popout/popout-host";
import { useSceneProps } from "./props/use-scene-props";
import { useDialogueSpeakers } from "./participants/use-dialogue-speakers";
import type { PresetBody } from "../../../entities/preset/schema";
import type { SceneLoreBook } from "../../app-contract-scenes";
import { canAskAgain } from "./ask-again";
import { useSceneRetake } from "./use-scene-retake";
import { useSceneComposer } from "./use-scene-composer";
import { PromptInspector } from "./scene-inspector";
import { SceneComposer } from "./scene-composer";
import { useEscapeKey } from "../../_shared/use-escape-key";
import { CutOff, FailCard, TurnStatus, HeldCard, LiveBubble, Starting } from "./scene-turn-parts";
import { useSceneFinalCut } from "./use-scene-final-cut";
import { SHOW_TIMESTAMPS_KEY, replyFacts, showTimestamps } from "./scene-meta-core";
import { lookRoot, readLook } from "./stage-look-core";
import { useStageSignals } from "./use-stage-signals";
import { useDisplayContext, useStampOf } from "./scene-display-context";
import { useSceneTurn } from "./use-scene-turn";
import { useTrackersHeard } from "./use-trackers-heard";
import { useSceneOlderPage } from "./use-scene-older-page";
import { useSceneMacroMessages } from "./use-scene-macro-messages";
import { useSceneRegex } from "./use-scene-regex";
import { useSceneHistory } from "./use-scene-history";
import { useVersionRemove } from "./use-version-remove";
import { Toast } from "../../_shared/toast";
import { useGreetingDraft } from "./use-greeting-draft";
import { GreetingPicker } from "./scene-greeting-picker";
import { pageRows, type Dialog, type LiveScenePage, type Row } from "./scene-page-types";
import { currentIndex, selectedSwipe, swipeCount, useSceneSwipePreview } from "./use-scene-swipe-preview";
import { SceneCompare } from "./scene-compare";
import { useSceneFind } from "./use-scene-find";
import { useScenePageLoad } from "./use-scene-page-load";
import { chatLayoutOf } from "./chat-layout";
import { Messenger } from "./messenger/messenger";
import { useScenePrograms } from "./messenger/programs";
import { useMessengerOpen } from "./messenger/use-messenger-open";
import { usePublishSceneSignals } from "./scene-signals";
import { wingPanels } from "./messenger/wing-props";
import { authorOf, useReplyNotes, useTranscriptDecor } from "./messenger/transcript/use-transcript-decor";
import { Button, IconButton, Tile } from "../../components/button";
const stale = (e: unknown): boolean => /\bversion\b|409/i.test(toErrorMessage(e));
export function ScenePage({ ctx, chatId, navigationTicketId = null, loadId = null, onBack, onTree }: { ctx: AppContext; chatId: string; navigationTicketId?: string | null; loadId?: string | null; onBack(): void; /** Opens the Branching Tree (RoleCall's "View Full Branching Tree"). */ onTree?(chatId: string): void }): JSX.Element {
  const { api, setStatus } = ctx;
  const extensionApi = ctx.api.extensions;
  const [scene, setScene] = useState<OpenScene | null>(null);
  const [problem, setProblem] = useState<{ message: string; castGone: boolean } | null>(null);
  const [greeting, setGreeting] = useState(0);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [wing, setWing] = useState<string | null>(null);
  const { list: registeredProps, wings: propWingCatalog } = useRegisteredProps();
  const { root, widthOf, resizeOf } = useWingShell(ctx.prefs, wing, setWing, propWingCatalog);
  const messenger = chatLayoutOf(ctx.prefs) === "messenger";
  const { msnRequest, msnOpen, setMsnOpen, openWing, away, stageRequest } = useMessengerOpen(messenger, wing, setWing);
  const [, setPrefTick] = useState(0); // the app prefs are not reactive: a display switch re-renders the page by hand
  const [presetBody, setPresetBody] = useState<PresetBody | null>(null);
  const reasoning = useSceneReasoning(ctx.api, scene?.chat.preset, scene?.chat.prompting);
  const [loreBooks, setLoreBooks] = useState<SceneLoreBook[] | null>(null);
  const propsState = useSceneProps(ctx, chatId);
  const propsOn = propsState.load.state === "ready" ? propsState.load.on : null;
  const speakers = useDialogueSpeakers(ctx, scene, propsOn);
  const programs = useScenePrograms(messenger, scene ?? undefined, propsOn, registeredProps, ctx.prefs, ctx.pieces);
  const [menu, setMenu] = useState<{ id: string; which: "more" | "delete" | "history" } | null>(null);
  const [takesOpen, setTakesOpen] = useState(false);   const hud = useSurfaceVariant("scene.hud");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  /** One scene change at a time: a second click while one runs is dropped, not sent (it would only 409). */
  const acting = useRef(false);
  /** Every Bubble action dispatcher reads this instead of closing over render-scoped state (see the
   * file header). Assigned every render, once all its fields are known, below. */
  const liveRef = useRef<LiveScenePage>(null as unknown as LiveScenePage);
  const [macroMessages, setMacroMessages] = useState<Map<number, { role: Message["role"]; content: string }>>(() => new Map());
  const following = useRef(true);
  const { generation: loadGeneration, load } = useScenePageLoad({ api, chatId, navigationTicketId, loadId, notifySceneOpened: extensionApi?.notifySceneOpened, onBack, setStatus, setScene, setProblem, setMacroMessages, following });
  useEffect(load, [load]);
  const replyFrom = useRef<{ characterId: string; name: string } | null>(null);
  const turn = useSceneTurn(ctx, chatId, load, replyFrom);
  useTrackersHeard(ctx.pieces, chatId, load);
  const busy = turn.live !== null;
  usePublishSceneSignals(chatId, scene?.branchVersion, busy);
  /** A version looked at while one is being written, or after it landed: local, never saved. */
  const scroller = useRef<HTMLDivElement | null>(null);
  const liveText = turn.live?.text;
  const messageCount = scene?.messageCount ?? 0;
  const displayContext = useDisplayContext(scene);
  const look = readLook(ctx.prefs);
  useStageSignals({ look, scroller, following, sceneKey: scene ? `${scene.chat.id}:${scene.chat.activeBranchId}` : undefined, messageCount, liveText, busy });
  const { loadOlder, loadingOlder } = useSceneOlderPage({ api, chatId, scene, setScene, generation: loadGeneration, scroller, load, setStatus });
  const menuOpen = takesOpen || menu !== null;
  const closeMenus = useCallback((): void => {
    setTakesOpen(false);
    setMenu(null);
  }, []);
  useDismissHoldMenus(menuOpen, closeMenus);
  const history = useSceneHistory({ api, scene, busy, load, setStatus, setMenu });
  const versions = useVersionRemove({ api, scene, busy, load, setStatus, setMenu });
  // Esc stops a running reply unless a menu, wing, dialog or editor is open: those spend the press first.
  useEscapeKey(turn.stop, busy && !menuOpen && !away && !dialog && !editing);
  const identity = isRecord(bodyOf(scene?.snapshot.character)["identity"]) ? (bodyOf(scene?.snapshot.character)["identity"] as Record<string, unknown>) : {};
  const personaName = str(bodyOf(scene?.snapshot.persona)["name"]);
  const greetings = useMemo(() => (scene ? greetingsOf(scene.snapshot.character) : []), [scene]);
  const cardBackdrop = useMemo(() => characterBackdrop(scene?.snapshot.character), [scene?.snapshot.character]);
  const unsent = scene !== null && scene.messages.length === 0;
  const greetingDraft = useGreetingDraft(greetings, greeting, scene?.chat.opening, (opening) => void act("opening", { opening }));
  const name = str(identity["name"]) || "Character";
  replyFrom.current = scene ? { characterId: scene.chat.cast.character.id, name } : null;
  const find = useSceneFind({ api, chatId, scene, scroller, busy, loadThrough: (seq) => loadOlder(seq), setStatus, names: { character: name, persona: personaName || "You" } });
  const card: CardState | null = scene && {
    name,
    version: scene.chat.cast.character.version,
    latest: scene.latestCardVersion,
    previous: scene.chat.previousCast?.character.version ?? null,
  };
  /** Runs one scene change and shows what it answers; a stale write reloads instead. */
  const act = async (action: SceneAction, input: Record<string, unknown>): Promise<void> => {
    setMenu(null);
    setDialog(null);
    setTakesOpen(false);
    if (acting.current) return;
    acting.current = true;
    const generation = ++loadGeneration.current;
    setMacroMessages(new Map());
    try {
      const next = await api.editScene(action, { chatId, ...input });
      if (generation === loadGeneration.current) {
        loadGeneration.current++;
        setMacroMessages(new Map());
        following.current = true;
        setScene(next);
      }
    } catch (e) {
      setStatus(stale(e) ? "the scene changed in another window; it has been reloaded" : `could not change the scene: ${toErrorMessage(e)}`);
      load();
    } finally {
      acting.current = false;
    }
  };
  const versioned = (input: Record<string, unknown>) => ({ ...input, expectedVersion: scene?.branchVersion });
  const tagline = str(identity["tagline"]);
  const rows = useMemo(() => pageRows(scene), [scene]);
  const connected = scene?.chat.connection !== undefined;
  // The take's last reply, when the take ends with one past the greeting: only it regenerates (turn-loop rule 5).
  const lastRow = [...rows].reverse().find((r): r is Extract<Row, { kind: "msg" }> => r.kind === "msg");
  const lastReply = lastRow && lastRow.m.role === "assistant" && lastRow.n > 1 ? lastRow.m : null;
  const continueReply = lastRow && lastRow.m.role === "assistant" ? lastRow.m : null;
  const reroll = (guidance?: string): void => {
    if (!scene || !lastReply || busy) return;
    turn.seen();
    void turn.start("swipe", scene.branchVersion, lastReply.id, null, guidance);
  };
  const regenerate = (): void => reroll();
  const askable = canAskAgain({ lastRole: lastRow?.m.role ?? null, busy, connected, held: turn.held !== null });
  const { peek, peekedSwipe, browse, clear: clearSwipePreview } = useSceneSwipePreview({
    api, chatId, scene, generation: loadGeneration, busy,
    liveSwipe: turn.live?.kind === "swipe" && turn.live.messageId ? { messageId: turn.live.messageId } : null,
    lastReply, wing: away ? "messenger" : null, dialog, editing,
    select: (message, index) => { void act("select-swipe", versioned({ messageId: message.id, index })); },
    seen: () => turn.seen(), regenerate, load, setStatus,
  });
  const { retakeAt, dispatchRetake, retakeFrom } = useSceneRetake({ api, chatId, scene, rows, connected, busy, turn, acting, loadGeneration, following, setScene, setDialog, setStatus, load, isStale: stale, clearSwipePreview, closeMenus: () => setMenu(null), clearMacros: () => setMacroMessages(new Map()) });
  const finalCut = useSceneFinalCut({ api, scene, reload: load });
  const { expandTick, beginExpand, correct, correctModal, continuable, continueLast, askAgain, editLast, tools, steering, startGuided, steer, cancelSteer } = useSceneComposer({ api, prefs: ctx.prefs, reload: load, scene, rows, lastRow, lastReply, continueReply, connected, busy, peeking: peek !== null, blocked: menuOpen || away || dialog !== null || editing !== null, turn, reroll, editing: editing !== null, setEditing, setStatus });
  // Every showing runs the full engine with its captured seed, against the frozen cast (ADR-012).
  const shown = useMemo(() => {
    if (!scene) return { greeting: "", byId: new Map<string, string>(), peek: null, missing: [] as number[], show: undefined as ((text: string, index: number) => string) | undefined };
    const live = scene.messages.filter((m) => !m.cut).map((m, i) => ({ id: m.id, role: m.role, content: selectedSwipe(m)?.content ?? "", index: scene.messageOffset + i }));
    const missing = new Set<number>();
    const show = chatDisplay({
      character: scene.snapshot.character,
      persona: scene.snapshot.persona,
      messages: live.map(({ role, content }) => ({ role, content })),
      messageCount: scene.messageCount,
      messageIndices: live.map((m) => m.index),
      messageLookup: new Map([...macroMessages].map(([index, m]) => [index, { role: m.role, content: m.content }])),
      missingMessageIndices: missing,
      userMessageCount: scene.userMessageCount,
      assistantMessageCount: scene.assistantMessageCount,
      ...(scene.lastUserMessageIndex === null ? {} : { lastUserMessageIndex: scene.lastUserMessageIndex }),
      ...(scene.lastAssistantMessageIndex === null ? {} : { lastAssistantMessageIndex: scene.lastAssistantMessageIndex }),
      reasoning, randomSeed: displayContext.randomSeed, now: displayContext.now,
    });
    return {
      greeting: unsent ? show(greetingDraft.raw, -1) : "",
      byId: new Map(live.map((m) => [m.id, show(m.content, m.index)])),
      peek: peekedSwipe ? show(peekedSwipe.content, live.find((m) => m.id === peekedSwipe.id)?.index ?? -1) : null,
      missing: [...missing].sort((a, b) => a - b), show,
    };
  }, [scene, greetingDraft.raw, unsent, macroMessages, peekedSwipe, displayContext, reasoning]);
  const { resolving: resolvingMacros, failed: macroLoadFailed, retry: retryMacros } = useSceneMacroMessages({ api, chatId, scene, generation: loadGeneration, indices: shown.missing, messages: macroMessages, setMessages: setMacroMessages, load, setStatus });
  const regexed = useSceneRegex(ctx, scene, shown.byId, (text, index) => shown.show?.(text, index) ?? text);
  // Retry after a failure: ask again for the same message (a reply to the last one, or another version
  // of the last reply). Offered only when the take still ends where the failed turn left it.
  // Only while the take still ends at the very message the failed turn was for: a cut, restore, or
  // take switch since then takes Retry away rather than aiming it at a different message.
  const failed = turn.held?.kind === "failed" ? turn.held : null;
  const retry = scene && !busy && failed && failed.code !== "invalid_preset" && failed.code !== "nothing_to_add" && failed.anchor !== null && lastRow?.m.id === failed.anchor
    && (failed.turn === "reply" ? lastRow.m.role === "user" : lastReply?.id === failed.anchor)
    ? () => (failed.turn === "reply" ? void turn.start("reply", scene.branchVersion, null, lastRow.m.id) : failed.turn === "continue" ? void turn.start("continue", scene.branchVersion, failed.anchor) : reroll(failed.guidance))
    : null;
  /** SceneComposer owns the draft and its own submit guard; this only runs the send itself and says
   * whether it went through, so the composer knows whether to clear what it holds. */
  const sendMessage = async (content: string): Promise<boolean> => {
    if (!scene || !connected || busy || content.trim() === "") return false;
    try {
      const sent = await api.sendToScene({ chatId, content, greetingIndex: greeting, expectedVersion: scene.branchVersion });
      loadGeneration.current++;
      setMacroMessages(new Map());
      clearSwipePreview();
      setScene(sent);
      following.current = true;
      void turn.start("reply", sent.branchVersion, null, sent.messages.at(-1)?.id ?? null);
      return true;
    } catch (e) {
      setStatus(stale(e) ? "the scene changed in another window; it has been reloaded" : `could not send: ${toErrorMessage(e)}`);
      load();
      return false;
    }
  };
  const saveEdit = async (m: Message): Promise<void> => {
    const swipe = selectedSwipe(m);
    const text = editing?.text ?? "";
    setEditing(null);
    if (!scene || !swipe || text === swipe.content) return;
    try {
      await api.editSceneMessage({ messageId: m.id, swipeId: swipe.id, content: text, expectedVersion: scene.branchVersion });
    } catch (e) {
      setStatus(stale(e) ? "the scene changed in another window; it has been reloaded" : `could not save the edit: ${toErrorMessage(e)}`);
    }
    load();
  };
  const cut = (m: Message, scope: "one" | "from", skipConfirm: boolean): void => {
    if (scope === "from" && !skipConfirm) {
      setMenu(null);
      setDialog({ kind: "cut-from", m });
    } else void act("cut", versioned({ messageId: m.id, scope }));
  };
  const branch = (m: Message, n: number, skipDialog: boolean): void => {
    if (skipDialog) void act("fork", versioned({ messageId: m.id }));
    else {
      setMenu(null);
      setDialog({ kind: "fork", m, n });
    }
  };
  liveRef.current = { scene, rows, browse, saveEdit, cut, branch, hide: (m) => void act("hide", versioned({ messageId: m.id, hidden: !m.hidden })), regenerate, askAgain, continueLast, editLast, startGuided, sendMessage };
  /** A message by id, for the id-parameterized Bubble dispatchers below: Bubble never holds `Message`. */
  const findMsg = useCallback((id: string): Message | undefined => liveRef.current.scene?.messages.find((x) => x.id === id), []);
  const readHistory = history.read;
  const dispatchMenu = useCallback((id: string, which: "more" | "delete" | "history" | null) => {
    setMenu(which ? { id, which } : null);
    if (which === "more") readHistory(id);
  }, [readHistory]);
  const dispatchEdit = useCallback((id: string) => {
    const m = findMsg(id);
    if (m) setEditing({ id, text: selectedSwipe(m)?.content ?? "" });
  }, [findMsg]);
  const dispatchEditChange = useCallback((id: string, text: string) => setEditing({ id, text }), []);
  const dispatchEditSave = useCallback((id: string) => {
    const m = findMsg(id);
    if (m) void liveRef.current.saveEdit(m);
  }, [findMsg]);
  const dispatchEditCancel = useCallback(() => setEditing(null), []); const dispatchCopy = useCallback((text: string) => copyText(text), []);
  const dispatchBranch = useCallback((id: string, skip: boolean) => {
    const m = findMsg(id);
    const row = liveRef.current.rows.find((r): r is Extract<Row, { kind: "msg" }> => r.kind === "msg" && r.m.id === id);
    if (m && row) liveRef.current.branch(m, row.n, skip);
  }, [findMsg]);
  const dispatchCut = useCallback((id: string, scope: CutScope, skip: boolean) => {
    const m = findMsg(id);
    if (m) liveRef.current.cut(m, scope, skip);
  }, [findMsg]);
  const dispatchHide = useCallback((id: string) => { const m = findMsg(id); if (m) liveRef.current.hide(m); }, [findMsg]);
  const dispatchVersion = useCallback((id: string, index: number) => { const m = findMsg(id); if (m) liveRef.current.browse(m, index); }, [findMsg]);
  const dispatchCompare = useCallback((id: string) => setDialog({ kind: "compare", id }), []);
  const dispatchRegenerate = useCallback(() => liveRef.current.regenerate(), []);
  const dispatchAskAgain = useCallback(() => liveRef.current.askAgain(), []);
  const dispatchContinue = useCallback(() => liveRef.current.continueLast(), []);
  const dispatchEditLast = useCallback(() => liveRef.current.editLast(), []);
  const dispatchGuided = useCallback((id: string, previous?: string) => liveRef.current.startGuided(id, previous), []);
  const dispatchSend = useCallback((content: string) => liveRef.current.sendMessage(content), []);
  // Memoized elements, not a function called per row: calling a function to
  // build an element makes a fresh object every time, which alone would defeat Bubble's memo no
  // matter how stable its other props are. Above the early return below: hooks run unconditionally.
  const timestamps = showTimestamps(ctx.prefs.get(SHOW_TIMESTAMPS_KEY)); const stampOf = useStampOf(displayContext);
  const userInitial = (personaName || "You").charAt(0).toUpperCase(); const accents = useSceneAccents(scene, ctx.prefs); const userArtFor = useUserArt();
  const decor = useTranscriptDecor({ on: messenger, rows, prefs: ctx.prefs, chatId, personaName, characterName: name, shown: shown.byId, regexed });
  const notes = useReplyNotes({ ctx, chatId, chat: scene?.chat, committed: turn.committed, rows, on: messenger, onInspect: () => openWing("context") });
  const charArt = useMemo<JSX.Element>(
    () => (
      <div className="por">
        {scene ? <ZoomArt ctx={ctx} chatId={chatId} characterId={scene.chat.cast.character.id} snapshotVersion={scene.chat.snapshotVersion} hasArt={scene.hasPortrait} name={name} /> : <span className="ini">{userInitial}</span>}
      </div>
    ),
    [scene, ctx, chatId, name, userInitial],
  );
  if (problem) return (
    <div className="scs"><div className="quiet" role="alert"><div><b>This scene could not open</b><p>{problem.message}</p><div className="qacts">
      {problem.castGone ? <Button variant="danger" onClick={() => trashScene(ctx, chatId, onBack)}>Move to Trash</Button> : <Button variant="primary" onClick={load}>Try again</Button>}<Button variant="quiet" onClick={onBack}>Back to Scenes</Button>
    </div></div></div></div>
  );
  const side = wingOf(wing, propWingCatalog)?.side; const replaceScene = (next: OpenScene): void => { loadGeneration.current++; setMacroMessages(new Map()); setScene(next); };
  const takeName = scene?.takes.find((t) => t.id === scene.chat.activeBranchId);
  const painted = lookRoot(look);
  const switchTake = (id: string): void => void act("take", { branchId: id });
  const takes = scene && <TakesControl open={takesOpen} onToggle={() => setTakesOpen(!takesOpen)} takes={scene.takes} activeId={scene.chat.activeBranchId} onTree={onTree && (() => onTree(chatId))}
      onSwitch={switchTake} onRename={(id, n) => void act("rename-take", { branchId: id, name: n })}
      onDelete={(take, skip) => { setTakesOpen(false); if (skip) void act("delete-take", { branchId: take.id }); else setDialog({ kind: "delete-take", take }); }} />;
  const update = card && isNewer(card) && <UpdateBadge onClick={() => setDialog({ kind: "card" })} />;
  const wingArgs = scene && { ctx, scene, busy, card, name, charArt, cardPinned: cardBackdrop !== null, presetBody, setPresetBody, loreBooks, setLoreBooks, registeredProps, propsState, propsOn, stageRequest, setScene, replaceScene,
    repaint: () => setPrefTick((n) => n + 1), onUpdate: () => setDialog({ kind: "card" }), onRevert: () => card && void act("revert-card", { fromVersion: card.version }), openWing, greeting: { index: greeting, pick: setGreeting } };
  /** One wing's panel: in its slot beside the chat (Full Chat), or bare as a Messenger program opened on `tab`. */
  const wingBody = (id: string, tab?: string, bare = false): JSX.Element => (
    <SamplerHistoryContext.Provider value={scene ? { messages: scene.messages, total: scene.messageCount } : undefined}>
      <WingPanel id={id} {...(tab ? { tab } : {})} {...(bare ? { bare, single: true } : { resize: resizeOf(id) })} {...(wingArgs ? wingPanels(wingArgs, tab, bare) : {})} {...(scene ? { propWing: { list: registeredProps, on: propsOn, failed: propsState.load.state === "failed", host: { ctx, chat: scene.chat, onChat: (chat) => setScene((s) => s ? { ...s, chat } : s) } } } : {})} />
    </SamplerHistoryContext.Provider>
  );
  const chat = (
        <div className="chat">
        {find.overlay}
        <div className="scroll" data-part="scene.messages" ref={scroller} onScroll={(e) => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160; if (el.scrollTop < 80) void loadOlder(); }}>
          {resolvingMacros && <p className="help" role="status">Resolving scene macros...</p>}
          {macroLoadFailed && <p className="help" role="status">Scene macros could not load. <Button variant="quiet" size="sm" onClick={retryMacros}>Retry</Button></p>}
          {scene?.hasMore && (
            <div className="older"><Button variant="quiet" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading older messages…" : "Load older messages"}
            </Button></div>
          )}
          {unsent && greetings.length > 0 && <GreetingPicker count={greetings.length} index={greeting} onPick={setGreeting} />}
          {unsent && shown.greeting && <Bubble id="greeting" n={1} who={name} tone={CHAR_TONE} art={charArt} text={shown.greeting}
            editing={greetingDraft.editing} onEdit={greetingDraft.start} onEditChange={greetingDraft.change} onEditSave={greetingDraft.save} onEditCancel={greetingDraft.cancel} onCopy={dispatchCopy} />}
          {rows.map((row) => {
            if (row.kind === "swap") return <SwapLine key={`swap-${row.id}`} name={row.name} />; // rule 26: each user line keeps its own persona
            if (row.kind === "cut") return <CutLine key={row.id} count={row.count} onRestore={() => void act("restore-cut", versioned({ cutId: row.id }))} />;
            const { m, n } = row;
            const user = m.role === "user";
            const author = authorOf(m, personaName, name); const deco = decor.get(m.id);
            const isLast = m === lastReply;
            const writing = isLast && turn.live?.kind === "swipe" && turn.live.messageId === m.id;
            const continuing = m === continueReply && turn.live?.kind === "continue" && turn.live.messageId === m.id;
            const count = swipeCount(m) + (writing ? 1 : 0);
            const index = peek?.id === m.id ? peek.index : writing ? count - 1 : currentIndex(m);
            const onLive = writing && index === count - 1;
            const isPeek = peek?.id === m.id && peek.index === index && index !== currentIndex(m);
            const swipe = isPeek ? peekedSwipe?.id === m.id && peekedSwipe.index === index ? peekedSwipe : undefined : selectedSwipe(m);
            const gen = swipe?.generation;
            const think = reasoningOf({ key: onLive ? `turn:${turn.live?.turnId}` : (swipe?.id ?? m.id), content: swipe?.content, gen, format: reasoning, showPrefill: scene?.chat.prompting?.showPrefill === true, live: onLive ? (turn.live ?? null) : null, prefs: ctx.prefs });
            const raw = onLive ? think.reply : (swipe?.content ?? (isPeek ? "Loading swipe..." : ""));
            const whole = onLive ? raw : shown.missing.length ? raw : isPeek ? shown.peek ?? raw : regexed.get(m.id) ?? shown.byId.get(m.id) ?? raw;
            const text = continuing ? whole + (turn.live?.text ?? "") : whole;
            const footer = notes.foot(m.id, gen, !user && !onLive && !isPeek, isLast && gen?.finishReason === "interrupted" && !writing ? <CutOff busy={busy} onRegenerate={regenerate} /> : null);
            // The meta row: a reply with several versions browses them wherever it sits; only the last reply regenerates.
            const showVersions = m.role === "assistant" && n > 1 && (isLast || count > 1);
            const stamp = !onLive && timestamps && swipe ? stampOf(swipe.createdAt) : undefined;
            const facts = replyFacts(gen, !onLive && !user);
            return (<Fragment key={m.id}>{deco?.lead}
              <Bubble key={m.id} id={m.id} n={n} user={user} who={author} tone={user ? USER_TONE : CHAR_TONE}
                live={onLive || continuing} {...think.props} last={isLast} footer={footer} stamp={stamp} {...facts}
                {...(showVersions ? { vIndex: index, vCount: count, vNew: isLast && turn.landed === m.id && peek?.id === m.id, vBusy: busy, onVersion: dispatchVersion } : {})} {...(isLast ? { busy, onRegenerate: dispatchRegenerate } : {})} {...(showVersions && swipeCount(m) > 1 ? { onCompare: dispatchCompare } : {})} {...(m === continueReply && continuable ? { onContinue: dispatchContinue } : {})} {...(askable && m === lastRow?.m ? { onAskAgain: dispatchAskAgain } : {})} {...(!user && n > 1 ? { onGuided: dispatchGuided, guidance: gen?.guidance } : {})} {...(!user ? { onExpand: beginExpand } : {})} onCorrect={correct} {...(!user && gen?.finalCut ? { finalCut: gen.finalCut, onFinalCut: finalCut.open } : {})}
                art={user ? userArtFor(author.charAt(0).toUpperCase()) : charArt} text={text} {...(regexed.has(m.id) && !onLive ? { copyText: shown.byId.get(m.id) ?? raw } : {})} editing={editing?.id === m.id ? editing.text : undefined}
                menu={menu?.id === m.id ? menu.which : null} onMenu={dispatchMenu}
                {...history.bubble(m.id, menu?.id === m.id ? menu.which : null)}
                onEdit={dispatchEdit} onEditChange={dispatchEditChange}
                onEditSave={dispatchEditSave} onEditCancel={dispatchEditCancel} onCopy={dispatchCopy}
                {...(n > 1 ? { onBranch: dispatchBranch } : {})} {...(connected && retakeAt.has(m.id) ? { onRetake: dispatchRetake } : {})}
                onCut={dispatchCut} onHide={dispatchHide} hidden={m.hidden === true} speakers={user ? undefined : speakers} {...(!user && n > 1 ? { onRemoveVersion: versions.remove } : {})} contextMenu={messenger} {...deco?.props} /></Fragment>
            );
          })}
          {turn.live?.kind === "reply" && (turn.live.text || turn.live.reasoning
            ? <LiveBubble n={rows.filter((r) => r.kind === "msg").length + 1} who={name} tone={CHAR_TONE} art={charArt} live={turn.live} format={reasoning} prefs={ctx.prefs} speakers={speakers} />
            : look.typing ? <Starting /> : null)}
          <TurnStatus live={turn.live} />
          {find.jump}
        </div>
        {scene && propsOn && sceneStageProps(registeredProps, propsOn).map((p) => <p.Stage key={p.id} ctx={ctx} chat={scene.chat} />)}
        {turn.held?.kind === "failed" && (
          <FailCard code={turn.held.code} message={turn.held.message} draft={turn.held.draft} onDismiss={turn.dismiss}
            {...(retry ? { onRetry: retry } : {})} />
        )}
        {turn.held?.kind === "conflict" && <HeldCard draft={turn.held.draft} onDiscard={turn.discard} onKeep={turn.keep} />}
        {scene && hud !== "core" && hud !== "quiet-line" && <SceneHud take={takeName && takeName.parentBranchId !== null ? takeName.name : "Director's Cut"} messages={scene.messageCount} model={scene.chat.connection?.model ?? "none"} />}
        <ThemeSlot id="scene.composer.above" />
        <SceneComposer api={api} persona={personaName || "User"} expandTick={expandTick} chatId={chatId} prefs={ctx.prefs} tools={tools} steering={steering} onSteer={steer} onCancelSteer={cancelSteer} name={name} connected={connected} busy={busy} showAiHint={!connected && scene !== null}
          onStop={turn.stop} onOpenAiWing={() => openWing("ai")} onSend={dispatchSend} onEditLast={dispatchEditLast} />
        {correctModal}{finalCut.modal}
        {turn.review && <PromptInspector review={turn.review} onAnswer={turn.answer} />}
        </div>
  );
  return (
    <div ref={root} className={`scs${wing ? ` paused open-${side}` : ""}${busy ? " busy" : ""}`} style={{ ...accents, ...painted.style, ...(wing ? { "--wing-w": `${widthOf(wing)}px` } : {}) } as CSSProperties} {...painted.attrs}>
      {messenger ? (
        <Messenger ctx={ctx} chatId={chatId} scene={scene} name={name} personaName={personaName || "Your persona"} programs={programs} request={msnRequest} actions={<>{takes}{update}</>} args={wingArgs ?? null} loreBooks={loreBooks} onTake={switchTake} onFind={find.open}
          onBack={onBack} onSurface={setMsnOpen} renderProgram={(p) => (p.panel && scene ? <PopoutSlot kind={p.panel} ctx={ctx} chat={scene.chat} onChat={(chat) => setScene((s) => (s ? { ...s, chat } : s))} /> : wingBody(p.wing, p.tab, true))}>{chat}</Messenger>
      ) : <>
      <div className="play" data-part="scene.root">
        <div className="bgm" />
        <BackdropLayer ctx={ctx} backdrop={scene?.chat.backdrop} character={cardBackdrop} />
        <ThemeSlot id="scene.backdrop" />
        <header className="sh" data-part="scene.header">
          <IconButton variant="quiet" size="sm" icon="lucide:arrow-left" label="Back to Scenes" onClick={onBack} />
          <span className="nm">{name}</span>
          {tagline && <span className="tag">{tagline}</span>}
          {takes}{update}
        </header>
        {chat}
      </div>
      <WingRails open={wing} onToggle={(id) => setWing(wing === id ? null : id)} extra={propWings(registeredProps, propsOn)} />
      {wing && <><div className="wback" aria-hidden="true" /><div data-part="scene.paused"><Tile kind="icon" size="lg" label="Close the wing" icon={<Ic name="lucide:pause" size={26} />} caption="SCENE PAUSED" onClick={() => setWing(null)} /></div></>}
      {(["l", "r"] as const).map((sd) => (
        <WingSlot key={sd} side={sd} open={side === sd}>{wing && side === sd && wingBody(wing)}</WingSlot>
      ))}
      </>}
      {scene && <PopoutHost ctx={ctx} chat={scene.chat} kinds={popoutKindsFor(WING_POPOUTS, registeredProps, propsOn ?? [])} onChat={(chat) => setScene((s) => (s ? { ...s, chat } : s))} />}
      {versions.toast && <Toast message={versions.toast.message} actionLabel="Undo" onAction={versions.undo} />}
      {notes.toast}
      {history.toast && <Toast message={history.toast.message} actionLabel="Redo" onAction={() => void history.redo()} onDismiss={history.dismiss} />}
      {dialog?.kind === "cut-from" && <CutFromDialog onCancel={() => setDialog(null)} onConfirm={() => void act("cut", versioned({ messageId: dialog.m.id, scope: "from" }))} />}
      {dialog?.kind === "fork" && scene && (
        <ForkDialog number={dialog.n} defaultName={`Take ${scene.takes.length + 1}`} onCancel={() => setDialog(null)} retake={dialog.retake === true} onCreate={(n) => void (dialog.retake ? retakeFrom(dialog.m.id, n) : act("fork", versioned({ messageId: dialog.m.id, name: n })))} />
      )}
      {dialog?.kind === "compare" && scene && <SceneCompare api={api} chatId={chatId} scene={scene} messageId={dialog.id} onClose={() => setDialog(null)} onStale={load} setStatus={setStatus} />}
      {dialog?.kind === "delete-take" && <DeleteTakeDialog take={dialog.take} onCancel={() => setDialog(null)} onConfirm={() => void act("delete-take", { branchId: dialog.take.id })} />}
      {dialog?.kind === "card" && card && <UpdateCardDialog card={card} onCancel={() => setDialog(null)} onUpdate={() => void act("update-card", {})} />}
    </div>
  );
  }
