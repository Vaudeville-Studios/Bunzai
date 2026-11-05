/**
 * The scene lorebook writer (use-scene-lore.ts) under the timings a person actually produces: a click
 * before the books have loaded, two clicks before the first save answers, and a save the store refuses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { SceneLore as SceneLoreAnswer, SceneLoreChoice } from "../../app-contract-scenes";
import { BOOKS, installLoreDom, loreCtx, resetLore, rig, waitFor, type FlushSync } from "./fake-lore-rig";
import { useSceneLore, type SceneLore } from "./use-scene-lore";

beforeAll(installLoreDom);
afterAll(() => rig.installed?.teardown());
beforeEach(() => resetLore());

let root: Root | null = null;
let flush: FlushSync = (fn) => fn();
const until = (cond: () => boolean, what: string) => waitFor(flush, () => cond() || null, what);
const probe: { current: SceneLore | null } = { current: null };

function Probe({ ctx }: { ctx: AppContext }) {
  probe.current = useSceneLore(ctx, "chat1");
  return null;
}

async function mount(ctx: AppContext): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flush = flushSync;
  flushSync(() => root!.render(createElement(Probe, { ctx })));
  return flushSync;
}

function unmount(flushSync: FlushSync): void {
  flushSync(() => root?.unmount());
  root = null;
  probe.current = null;
}

/** A context whose setSceneLore answers only when the test releases it. */
function slowSaves(): { ctx: AppContext; release: () => void } {
  const ctx = loreCtx();
  const api = ctx.api as unknown as { setSceneLore: (chatId: string, lore: SceneLoreChoice | null) => Promise<SceneLoreAnswer> };
  const answer = api.setSceneLore;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  api.setSceneLore = async (chatId, lore) => { await gate; return answer(chatId, lore); };
  return { ctx, release: () => open() };
}

const ready = () => until(() => probe.current?.lore.state === "ready", "the books to load");
const book = (id: string) => {
  const lore = probe.current!.lore;
  if (lore.state !== "ready") throw new Error("not ready");
  return lore.books.find((b) => b.id === id)!;
};

describe("use-scene-lore writer", () => {
  test("a change before the books have loaded is refused, not sent as an empty choice", async () => {
    const ctx = loreCtx();
    (ctx.api as unknown as { getSceneLore: () => Promise<never> }).getSceneLore = () => new Promise<never>(() => undefined);
    const flushSync = await mount(ctx);
    probe.current!.add("lib1");
    await new Promise((r) => setTimeout(r, 30));
    expect(rig.setLore).toEqual([]);
    expect(rig.statuses.at(-1)).toBe("the scene's lorebooks are still loading; try again in a moment");
    unmount(flushSync);
  });

  test("a change after a failed read is refused, and says to reload", async () => {
    const ctx = loreCtx();
    (ctx.api as unknown as { getSceneLore: () => Promise<never> }).getSceneLore = async () => { throw new Error("offline"); };
    const flushSync = await mount(ctx);
    await until(() => probe.current?.lore.state === "failed", "the read to fail");
    probe.current!.add("lib1");
    await new Promise((r) => setTimeout(r, 30));
    expect(rig.setLore).toEqual([]);
    expect(rig.statuses.at(-1)).toBe("the scene's lorebooks could not be read; reload them before changing them");
    unmount(flushSync);
  });

  test("a second click before the first save answers keeps the first click's change", async () => {
    const { ctx, release } = slowSaves();
    const flushSync = await mount(ctx);
    await ready();
    probe.current!.toggle(book("b1"));
    probe.current!.toggle(book("b2"));
    release();
    await until(() => rig.setLore.length === 2, "both saves");
    expect(rig.setLore.map((w) => w.lore)).toEqual([
      { added: ["b2"], off: ["b3", "b1"] },
      { added: ["b2"], off: ["b3", "b1", "b2"] },
    ]);
    await until(() => probe.current?.lore.state === "ready" && !book("b1").enabled && !book("b2").enabled, "both books off");
    unmount(flushSync);
  });

  test("switching the same book off and on quickly ends where the person left it", async () => {
    const { ctx, release } = slowSaves();
    const flushSync = await mount(ctx);
    await ready();
    const keeper = book("b1");
    probe.current!.toggle(keeper);
    probe.current!.toggle(keeper);
    release();
    await until(() => rig.setLore.length === 2, "both saves");
    expect(rig.setLore.at(-1)!.lore).toEqual({ added: ["b2"], off: ["b3"] });
    unmount(flushSync);
  });

  test("a refused save reads the books again instead of showing a choice that was not kept", async () => {
    const ctx = loreCtx();
    (ctx.api as unknown as { setSceneLore: () => Promise<never> }).setSceneLore = async () => { throw new Error("locked"); };
    const flushSync = await mount(ctx);
    await ready();
    const reads = rig.getLore.length;
    probe.current!.toggle(book("b1"));
    await until(() => rig.getLore.length > reads, "a second read");
    expect(rig.statuses).toContain("could not change this scene's lorebooks: locked");
    await ready();
    expect(book("b1").enabled).toBe(BOOKS.find((b) => b.id === "b1")!.enabled);
    unmount(flushSync);
  });
});
