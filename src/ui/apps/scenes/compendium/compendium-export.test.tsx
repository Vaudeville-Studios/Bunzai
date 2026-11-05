/**
 * EXPORT on the Dashboard (RoleCall `BentoDashboard.tsx:515-552`): the open book (not the first one) streams through the download
 * sink into a file named `<name>__<timestamp>.compendium.json`, a refusal is said in the status line, and nothing reads the
 * response whole (the save is the sink's: Blob to the picked file).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { AppContext } from "../../../app-contract";
import type { SceneLoreBook } from "../../../app-contract-scenes";
import { typedEntry } from "../../../../core/compendium/fixture-book";
import { teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, bodyOf, installLoreDom, press, qa, rig, settle, waitFor, type FlushSync } from "../fake-lore-rig";
import { CompendiumWithFiling } from "./compendium-mounts";
import { exportName } from "./export-button";

const BOOKS: SceneLoreBook[] = [
  { id: "b1", name: "The Drowned Coast", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 1, tokens: 0 },
  { id: "b2", name: "Salt: Court/Law", source: "scene", addedByScene: true, enabled: true, missing: false, entries: 1, tokens: 0 },
];
let asked: string[] = [];
let status: string[] = [];
let refuse = false;
let saved: { name: string; text: string }[] = [];
let flushSync: FlushSync;

const ctx = (): AppContext => ({
  api: {
    getCompendiumTree: async () => ({ tree: null }),
    getLightEditableEntity: async (query: string) => ({ entity: { kind: "lorebook", id: /id=([^&]+)/.exec(query)![1], body: bodyOf("Book", [typedEntry("e1", "Mira", "character", { name: "Mira" })]) }, revision: "r", version: 1 }),
    listCompendiumReceipts: async () => ({ receipts: [], feedClearedAt: 0 }),
    listCompendiumReconcile: async () => ({ rows: [] }),
    exportCompendium: async (id: string) => {
      asked.push(id);
      if (refuse) throw new Error("could not export the compendium (500)");
      const parts = ['{"a":', "1,", '"b":2}'];
      return new Response(new ReadableStream<Uint8Array>({ pull(c) { const next = parts.shift(); if (next) c.enqueue(new TextEncoder().encode(next)); else c.close(); } }), { headers: { "content-type": "application/json" } });
    },
  },
  pieces: { subscribe: () => () => undefined },
  setStatus: (s: string) => void status.push(s), prefs: { get: () => undefined, set: () => undefined },
}) as unknown as AppContext;

async function mount(): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(CompendiumWithFiling, { ctx: ctx(), chat: CHAT as never, books: BOOKS })));
  for (let i = 0; i < 3; i++) await settle(flushSync);
}
const exportBtn = (): HTMLElement => qa("button").find((b) => (b.textContent ?? "").trim() === "Export")!;

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
afterEach(() => { flushSync(() => rig.root.unmount()); rig.host.remove(); delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
beforeEach(() => {
  rig.installed?.reinstall();
  asked = []; status = []; refuse = false; saved = [];
  (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
    createWritable: async () => { const chunks: string[] = []; return new WritableStream<Uint8Array>({ write: (c) => void chunks.push(new TextDecoder().decode(c)), close: () => void saved.push({ name: suggestedName, text: chunks.join("") }) }); },
  });
});

describe("Export", () => {
  test("exports the book that is open, not the first, and saves what streamed in under RoleCall's name", async () => {
    await mount();
    await press(flushSync, qa(".cp-bk button")[0], 20);
    await press(flushSync, qa('[role="option"]').find((o) => o.textContent === "Salt: Court/Law"), 30);
    await press(flushSync, exportBtn(), 20);
    await waitFor(flushSync, () => saved.length === 1, "the saved file");
    expect(asked).toEqual(["b2"]);
    expect(saved[0]!.text).toBe('{"a":1,"b":2}');
    expect(saved[0]!.name).toMatch(/^Salt_ Court_Law__\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.compendium\.json$/);
  });

  test("a refusal is said in the status line and saves nothing", async () => {
    refuse = true;
    await mount();
    await press(flushSync, exportBtn(), 30);
    await waitFor(flushSync, () => status.length > 0, "the status line");
    expect(status[0]).toBe("Export failed: could not export the compendium (500)");
    expect(saved).toEqual([]);
  });

  test("the name is RoleCall's: unsafe characters become underscores, a blank name becomes 'compendium'", () => {
    const at = new Date("2026-10-11T19:32:05.148Z");
    expect(exportName("A/B: C", at)).toBe("A_B_ C__2026-10-11T19-32-05.compendium.json");
    expect(exportName("   ", at)).toBe("compendium__2026-10-11T19-32-05.compendium.json");
  });
});
