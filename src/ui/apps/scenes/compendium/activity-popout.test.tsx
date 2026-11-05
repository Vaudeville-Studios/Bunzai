/**
 * The Activity feed as a pop-out kind: docked it carries a Pop out button, popped out the docked spot reads RoleCall's placeholder and
 * the floating "Compendium Activity" panel shows the same feed (receipts and PRE cards) with no World wing mounted and no Pop out
 * button of its own; Bring back docks it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { AppContext } from "../../../app-contract";
import type { CompendiumReceipt } from "../../../../stage/contracts/chat-store";
import type { SceneLoreBook, SceneTrace } from "../../../app-contract-scenes";
import { teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, installLoreDom, press, q, qa, rig, settle, text, type FlushSync } from "../fake-lore-rig";
import { PopoutHost, PopoutSlot } from "../popout/popout-host";
import { activityPopout } from "./activity-popout";

const BOOK: SceneLoreBook = { id: "b1", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 3, tokens: 0 };
const filed: CompendiumReceipt = { id: "r1", chatId: "chat1", branchId: "b1", settledAt: 1, kind: "filing", status: "filed", at: Date.now() - 5_000, writes: [{ bookId: "b1", entryId: "e1", op: "update", fields: { before: {}, after: { "data.name": "Mira Vance" } } }] };
const latest = { reply: { messageId: "m4", swipeId: "s4", number: 4, model: "n", take: "t" }, blocks: [], window: { context: 1, reply: 1, stated: true }, trimmed: 0, lore: null, rawAvailable: false, replies: [{ messageId: "m4", swipeId: "s4", number: 4 }],
  recall: { status: "recalled", at: Date.now() - 1_000, calls: 1, cached: false, alreadyPlaced: 0, cut: [], injected: [{ bookId: "b1", entryId: "e1", bookName: "The Drowned Coast", title: "Mira Vance", tokens: 12, reason: "She is on the quay" }] } } as SceneTrace;
let prefs: Record<string, unknown> = {};
let flushSync: FlushSync;

const ctx = (receipts: CompendiumReceipt[] = [filed]): AppContext => ({
  api: {
    getSceneLore: async () => ({ books: [BOOK], lastTurn: null }),
    getSceneTrace: async () => latest,
    listCompendiumReceipts: async () => ({ receipts, feedClearedAt: 0 }),
    getLightEditableEntity: async () => { throw new Error("no book"); },
  },
  pieces: { subscribe: () => () => undefined },
  setStatus: () => undefined, prefs: { get: (k: string) => prefs[k], set: (k: string, v: unknown) => { prefs[k] = v; } },
}) as unknown as AppContext;

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
beforeEach(() => { rig.installed?.reinstall(); prefs = {}; });

describe("the Activity pop-out", () => {
  test("500 receipts mount fewer than 60 feed rows", async () => {
    const { createRoot } = await import("react-dom/client");
    rig.host = rig.dom.window.document.createElement("div");
    rig.dom.window.document.body.appendChild(rig.host);
    rig.root = createRoot(rig.host);
    const c = ctx(Array.from({ length: 500 }, (_, i) => ({ ...filed, id: `r${String(i)}`, at: Date.now() - i * 1_000 })));
    flushSync(() => rig.root.render(createElement("div", null, createElement(PopoutSlot, { kind: activityPopout, ctx: c, chat: CHAT }), createElement(PopoutHost, { ctx: c, chat: CHAT, kinds: [activityPopout] }))));
    for (let i = 0; i < 3; i++) await settle(flushSync);
    const rows = qa(".cp-feed [data-index]").length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(60);
    flushSync(() => rig.root.unmount());
    rig.host.remove();
  });

  test("pops out into a floating Compendium Activity panel with the same feed, and Bring back docks it", async () => {
    const { createRoot } = await import("react-dom/client");
    rig.host = rig.dom.window.document.createElement("div");
    rig.dom.window.document.body.appendChild(rig.host);
    rig.root = createRoot(rig.host);
    const c = ctx();
    flushSync(() => rig.root.render(createElement("div", null, createElement(PopoutSlot, { kind: activityPopout, ctx: c, chat: CHAT }), createElement(PopoutHost, { ctx: c, chat: CHAT, kinds: [activityPopout] }))));
    for (let i = 0; i < 3; i++) await settle(flushSync);
    expect(text()).toContain("Retrieved: Mira Vance");
    expect(q('[data-popout="compendium.activity"]')).toBeNull();
    await press(flushSync, q('button[aria-label="Pop out"]'), 40);
    await settle(flushSync);
    const panel = q('[data-popout="compendium.activity"]')!;
    expect(panel.textContent).toContain("Compendium Activity");
    expect(panel.textContent).toContain("Retrieved: Mira Vance");
    expect(panel.textContent).toContain("Updated");
    expect(panel.querySelector('button[aria-label="Pop out"]')).toBeNull();
    expect(qa("button").filter((b) => b.getAttribute("aria-label") === "Clear feed")).toHaveLength(1);
    expect(text()).toContain("Activity feed is floating");
    await press(flushSync, qa("button").find((b) => b.textContent === "Bring back")!);
    await settle(flushSync);
    expect(q('[data-popout="compendium.activity"]')).toBeNull();
    expect(q('button[aria-label="Pop out"]')).not.toBeNull();
    flushSync(() => rig.root.unmount());
    rig.host.remove();
  });
});
