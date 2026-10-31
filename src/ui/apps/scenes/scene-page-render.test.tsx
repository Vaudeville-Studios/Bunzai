/** Purpose: prove scene composer typing leaves bubbles stable and streaming coalesces within animation frames. */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, teardownAllDoms, type InstalledDom } from "../../_shared/test-dom";
import type { JSX } from "react";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import { PieceStore } from "../../_shared/piece-store";
import type { OpenScene, TakeSummary } from "../../../studio/scenes";
import type { Message, Swipe } from "../../../stage/contracts/chat-store";
import type { TurnEvent } from "../../../studio/scene-turn";

import { SURFACES, surfaceAttribute, type SurfaceId } from "../../../extensions/surface-registry";

afterAll(async () => { mock.module("./prose", () => realProse); await teardownAllDoms(); Reflect.deleteProperty(globalThis, "PointerEvent"); }); // PointerEvent is aliased by hand below, so remove it by hand

const proseCalls: string[] = [];
const realProse = { ...(await import("./prose")) }; // mock.module is process-wide and rewrites the live module, so snapshot the real exports and put them back in afterAll
mock.module("./prose", () => ({
  Prose: ({ text }: { text: string }): JSX.Element => {
    proseCalls.push(text);
    const paragraphs = text.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
    return <div className="prose">{paragraphs.map((p: string, i: number) => <p key={i}>{p}</p>)}</div>;
  },
}));

// -- a controllable rAF: never auto-fires, so a test decides exactly when a frame lands -----------
let queuedFrame: FrameRequestCallback | null = null;
let nextFrameId = 1;
function fireQueuedFrame(): void {
  const cb = queuedFrame;
  queuedFrame = null;
  if (cb) cb(0);
}

let dom: JSDOM;
let installed: InstalledDom;

const installGlobals = (): void => {
  queuedFrame = null;
  nextFrameId = 1;
  if (installed) {
    installed.reinstall();
    return;
  }
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8324/",
    extraGlobals: ["HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent", "MutationObserver"],
    boundGlobals: ["getComputedStyle"],
    globals: {
      requestAnimationFrame: (cb: FrameRequestCallback): number => {
        queuedFrame = cb;
        return nextFrameId++;
      },
      cancelAnimationFrame: (): void => {
        queuedFrame = null;
      },
    }
  });
  dom = installed.dom;
  // Deliberately aliased to Event, not the real PointerEvent: the handlers under test only branch
  // on `.type`/`.key`, and a plain Event is enough to construct one.
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = dom.window.Event;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
};

beforeAll(installGlobals);

// -- fixtures --------------------------------------------------------------------------------------

const NOW = 1_000_000_000;
const swipe = (id: string, content: string): Swipe => ({ id, content, createdAt: NOW, pinned: false });
const msg = (id: string, role: "user" | "assistant", content: string, seq: number): Message =>
  ({ id, branchId: "b1", seq, role, swipes: [swipe(`${id}-s1`, content)], current: 0, createdAt: NOW });

const FIXED_TEXTS = ["Hello there, traveler.", "Hi Vera.", "Nice to meet you.", "Tell me a story."];
const fixedMessages = (): Message[] => [
  msg("m1", "assistant", FIXED_TEXTS[0]!, 1),
  msg("m2", "user", FIXED_TEXTS[1]!, 2),
  msg("m3", "assistant", FIXED_TEXTS[2]!, 3),
  msg("m4", "user", FIXED_TEXTS[3]!, 4),
];

const take: TakeSummary = { id: "b1", chatId: "chat1", name: "main", parentBranchId: null, forkMessageId: null, forkSwipeId: null, createdAt: NOW, version: 1, messageCount: 4 };

function sceneFixture(messages = fixedMessages()): OpenScene {
  const liveRoles = messages.filter((m) => !m.cut).map((m) => m.role);
  const lastUser = liveRoles.lastIndexOf("user");
  const lastAssistant = liveRoles.lastIndexOf("assistant");
  return {
    chat: {
      id: "chat1", title: "Test Scene",
      cast: { character: { id: "vera", version: 1 } },
      activeBranchId: "b1", createdAt: NOW, updatedAt: NOW, snapshotVersion: 1,
      connection: { id: "conn1", model: "model1" },
    },
    snapshot: { character: { schemaVersion: 1, kind: "character", id: "vera", body: { identity: { name: "Vera" } } } } as unknown as OpenScene["snapshot"],
    hasPortrait: false,
    messages,
    messageOffset: 0,
    messageCount: messages.filter((m) => !m.cut).length,
    beforeSeq: null,
    hasMore: false,
    userMessageCount: messages.filter((m) => !m.cut && m.role === "user").length,
    assistantMessageCount: messages.filter((m) => !m.cut && m.role === "assistant").length,
    lastUserMessageIndex: lastUser < 0 ? null : lastUser,
    lastAssistantMessageIndex: lastAssistant < 0 ? null : lastAssistant,
    branchVersion: 1,
    takes: [take],
    latestCardVersion: null,
  };
}

// -- a controllable AppContext: runSceneTurn hands back its onEvent so the test can drive it --------

let capturedOnEvent: ((e: TurnEvent) => void) | null = null;
let sendCalls = 0;
let turnInputs: Array<{ chatId?: string; kind: string; expectedVersion: number }> = [];
let stopCalls: string[] = [];
let edits: Array<{ messageId: string; content: string }> = [];

function makeCtx(messages?: Message[]): AppContext {
  const scene = sceneFixture(messages);
  const api = {
    openScene: async () => scene,
    getSceneSwipeHistory: async () => ({ swipeId: "x", texts: [] }),
    sendToScene: async (input: { content: string }) => {
      sendCalls++;
      const next = sceneFixture([...fixedMessages(), msg("m5", "user", input.content, 5)]);
      return next;
    },
    editScene: async () => scene,
    editSceneMessage: async (input: { messageId: string; content: string }) => {
      edits.push({ messageId: input.messageId, content: input.content });
      return scene.messages[0]!;
    },
    runSceneTurn: async (input: { chatId?: string; kind: string; expectedVersion: number }, onEvent: (e: TurnEvent) => void) => {
      turnInputs.push(input);
      capturedOnEvent = onEvent;
      // Never resolves within the test: the turn is still "running" for as long as the test drives it.
      await new Promise<void>(() => {});
    },
    stopSceneTurn: async (_chatId: string, turnId: string) => {
      stopCalls.push(turnId);
      return { stopped: true };
    },
    keepWaitingReply: async () => scene.messages[0]!,
    discardWaitingReply: async () => ({ discarded: true }),
    getSceneProps: async () => ({ on: [] }),
    setSceneProps: async (_id: string, on: string[]) => ({ on }),
    getSceneLore: async () => ({ books: [], lastTurn: null }),
    listLoadouts: async () => [], getSceneTrace: async () => null, getSceneSummary: async () => ({ settings: {}, text: null, through: 0, at: null, total: 0, error: null, running: false }),
    latestLoadoutReceipt: async () => null,
    sceneConnections: async () => [],
    connectionModels: async () => ({ models: [], saved: "" }),
  };
  return { api, pieces: new PieceStore(), setStatus: () => {}, prefs: { get: () => undefined, set: () => undefined } } as unknown as AppContext;
}

// -- DOM plumbing ----------------------------------------------------------------------------------

type FlushSync = typeof import("react-dom")["flushSync"];
let root: Root;
let host: HTMLElement;

async function settle(flushSync: FlushSync, ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  flushSync(() => undefined);
}

async function mountScenePage(ctx: AppContext, navigationTicketId?: string, loadId?: string): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { ScenePage } = await import("./scene-page");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<ScenePage ctx={ctx} chatId="chat1" navigationTicketId={navigationTicketId} loadId={loadId} onBack={() => undefined} />));
  await settle(flushSync);
  await settle(flushSync);
  return flushSync;
}

function unmount(flushSync: FlushSync): void {
  flushSync(() => root.unmount());
  host.remove();
}

/** Calls a DOM node's React onChange/onSubmit straight off its fiber, the way this suite's other
 * scene-page-adjacent tests do (scene-preset-wing.test.tsx): a dispatched native event does not
 * reliably reach React's handlers in this harness, but the fiber's own props always do. */
function fiberProps<T>(el: Element): T {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("no React fiber props found on this element");
  return (el as unknown as Record<string, T>)[key]!;
}

beforeEach(() => {
  installGlobals();
  proseCalls.length = 0;
  capturedOnEvent = null;
  sendCalls = 0;
  turnInputs = [];
  stopCalls = [];
  edits = [];
});

// -- tests -------------------------------------------------------------------------------------

describe("ScenePage: a keystroke never re-renders a bubble", () => {
  test("a loaded scene reports its claimed navigation ticket to the host", async () => {
    const notifications: Array<[string, string | null]> = [];
    const ctx = makeCtx();
    Object.assign(ctx.api, { extensions: { notifySceneOpened: async (id: string, ticketId: string | null) => { notifications.push([id, ticketId]); return true; } } });
    const flushSync = await mountScenePage(ctx, "claimed-navigation", "load-correlation");
    await settle(flushSync);
    expect(notifications).toEqual([["chat1", "claimed-navigation"]]);
    unmount(flushSync);
  });

  test("typing 10 characters into the composer renders Prose zero more times", async () => {
    const flushSync = await mountScenePage(makeCtx());
    const textarea = host.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    const baseline = proseCalls.length;
    expect(baseline).toBeGreaterThan(0); // the 4 fixed messages rendered once at mount
    const onChange = fiberProps<{ onChange?: (e: { target: { value: string } }) => void }>(textarea!).onChange;
    expect(onChange).toBeDefined();
    const word = "hello story";
    for (let i = 1; i <= word.length; i++) {
      flushSync(() => onChange!({ target: { value: word.slice(0, i) } }));
    }
    expect(textarea!.value).toBe(word);
    expect(proseCalls.length).toBe(baseline);
    unmount(flushSync);
  });
});

describe("ScenePage: a streamed reply coalesces to one render per frame, without re-rendering finished bubbles", () => {
  test("60 token events queue one frame; firing it renders the live bubble once and no finished bubble again", async () => {
    const flushSync = await mountScenePage(makeCtx());
    const textarea = host.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement | null;
    const form = host.querySelector("form.cap") as HTMLFormElement | null;
    expect(textarea).not.toBeNull();
    expect(form).not.toBeNull();
    const onChange = fiberProps<{ onChange?: (e: { target: { value: string } }) => void }>(textarea!).onChange!;
    flushSync(() => onChange({ target: { value: "Any storms?" } }));
    const onSubmit = fiberProps<{ onSubmit?: (e: { preventDefault(): void }) => void }>(form!).onSubmit!;
    flushSync(() => onSubmit({ preventDefault: () => undefined }));
    // Let sendToScene resolve, the scene update land, and runSceneTurn capture its onEvent.
    for (let i = 0; i < 5 && !capturedOnEvent; i++) await settle(flushSync, 10);
    expect(sendCalls).toBe(1);
    expect(capturedOnEvent).not.toBeNull();

    flushSync(() => capturedOnEvent!({ type: "start", turnId: "t1", kind: "reply", messageId: null }));
    const baselineIndex = proseCalls.length;

    // Every token its own synchronous delivery (a real network read would not batch either): this is
    // what makes today's un-batched `setLive` show up as a separate render each time.
    for (let i = 0; i < 60; i++) {
      flushSync(() => capturedOnEvent!({ type: "text", delta: "y" }));
    }
    // Coalesced: no frame has fired yet, so nothing rendered since "start".
    expect(proseCalls.length).toBe(baselineIndex);

    flushSync(fireQueuedFrame);

    const since = proseCalls.slice(baselineIndex);
    const liveCalls = since.filter((t) => /^y+$/.test(t));
    const finishedCalls = since.filter((t) => FIXED_TEXTS.includes(t));
    expect(liveCalls).toEqual(["y".repeat(60)]);
    expect(finishedCalls.length).toBe(0);
    unmount(flushSync);
  });
});

// VVS: imported SillyTavern chats leaked <think>/reasoning text into the scene page's bubbles.
describe("ScenePage: reasoning never reaches a bubble", () => {
  test("an inline <think> block baked into a stored message's text never reaches the bubble", async () => {
    const messages = [msg("m1", "assistant", "<think>\nplanning the scene\n</think>\n\nShe opened the door.", 1)];
    const flushSync = await mountScenePage(makeCtx(messages));
    expect(proseCalls.some((t) => t.includes("She opened the door."))).toBe(true);
    expect(proseCalls.some((t) => t.includes("planning the scene"))).toBe(false);
    expect(proseCalls.some((t) => /think/i.test(t))).toBe(false);
    unmount(flushSync);
  });

  test("guard: a swipe's separately-stored generation.reasoning is never rendered inline", async () => {
    const swipeWithReasoning: Swipe = {
      id: "m1-s1",
      content: "She opened the door.",
      createdAt: NOW,
      pinned: false,
      generation: { reasoning: { text: "the character should hesitate before opening the door" } },
    };
    const messages: Message[] = [{ id: "m1", branchId: "b1", seq: 1, role: "assistant", swipes: [swipeWithReasoning], current: 0, createdAt: NOW }];
    const flushSync = await mountScenePage(makeCtx(messages));
    expect(proseCalls.some((t) => t.includes("She opened the door."))).toBe(true);
    expect(proseCalls.some((t) => t.includes("hesitate before opening"))).toBe(false);
    unmount(flushSync);
  });
});

describe("ScenePage: every variant a theme can pick keeps every control", () => {
  const picks = ["scene.layout", "scene.message", "scene.composer", "scene.swipes", "scene.wings", "scene.hud"] as const satisfies readonly SurfaceId[];
  const named = (el: ParentNode, label: string): boolean => el.querySelector(`[aria-label="${label}"]`) !== null;
  for (let i = 0; i < 4; i++) {
    test(`variant set ${i + 1} (${picks.map((s) => SURFACES[s][i]).join(", ")}) shows the actions, composer, versions, wings${i === 0 ? "" : " and the readout"}`, async () => {
      const root = dom.window.document.documentElement;
      for (const s of picks) root.setAttribute(surfaceAttribute(s), SURFACES[s][i]!);
      const flushSync = await mountScenePage(makeCtx([...fixedMessages(), msg("m5", "assistant", "The reply.", 5)]));
      for (const label of ["Edit", "Copy", "Regenerate as a new version", "More message actions", "Delete", "Previous version", "Regenerate", "Message", "Send", "Control Booth", "Cast", "Prompting", "World", "Props", "AI", "Stage", "Context", "Back to Scenes"]) expect(named(host, label), label).toBe(true);
      expect(host.querySelector(".scs")).not.toBeNull();
      const hud = host.querySelector(".hudline");
      if (i === 0) expect(hud).toBeNull();
      else {
        expect(hud?.textContent).toContain("Messages");
        expect(hud?.textContent).toContain("5");
        expect(hud?.textContent).toContain("model1");
      }
      unmount(flushSync);
      for (const s of picks) root.removeAttribute(surfaceAttribute(s));
    });
  }
});

describe("ScenePage: each message keeps the persona that wrote it (ChatStore rule 26)", () => {
  const stamped = (id: string, seq: number, who: Message["persona"]): Message => ({ ...msg(id, "user", `line ${id}`, seq), ...(who === undefined ? {} : { persona: who }) });

  test("names every user line by its own stamp, and draws one \"you now play\" line where the persona changed", async () => {
    const messages = [
      stamped("u1", 1, { id: "nuit", name: "Nuit" }), msg("a1", "assistant", "Reply one.", 2),
      stamped("u2", 3, { id: "corvin", name: "Corvin" }), msg("a2", "assistant", "Reply two.", 4),
      stamped("u3", 5, null),
    ];
    const flushSync = await mountScenePage(makeCtx(messages));
    const speakers = [...host.querySelectorAll(".spk")].map((s) => s.textContent);
    expect(speakers).toEqual(["Nuit", "Vera", "Corvin", "Vera", "You"]);
    const lines = [...host.querySelectorAll('[data-part="scene.cast.line"]')].map((l) => l.textContent);
    expect(lines).toEqual(["You now play Corvin", "You now play User"]);
    unmount(flushSync);
  });

  test("an older message with no stamp shows no line and falls back to the scene's current persona name", async () => {
    const flushSync = await mountScenePage(makeCtx([stamped("u1", 1, undefined), msg("a1", "assistant", "Reply.", 2)]));
    expect(host.querySelectorAll('[data-part="scene.cast.line"]')).toHaveLength(0);
    expect([...host.querySelectorAll(".spk")].map((s) => s.textContent)).toEqual(["You", "Vera"]);
    unmount(flushSync);
  });
});

// -- S1: ask again, Esc stops, edit keys, copy feedback -----

const byLabel = (label: string): HTMLElement | null => host.querySelector(`[aria-label="${label}"]`);
const keyEvent = (k: string, extra: Record<string, unknown>) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => undefined, stopPropagation: () => undefined, nativeEvent: { key: k, defaultPrevented: false, isComposing: false }, ...extra });
const press = (flushSync: FlushSync, el: Element, k: string, extra: Record<string, unknown> = {}): { prevented: boolean } => {
  const seen = { prevented: false };
  flushSync(() => fiberProps<{ onKeyDown?: (e: unknown) => void }>(el).onKeyDown?.(keyEvent(k, { ...extra, preventDefault: () => { seen.prevented = true; } })));
  return seen;
};
const click = (flushSync: FlushSync, el: Element): void => flushSync(() => fiberProps<{ onClick?: (e: unknown) => void }>(el).onClick?.({ shiftKey: false }));
const typeInto = (flushSync: FlushSync, el: Element, value: string): void => flushSync(() => fiberProps<{ onChange: (e: unknown) => void }>(el).onChange({ target: { value } }));
const documentEscape = (flushSync: FlushSync): void => flushSync(() => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
const endsOnUser = (): Message[] => [msg("m1", "assistant", "Hello there.", 1), msg("m2", "user", "Hi Vera.", 2)];
const composerBox = (): HTMLTextAreaElement => host.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement;

async function startReply(flushSync: FlushSync): Promise<void> {
  typeInto(flushSync, composerBox(), "Any storms?");
  flushSync(() => fiberProps<{ onSubmit: (e: unknown) => void }>(host.querySelector("form.cap")!).onSubmit({ preventDefault: () => undefined }));
  for (let i = 0; i < 5 && !capturedOnEvent; i++) await settle(flushSync, 10);
  flushSync(() => capturedOnEvent!({ type: "start", turnId: "t1", kind: "reply", messageId: null }));
}

describe("ScenePage S1: ask again when the take ends on your message", () => {
  test("offers Ask again on the last user message, and it asks for a reply to that message", async () => {
    const flushSync = await mountScenePage(makeCtx(endsOnUser()));
    const button = byLabel("Ask again for a reply");
    expect(button).not.toBeNull();
    click(flushSync, button!);
    await settle(flushSync, 10);
    expect(turnInputs).toEqual([{ chatId: "chat1", kind: "reply", expectedVersion: 1 }]);
    unmount(flushSync);
  });

  test("is not offered when the take ends on a reply", async () => {
    const flushSync = await mountScenePage(makeCtx([...endsOnUser(), msg("m3", "assistant", "Reply.", 3)]));
    expect(byLabel("Ask again for a reply")).toBeNull();
    unmount(flushSync);
  });
});

describe("ScenePage S1: Esc stops a generation", () => {
  test("Escape while a reply is being written stops that turn; with no turn it does nothing", async () => {
    const flushSync = await mountScenePage(makeCtx());
    documentEscape(flushSync);
    expect(stopCalls).toEqual([]);
    await startReply(flushSync);
    documentEscape(flushSync);
    await settle(flushSync, 10);
    expect(stopCalls).toEqual(["t1"]);
    unmount(flushSync);
  });

  test("an open menu spends the Escape first; the turn keeps running", async () => {
    const flushSync = await mountScenePage(makeCtx());
    await startReply(flushSync);
    click(flushSync, byLabel("More message actions")!);
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    documentEscape(flushSync);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(stopCalls).toEqual([]);
    unmount(flushSync);
  });
});

describe("ScenePage S1: edit keys", () => {
  const openEdit = (flushSync: FlushSync): HTMLTextAreaElement => {
    click(flushSync, byLabel("Edit")!);
    return host.querySelector('textarea[aria-label="Edit message"]') as HTMLTextAreaElement;
  };

  test("Escape cancels the edit without saving", async () => {
    const flushSync = await mountScenePage(makeCtx());
    const box = openEdit(flushSync);
    expect(box).not.toBeNull();
    expect(press(flushSync, box, "Escape").prevented).toBe(true);
    expect(host.querySelector('textarea[aria-label="Edit message"]')).toBeNull();
    expect(edits).toEqual([]);
    unmount(flushSync);
  });

  test("Ctrl+Enter and Cmd+Enter save; plain Enter and Shift+Enter do not", async () => {
    const flushSync = await mountScenePage(makeCtx());
    let box = openEdit(flushSync);
    typeInto(flushSync, box, "Changed.");
    press(flushSync, box, "Enter");
    press(flushSync, box, "Enter", { shiftKey: true });
    expect(edits).toEqual([]);
    press(flushSync, box, "Enter", { ctrlKey: true });
    await settle(flushSync, 10);
    expect(edits).toEqual([{ messageId: "m1", content: "Changed." }]);
    box = openEdit(flushSync);
    typeInto(flushSync, box, "Again.");
    press(flushSync, box, "Enter", { metaKey: true });
    await settle(flushSync, 10);
    expect(edits.length).toBe(2);
    unmount(flushSync);
  });

  test("ArrowUp in an empty composer edits your last message; with a draft it does not", async () => {
    const flushSync = await mountScenePage(makeCtx());
    typeInto(flushSync, composerBox(), "draft");
    expect(press(flushSync, composerBox(), "ArrowUp").prevented).toBe(false);
    expect(host.querySelector('textarea[aria-label="Edit message"]')).toBeNull();
    typeInto(flushSync, composerBox(), "");
    expect(press(flushSync, composerBox(), "ArrowUp").prevented).toBe(true);
    const box = host.querySelector('textarea[aria-label="Edit message"]') as HTMLTextAreaElement;
    expect(box.value).toBe("Tell me a story.");
    unmount(flushSync);
  });
});

describe("ScenePage S1: copy says whether it worked", () => {
  const withClipboard = (writeText: (() => Promise<void>) | undefined): void => {
    Object.defineProperty(globalThis.navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
  };

  test("a copy that works reads Copied, one that fails reads Copy failed", async () => {
    const flushSync = await mountScenePage(makeCtx());
    withClipboard(async () => undefined);
    click(flushSync, byLabel("Copy")!);
    await settle(flushSync, 10);
    expect(byLabel("Copied")).not.toBeNull();
    unmount(flushSync);
    const failing = await mountScenePage(makeCtx());
    withClipboard(async () => { throw new Error("denied"); });
    click(failing, byLabel("Copy")!);
    await settle(failing, 10);
    expect(byLabel("Copy failed")).not.toBeNull();
    expect(byLabel("Copied")).toBeNull();
    withClipboard(undefined);
    unmount(failing);
  });
});

describe("ScenePage: the Control Booth opens built", () => {
  test("the Booth rail button opens the hero and the Preset and Narrator tiles, not the not-built stub", async () => {
    const flushSync = await mountScenePage(makeCtx());
    click(flushSync, byLabel("Control Booth")!);
    await settle(flushSync, 10);
    expect(host.textContent).toContain("Scene control surface");
    expect(host.textContent).not.toContain("is not built yet");
    expect(host.querySelector('[data-part="scene.booth.status"]')?.textContent).toContain("model1");
    unmount(flushSync);
  });
});
