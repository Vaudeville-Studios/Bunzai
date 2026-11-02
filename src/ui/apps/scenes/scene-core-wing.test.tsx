/** Linked rp-core scenes expose an independent wing with persisted feature switches. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { flushTasks, installDom, type InstalledDom } from "../../_shared/test-dom";
import type { AppContext } from "../../app-contract";
import type { OpenScene } from "../../../studio/scenes";
import type { CoreSceneState } from "../../../studio/core-inspect";
import { fakeScrollerLayout } from "./fake-scroller";

let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><head><style>.wbody{height:720px;overflow-y:auto}</style></head><body></body></html>", { url: "http://127.0.0.1:8325/", observers: true, pretendToBeVisual: true, globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  fakeScrollerLayout(installed.dom.window);
});
afterAll(() => installed.teardown());

const scene = { core: true, chat: { id: "c1" }, branchVersion: 1 } as unknown as OpenScene;
let state: CoreSceneState = {
  directorEnabled: false, memoryEnabled: true, director: null,
  memory: { total: 0, offset: 0, items: [], queued: 0, running: false, parked: 0 },
};
const writes: Array<[string, string, boolean]> = [];
const ctx = { api: {
  getCoreSceneState: async () => state,
  setCoreSceneFeature: async (chatId: string, feature: "director" | "memory", enabled: boolean) => {
    writes.push([chatId, feature, enabled]);
    state = { ...state, [feature === "director" ? "directorEnabled" : "memoryEnabled"]: enabled };
    return state;
  },
} } as unknown as AppContext;

test("rp-core has its own right rail button and saves both switches", async () => {
  const [{ act }, { createRoot }, { CORE_WING, WingPanel, WingRails }] = await Promise.all([import("react"), import("react-dom/client"), import("./scene-wings")]);
  const host = installed.dom.window.document.createElement("div");
  installed.dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<><WingRails open="core" onToggle={() => undefined} extra={[CORE_WING]} /><WingPanel id="core" core={{ ctx, scene }} /></>); await flushTasks(4, 10); });
  expect(CORE_WING.side).toBe("r");
  expect(host.querySelector('nav.rail.r [data-wing="core"]')).not.toBeNull();
  expect(host.querySelector('[data-wing="core"].wing-panel')).not.toBeNull();
  const switches = () => [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  expect(switches().map((button) => button.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  await act(async () => { switches()[0]!.click(); await flushTasks(4, 10); });
  await act(async () => { switches()[1]!.click(); await flushTasks(4, 10); });
  expect(writes).toEqual([["c1", "director", true], ["c1", "memory", false]]);
  expect(switches().map((button) => button.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  await act(async () => { root.unmount(); });
  host.remove();
});

test("Director seeds show their hint and payoff rather than a numbered placeholder", async () => {
  state = { ...state, director: { turn: 1, ok: true, state: { seeds: [{ id: "seed-1", hint: "A silver key", payoff: "Opens the masked door" }] } } };
  const [{ act }, { createRoot }, { WingPanel }] = await Promise.all([import("react"), import("react-dom/client"), import("./scene-wings")]);
  const host = installed.dom.window.document.createElement("div");
  installed.dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<WingPanel id="core" core={{ ctx, scene }} />); await flushTasks(4, 10); });
  expect(host.textContent).toContain("A silver key");
  expect(host.textContent).toContain("Opens the masked door");
  expect(host.textContent).not.toContain("Item 1");
  await act(async () => { root.unmount(); });
  host.remove();
});

test("large Director sections mount a window and reach the final entry after scrolling", async () => {
  state = { ...state, director: { turn: 1, ok: true, state: { seeds: Array.from({ length: 320 }, (_, index) => ({ id: `seed-${index}`, title: `Seed entry ${index}`, ...(index === 319 ? { payoff: "opens the east gate", status: "pending" } : {}) })) } } };
  const [{ act }, { createRoot }, { WingPanel }] = await Promise.all([import("react"), import("react-dom/client"), import("./scene-wings")]);
  const host = installed.dom.window.document.createElement("div");
  installed.dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<div className="scs"><WingPanel id="core" core={{ ctx, scene }} /></div>); await flushTasks(6, 10); });
    const entries = () => [...host.querySelectorAll<HTMLElement>('[aria-label="rp-core Director"] .mm-text p')];
    expect(entries().length).toBeLessThan(60);
    expect(host.textContent).toContain("Seed entry 0");
    const scroller = host.querySelector<HTMLElement>(".wbody.mm")!;
    let scrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    scroller.getBoundingClientRect = () => ({ top: scrollTop, bottom: scrollTop + 720, left: 0, right: 0, width: 420, height: 720, x: 0, y: scrollTop, toJSON: () => ({}) });
    await act(async () => { scroller.scrollTop = 20_000; scroller.dispatchEvent(new installed.dom.window.Event("scroll")); await flushTasks(6, 10); });
    expect(host.textContent).toContain("Seed entry 319 · Payoff: opens the east gate · pending");
    expect(entries().some((row) => row.textContent?.includes("Seed entry 0"))).toBe(false);
    expect(entries().length).toBeLessThan(60);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("the scene panel assembler passes the linked session to its wing", async () => {
  const { wingPanels } = await import("./messenger/wing-props");
  const linked = { ...scene, snapshot: { character: { body: {} } }, chat: { ...scene.chat, cast: { character: {} } } } as unknown as OpenScene;
  const args = { ctx, scene: linked, registeredProps: [], propsState: { load: { state: "ready", on: [] } }, loreBooks: null } as unknown as import("./messenger/wing-props").WingArgs;
  expect(wingPanels(args).core).toEqual({ ctx, scene: linked });
});
