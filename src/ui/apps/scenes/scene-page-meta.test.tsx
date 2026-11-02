/**
 * Slice S3 of the RoleCall message port, through the scene page:
 * any reply with several versions browses them, and every saved message carries RoleCall's meta line
 * (time, model, generation time, finish reason). Drawn in rc-port/scene-meta.html.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, teardownAllDoms, type InstalledDom, flushTasks } from "../../_shared/test-dom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import { PieceStore } from "../../_shared/piece-store";
import type { OpenScene, TakeSummary } from "../../../studio/scenes";
import type { Message, Swipe } from "../../../stage/contracts/chat-store";

afterAll(teardownAllDoms);

let dom: JSDOM;
let installed: InstalledDom;
let root: Root;
let host: HTMLElement;
let sceneEdits: Array<{ action: string; input: Record<string, unknown> }> = [];
let prefValues: Record<string, unknown> = {};

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8325/", extraGlobals: ["HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 0) as unknown as number, cancelAnimationFrame: (id: number): void => clearTimeout(id) }
  });
  dom = installed.dom;
});
beforeEach(() => {
  installed.reinstall();
  sceneEdits = [];
  prefValues = {};
});

const NOW = 1_000_000_000;
const msg = (id: string, role: "user" | "assistant", content: string, seq: number): Message =>
  ({ id, branchId: "b1", seq, role, swipes: [{ id: `${id}-s1`, content, createdAt: NOW, pinned: false }], current: 0, createdAt: NOW });
const take: TakeSummary = { id: "b1", chatId: "chat1", name: "main", parentBranchId: null, forkMessageId: null, forkSwipeId: null, createdAt: NOW, version: 1, messageCount: 5 };

function sceneFixture(messages: Message[]): OpenScene {
  const roles = messages.map((m) => m.role);
  return {
    chat: { id: "chat1", title: "Test Scene", cast: { character: { id: "vera", version: 1 } }, activeBranchId: "b1", createdAt: NOW, updatedAt: NOW, snapshotVersion: 1, connection: { id: "conn1", model: "model1" } },
    snapshot: { character: { schemaVersion: 1, kind: "character", id: "vera", body: { identity: { name: "Vera" } } } } as unknown as OpenScene["snapshot"],
    hasPortrait: false, messages, messageOffset: 0, messageCount: messages.length, beforeSeq: null, hasMore: false,
    userMessageCount: roles.filter((r) => r === "user").length, assistantMessageCount: roles.filter((r) => r === "assistant").length,
    lastUserMessageIndex: roles.lastIndexOf("user"), lastAssistantMessageIndex: roles.lastIndexOf("assistant"),
    branchVersion: 1, takes: [take], latestCardVersion: null,
  };
}

function makeCtx(messages: Message[]): AppContext {
  const scene = sceneFixture(messages);
  const api = {
    openScene: async () => scene,
    editScene: async (action: string, input: Record<string, unknown>) => { sceneEdits.push({ action, input }); return scene; },
    runSceneTurn: async () => { await new Promise<void>(() => {}); },
    getSceneProps: async () => ({ on: [] }),
    setSceneProps: async (_id: string, on: string[]) => ({ on }),
  };
  return { api, pieces: new PieceStore(), setStatus: () => {}, prefs: { get: (k: string) => prefValues[k], set: (k: string, v: unknown) => { prefValues[k] = v; } } } as unknown as AppContext;
}

type FlushSync = typeof import("react-dom")["flushSync"];
async function mountScenePage(ctx: AppContext): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { ScenePage } = await import("./scene-page");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<ScenePage ctx={ctx} chatId="chat1" onBack={() => undefined} />));
  for (let i = 0; i < 2; i++) { await flushTasks(); flushSync(() => undefined); }
  return flushSync;
}
const settle = async (flushSync: FlushSync, ms = 10): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };
const unmount = (flushSync: FlushSync): void => { flushSync(() => root.unmount()); host.remove(); };
function fiberProps<T>(el: Element): T {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("no React fiber props found on this element");
  return (el as unknown as Record<string, T>)[key]!;
}
const click = (flushSync: FlushSync, el: Element): void => flushSync(() => fiberProps<{ onClick?: (e: unknown) => void }>(el).onClick?.({ shiftKey: false }));

const gen = (model: string, ms: number, finishReason: string): Swipe["generation"] => ({ model, generationMs: ms, finishReason });
/** A reply with one swipe per entry; `current` is the index the reader sees. */
const reply = (id: string, seq: number, texts: string[], current: number, generation?: Swipe["generation"]): Message => ({
  id, branchId: "b1", seq, role: "assistant", current, createdAt: NOW,
  swipes: texts.map((t, i) => ({ id: `${id}-s${i + 1}`, content: t, createdAt: NOW + i * 1000, pinned: false, ...(generation ? { generation } : {}) })),
});
const bubbleOf = (n: number): HTMLElement => {
  const found = [...host.querySelectorAll<HTMLElement>(".msg")].find((el) => el.querySelector(".badge")?.textContent === `#${n}`);
  if (!found) throw new Error(`no bubble #${n}`);
  return found;
};
const meta = (n: number): HTMLElement | null => bubbleOf(n).querySelector<HTMLElement>(".meta");
const counterOf = (n: number): string | null => bubbleOf(n).querySelector(".swc .ct")?.textContent ?? null;
const labelsIn = (el: ParentNode): string[] => [...el.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")!);
const older = (): Message[] => [
  msg("m1", "assistant", "Hello there.", 1),
  msg("m2", "user", "Hi Vera.", 2),
  reply("m3", 3, ["First take.", "Second take.", "Third take."], 1, gen("openai/model-a", 6200, "stop")),
  msg("m4", "user", "And then?", 4),
  reply("m5", 5, ["The last one."], 0, gen("model-b", 41_000, "length")),
];

describe("ScenePage S3: versions on every reply", () => {
  test("an older reply with several versions shows its counter and browses it; no Regenerate there", async () => {
    const flushSync = await mountScenePage(makeCtx(older()));
    expect(counterOf(3)).toBe("2/3");
    const labels = labelsIn(meta(3)!);
    expect(labels).toContain("Previous version");
    expect(labels).toContain("Next version");
    expect(labels).not.toContain("Regenerate");
    click(flushSync, meta(3)!.querySelector('[aria-label="Next version"]')!);
    await settle(flushSync, 10);
    expect(sceneEdits).toEqual([{ action: "select-swipe", input: { chatId: "chat1", messageId: "m3", index: 2, expectedVersion: 1 } }]);
    unmount(flushSync);
  });

  test("an older reply stops at its newest version: Next is disabled there, never a regenerate", async () => {
    const flushSync = await mountScenePage(makeCtx([...older().slice(0, 2), reply("m3", 3, ["a", "b"], 1, gen("m", 1000, "stop")), msg("m4", "user", "x", 4), reply("m5", 5, ["z"], 0)]));
    const next = meta(3)!.querySelector<HTMLButtonElement>('[aria-label="Next version"]')!;
    expect(next.disabled).toBe(true);
    expect(labelsIn(meta(3)!)).not.toContain("Regenerate");
    unmount(flushSync);
  });

  test("a reply with one version shows no counter unless it is the last reply", async () => {
    const flushSync = await mountScenePage(makeCtx(older()));
    expect(counterOf(1)).toBeNull();
    expect(counterOf(5)).toBe("1/1");
    expect(labelsIn(meta(5)!)).toContain("Regenerate");
    const single = await (async () => { unmount(flushSync); return mountScenePage(makeCtx([msg("m1", "assistant", "Hello.", 1), reply("m3", 3, ["only"], 0, gen("m", 900, "stop")), msg("m4", "user", "x", 4), reply("m5", 5, ["last"], 0)])); })();
    expect(counterOf(3)).toBeNull();
    expect(meta(3)).not.toBeNull();
    unmount(single);
  });

  test("the arrow keys still move only the last reply", async () => {
    const flushSync = await mountScenePage(makeCtx([...older().slice(0, 4), reply("m5", 5, ["one", "two"], 1, gen("m", 1000, "stop"))]));
    flushSync(() => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })); });
    await settle(flushSync, 10);
    expect(sceneEdits).toEqual([{ action: "select-swipe", input: { chatId: "chat1", messageId: "m5", index: 0, expectedVersion: 1 } }]);
    unmount(flushSync);
  });
});

describe("ScenePage S3: the meta line on every message", () => {
  test("a reply shows the time, the short model, the generation time and the provider's finish reason", async () => {
    const flushSync = await mountScenePage(makeCtx(older()));
    const m = meta(5)!;
    expect(m.querySelector(".mdl")?.textContent).toBe("model-b · 41.0s");
    expect(m.querySelector(".fin")?.textContent).toBe("length");
    expect(m.querySelector(".fin")?.className).toContain("warn");
    expect(m.querySelector(".ts")?.textContent).toMatch(/\S/);
    expect(meta(3)!.querySelector(".mdl")?.textContent).toBe("model-a · 6.2s");
    expect(meta(3)!.querySelector(".fin")?.textContent).toBe("stop");
    unmount(flushSync);
  });

  test("the time and facts follow the version being shown", async () => {
    const flushSync = await mountScenePage(makeCtx([msg("m1", "assistant", "Hi.", 1), msg("m2", "user", "x", 2),
      { ...reply("m3", 3, ["a", "b"], 0), swipes: [
        { id: "m3-s1", content: "a", createdAt: NOW, pinned: false, generation: gen("one", 1000, "stop") },
        { id: "m3-s2", content: "b", createdAt: NOW, pinned: false, generation: gen("two", 2000, "length") }] }]));
    expect(meta(3)!.querySelector(".mdl")?.textContent).toBe("one · 1.0s");
    expect(meta(3)!.querySelector(".fin")?.textContent).toBe("stop");
    unmount(flushSync);
  });

  test("the time is also at the foot of the portrait, where RoleCall's chrome shows it and the meta row hides its own", async () => {
    const flushSync = await mountScenePage(makeCtx(older()));
    expect(bubbleOf(5).querySelector(".pw .pstamp")?.textContent).toBe(bubbleOf(5).querySelector(".meta .ts")?.textContent);
    expect(bubbleOf(2).querySelector(".pw .pstamp")?.textContent).toMatch(/\S/);
    unmount(flushSync);
  });

  test("a user message shows only its time", async () => {
    const flushSync = await mountScenePage(makeCtx(older()));
    const m = meta(2)!;
    expect(m.querySelector(".ts")?.textContent).toMatch(/\S/);
    expect(m.querySelector(".mdl")).toBeNull();
    expect(m.querySelector(".fin")).toBeNull();
    expect(m.querySelector(".swc")).toBeNull();
    unmount(flushSync);
  });

  test("turning timestamps off keeps the model and chip but drops the time", async () => {
    prefValues["scenes.showTimestamps"] = false;
    const flushSync = await mountScenePage(makeCtx(older()));
    expect(meta(5)!.querySelector(".ts")).toBeNull();
    expect(meta(5)!.querySelector(".mdl")).not.toBeNull();
    expect(meta(2)).toBeNull();
    unmount(flushSync);
  });

  test("a reply with no recorded generation shows its time and nothing invented", async () => {
    const flushSync = await mountScenePage(makeCtx([msg("m1", "assistant", "Hi.", 1), msg("m2", "user", "x", 2), msg("m3", "assistant", "Plain.", 3)]));
    const m = meta(3)!;
    expect(m.querySelector(".mdl")).toBeNull();
    expect(m.querySelector(".fin")).toBeNull();
    expect(m.querySelector(".ts")).not.toBeNull();
    unmount(flushSync);
  });
});

for (const layout of ["familiar", "basic", "desktop98", "immersive"] as const) test(`${layout} mounts the scene's one transcript and composer`, async () => {
  prefValues["scenes.chatLayout"] = layout;
  const flushSync = await mountScenePage(makeCtx([msg("m1", "assistant", "Hello.", 1)]));
  expect(host.querySelector(`[data-chat-layout="${layout}"]`) !== null).toBe(true);
  expect(host.querySelectorAll(".msg").length).toBe(1);
  expect(host.querySelectorAll(".dockbar").length).toBe(1);
  unmount(flushSync);
});
