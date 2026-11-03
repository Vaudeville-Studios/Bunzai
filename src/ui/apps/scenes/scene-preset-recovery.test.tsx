/** Preset setup recovery: no selection stays usable, and an unreadable saved kind does not trap the picker. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import type { JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { Chat, ChatPreset } from "../../../stage/contracts/chat-store";
import { emptyPresetBody } from "../../../entities/preset/schema";
import { ApiHttpError } from "../../_shared/api-fetch";
import { installDom, type InstalledDom } from "../../_shared/test-dom";
import { PresetWing, presetTabMeta } from "./scene-preset-wing";
import { useScenePresetText } from "./use-scene-preset-text";

const body = emptyPresetBody("Test Preset");
const entity = { kind: "preset", id: "p1", body };
const cast = { character: { id: "c1", version: 1, name: "Char" } } as Chat["cast"];
const chatWith = (preset: ChatPreset | null): Chat => ({
  id: "chat1", title: "Scene", cast, activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1,
  preset: preset ?? undefined,
});

let installed: InstalledDom;
let host: HTMLElement;
let root: Root;
let getCalls: string[];
let setCalls: { chatId: string; preset: ChatPreset | null }[];
let changed: Chat[];
let getEntity: () => Promise<{ entity: unknown; revision: string }>;
let ctx: AppContext;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true, pretendToBeVisual: true, globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  Object.defineProperty(installed.dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 200 });
  Object.defineProperty(installed.dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
});
afterAll(() => installed.teardown());

function reset(): void {
  getCalls = [];
  setCalls = [];
  changed = [];
  getEntity = async () => ({ entity, revision: "r1" });
  ctx = {
    api: {
      getEditableEntity: async (query: string) => { getCalls.push(query); return getEntity(); },
      listEntities: async (kind?: string) => kind === "preset" ? [{ id: "p1", kind: "preset", name: "Test Preset" }] : [],
      setScenePreset: async (chatId: string, preset: ChatPreset | null) => { setCalls.push({ chatId, preset }); return { ...chatWith(preset), id: chatId }; },
      saveEditedEntity: async () => ({ revision: "r2" }),
    },
    workbench: { open: () => undefined }, prefs: { get: () => undefined, set: () => undefined }, openApp: () => undefined,
  } as unknown as AppContext;
}

function Panel({ chat }: { chat: Chat }): JSX.Element {
  const text = useScenePresetText(ctx, chat.preset ?? null, () => undefined);
  return <PresetWing ctx={ctx} chat={chat} text={text} onChanged={(next) => changed.push(next)} />;
}

async function mount(chat: Chat): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Panel chat={chat} />); await new Promise((resolve) => setTimeout(resolve, 30)); });
}

async function click(label: string): Promise<void> {
  const button = [...host.querySelectorAll("button")].find((item) => (item.textContent ?? "").includes(label));
  if (!button) throw new Error(`Preset recovery action not found: ${label}`);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
}

async function unmount(): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

test("no selected preset shows the default-order picker and can choose a valid preset", async () => {
  reset();
  await mount(chatWith(null));
  try {
    expect(getCalls).toHaveLength(0);
    expect(host.textContent).toContain("RoleCall's default order");
    expect(presetTabMeta(chatWith(null), null)).toBe("None chosen");
    await click("Test Preset");
    expect(changed.at(-1)?.preset).toEqual({ kind: "preset", id: "p1", toggles: {}, samplers: {} });
  } finally { await unmount(); }
});

test("unknown saved kind keeps the strict error and lets the person choose a valid preset or none", async () => {
  reset();
  getEntity = async () => { throw new ApiHttpError(400, "invalid entity kind"); };
  const invalid = chatWith({ kind: "futurewriting", id: "old", toggles: {}, samplers: {} });
  await mount(invalid);
  try {
    expect(host.textContent).toContain("invalid entity kind");
    expect(presetTabMeta(invalid, null)).toBe("Not loaded");
    await click("Test Preset");
    expect(setCalls).toEqual([{ chatId: "chat1", preset: { kind: "preset", id: "p1", toggles: {}, samplers: {} } }]);
  } finally { await unmount(); }

  reset();
  getEntity = async () => { throw new ApiHttpError(400, "invalid entity kind"); };
  await mount(invalid);
  try {
    expect(host.textContent).toContain("invalid entity kind");
    await click("Run Without Preset");
    expect(setCalls).toEqual([{ chatId: "chat1", preset: null }]);
  } finally { await unmount(); }
});

test("gone and unreadable saved presets keep distinct errors and offer recovery", async () => {
  reset();
  getEntity = async () => { throw new ApiHttpError(404, "not found"); };
  await mount(chatWith({ kind: "preset", id: "gone", toggles: {}, samplers: {} }));
  try {
    expect(host.textContent).toContain("Preset Unavailable");
    await click("Run Without Preset");
    expect(setCalls).toEqual([{ chatId: "chat1", preset: null }]);
  } finally { await unmount(); }

  reset();
  getEntity = async () => { throw new ApiHttpError(500, "disk"); };
  await mount(chatWith({ kind: "preset", id: "p1", toggles: {}, samplers: {} }));
  try {
    expect(host.textContent).toContain("Could not load");
    expect(host.textContent).toContain("disk");
    expect(host.textContent).not.toContain("Unavailable");
    expect(host.textContent).toContain("Run Without Preset");
  } finally { await unmount(); }
});
