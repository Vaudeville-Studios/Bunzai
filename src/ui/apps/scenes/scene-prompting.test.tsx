/**
 * The Prompting wing's tabs as they mount (scene-prompting.tsx): Guides and Scene Note beside Preset.
 * Pure rules are proven in guides-core.test.ts; this proves the state around them - the scene's own
 * switches reaching the store as patches, a new guide saved from the editor, and the note's one-second
 * save with its flush when the tab closes.
 *
 * Typing is not simulated (see scene-preset-wing.test.tsx's header): a field's real onChange is called
 * straight off its React props, which runs the same handler a keystroke would.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { GuideInput, GuideRecord } from "../../../core/guide-record";
import type { Chat, ChatPromptingPatch } from "../../../stage/contracts/chat-store";
import { installDom, type InstalledDom, flushTasks, waitFor } from "../../_shared/test-dom";


let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8321/",
    pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "SVGElement", "Event", "CustomEvent"],
    boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) }
  });
  dom = installed.dom;
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
});
afterAll(() => installed.teardown());

const guide = (id: string, over: Partial<GuideRecord> = {}): GuideRecord => ({
  id, title: id, content: `text ${id}`, type: "guide", category: "situational", role: "user", mode: "standard", depth: null, target: null, side: null, visible: true, createdAt: 1, updatedAt: 1, ...over,
});
const LIBRARY = [guide("Slow burn"), guide("Think first", { category: "thinking", mode: "depth", depth: 2 }), guide("Weld", { category: "rules", mode: "macro", target: "persona", side: "append" })];
const cast = { character: { id: "c1", version: 1, name: "Char" } } as Chat["cast"];
const chatWith = (prompting?: Chat["prompting"]): Chat => ({ id: "chat1", title: "Scene", cast, activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1, ...(prompting ? { prompting } : {}) });

let patches: ChatPromptingPatch[] = [];
let saved: (GuideInput & { id?: string })[] = [];
let changed: Chat[] = [];
let statuses: string[] = [];
let library: GuideRecord[] = [];
beforeEach(() => { installed.reinstall(); patches = []; saved = []; changed = []; statuses = []; library = [...LIBRARY]; });

const ctx = (): AppContext => ({
  api: {
    listEntities: async () => [],
    listGuides: async () => library,
    saveGuide: async (g: GuideInput & { id?: string }) => {
      saved.push(g);
      const record = guide(g.id ?? "new-1", { ...g, createdAt: 2, updatedAt: 2 });
      library = [...library.filter((x) => x.id !== record.id), record];
      return record;
    },
    deleteGuide: async () => ({ deleted: true }),
    setScenePrompting: async (_id: string, patch: ChatPromptingPatch) => {
      patches.push(patch);
      return chatWith({ ...(patch.guides ? { guides: patch.guides } : {}), ...(patch.note ? { note: patch.note } : {}) });
    },
  },
  workbench: { open: () => undefined },
  prefs: { get: () => undefined, set: () => undefined },
  setStatus: (text: string) => { statuses.push(text); },
  openApp: () => undefined,
} as unknown as AppContext);

let root: Root;
let host: HTMLElement;
let mounted = false;
const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll("button")];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? "").includes(t));
const byLabel = (t: string) => buttons().find((b) => (b.getAttribute("aria-label") ?? "").includes(t));
const text = () => host.textContent ?? "";
type FlushSync = typeof import("react-dom")["flushSync"];
const settle = async (flushSync: FlushSync, ms = 30) => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };

afterEach(async () => {
  if (!mounted) return;
  const { flushSync } = await import("react-dom");
  flushSync(() => root.unmount());
  host.remove();
  mounted = false;
});

async function mount(chat: Chat): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { PromptingWing } = await import("./scene-prompting");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
  flushSync(() => root.render(<PromptingWing ctx={ctx()} chat={chat} presetBody={null} onChanged={(c) => changed.push(c)} onBody={() => undefined} />));
  await settle(flushSync);
  return flushSync;
}
const press = async (flushSync: FlushSync, b: HTMLButtonElement | undefined, ms = 30) => { flushSync(() => b!.click()); await settle(flushSync, ms); };
function typeInto(flushSync: FlushSync, el: Element, value: string): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
  const onChange = (el as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!.onChange;
  flushSync(() => onChange({ target: { value } }));
}

describe("the tabs", () => {
  test("Preset, Guides with its active count, and Scene Note with RoleCall's fixed line", async () => {
    const flushSync = await mount(chatWith({ guides: ["Slow burn", "Weld", "gone"], note: { text: "Tense.", position: "in_chat", depth: 4, frequency: 2 } }));
    const tabs = [...host.querySelectorAll(".tabs button")].map((b) => b.textContent);
    expect(tabs).toEqual(["PresetNone chosen", "Guides2 active", "Scene NoteOngoing direction", "Writing Tools"]);
    await press(flushSync, byText("Scene Note"));
    expect(text()).toContain("Persistent prompt guidance");
  });
});

describe("the Guides tab", () => {
  test("lists guides by category with counts and a pill for each mode, and the active count in the header", async () => {
    const flushSync = await mount(chatWith({ guides: ["Think first"] }));
    await press(flushSync, byText("Guides"));
    expect(text()).toContain("Guides · 1 active");
    expect([...host.querySelectorAll(".pg-cat")].map((c) => c.textContent)).toEqual(["Situational1", "Thinking1", "Rules1"]);
    expect([...host.querySelectorAll(".pg-pill")].map((c) => c.textContent)).toEqual(["Std", "Depth", "Macro"]);
    expect(byLabel("Use Think first")!.getAttribute("aria-checked")).toBe("true");
    expect(byLabel("Use Slow burn")!.getAttribute("aria-checked")).toBe("false");
  });

  test("a row's switch patches only the scene's guides, in the order switched on, and the search narrows the list", async () => {
    const flushSync = await mount(chatWith({ guides: ["Think first"] }));
    await press(flushSync, byText("Guides"));
    await press(flushSync, byLabel("Use Slow burn"));
    expect(patches).toEqual([{ guides: ["Think first", "Slow burn"] }]);
    expect(changed).toHaveLength(1);
    await press(flushSync, byLabel("Use Think first"));
    expect(patches.at(-1)).toEqual({ guides: ["Slow burn"] });
    typeInto(flushSync, host.querySelector("input[aria-label='Search guides']")!, "weld");
    expect([...host.querySelectorAll(".pg-row [data-control='button']")].map((t) => t.textContent)).toEqual(["Weld"]);
  });

  test("two switches made before the first save has landed both stay on", async () => {
    const flushSync = await mount(chatWith());
    const c = ctx();
    const setScenePrompting = (c.api as unknown as { setScenePrompting: (id: string, p: ChatPromptingPatch) => Promise<Chat> }).setScenePrompting;
    (c.api as unknown as { setScenePrompting: typeof setScenePrompting }).setScenePrompting = async (id, patch) => { await flushTasks(); return setScenePrompting(id, patch); };
    const { PromptingWing } = await import("./scene-prompting");
    flushSync(() => root.render(<PromptingWing ctx={c} chat={chatWith()} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
    await press(flushSync, byText("Guides"));
    flushSync(() => byLabel("Use Slow burn")!.click());
    flushSync(() => byLabel("Use Weld")!.click());
    await settle(flushSync, 200);
    expect(patches).toEqual([{ guides: ["Slow burn"] }, { guides: ["Slow burn", "Weld"] }]);
  });

  test("New Guide opens the editor, and Save sends RoleCall's defaults with what was typed and opens the saved guide", async () => {
    const flushSync = await mount(chatWith());
    await press(flushSync, byText("Guides"));
    await press(flushSync, byText("New Guide"));
    expect(text()).toContain("Placement");
    typeInto(flushSync, host.querySelector("input[aria-label='Guide name']")!, "Night watch");
    typeInto(flushSync, host.querySelector("textarea[aria-label='Guide content']")!, "Mind the lamp.");
    await press(flushSync, byText("Append"));
    await press(flushSync, byText("Save"), 60);
    expect(saved).toEqual([{ title: "Night watch", content: "Mind the lamp.", type: "guide", category: "situational", role: "user", mode: "append", depth: 0, target: null, side: null, visible: true }]);
    expect([...host.querySelectorAll(".pg-row [data-control='button']")].map((t) => t.textContent)).toContain("Night watch");
    expect((host.querySelector("input[aria-label='Guide name']") as HTMLInputElement).value).toBe("Night watch");
  });

  test("a guide with no name or no text is refused by the library and the reason shows, with nothing lost", async () => {
    const flushSync = await mount(chatWith());
    const c = ctx();
    (c.api as unknown as { saveGuide: () => Promise<never> }).saveGuide = async () => { throw new Error("Please enter a title for your guide"); };
    const { PromptingWing } = await import("./scene-prompting");
    flushSync(() => root.render(<PromptingWing ctx={c} chat={chatWith()} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
    await press(flushSync, byText("Guides"));
    await press(flushSync, byText("New Guide"));
    await press(flushSync, byText("Save"), 60);
    expect(text()).toContain("Please enter a title for your guide");
    expect(host.querySelector(".pg-editor")).not.toBeNull();
  });
});

describe("the Scene Note tab", () => {
  test("shows RoleCall's defaults, and a change is saved one second later as one patch", async () => {
    const flushSync = await mount(chatWith());
    await press(flushSync, byText("Scene Note"));
    expect(byText("Every turn")!.getAttribute("aria-pressed")).toBe("true");
    expect(byText("In Chat History")!.getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("Injected before the last 5 chat messages");
    await press(flushSync, byText("Every 2nd"), 100);
    expect(text()).toContain("Unsaved");
    expect(patches).toEqual([]);
    await settle(flushSync, 1_100);
    expect(patches).toEqual([{ note: { text: "", position: "in_chat", depth: 4, frequency: 2 } }]);
    expect(text()).not.toContain("Unsaved");
  });

  test("leaving the tab inside the second still saves what was typed", async () => {
    const flushSync = await mount(chatWith());
    await press(flushSync, byText("Scene Note"));
    typeInto(flushSync, host.querySelector("textarea[aria-label='Note content']")!, "Keep it tense.");
    await press(flushSync, byText("After Scenario"), 50);
    expect(patches).toEqual([]);
    await press(flushSync, byText("Guides"), 50);
    expect(patches).toEqual([{ note: { text: "Keep it tense.", position: "after_scenario", depth: 4, frequency: 1 } }]);
  });

  test("the depth control is only there for an in-chat note, and a saved note comes back as it was", async () => {
    const flushSync = await mount(chatWith({ note: { text: "Hold.", position: "after_scenario", depth: 6, frequency: 3 } }));
    await press(flushSync, byText("Scene Note"));
    expect(host.querySelector("input[aria-label='Injection depth']")).toBeNull();
    expect((host.querySelector("textarea[aria-label='Note content']") as HTMLTextAreaElement).value).toBe("Hold.");
    expect(byText("Every 3rd")!.getAttribute("aria-pressed")).toBe("true");
    await press(flushSync, byText("In Chat History"));
    expect((host.querySelector("input[aria-label='Injection depth']") as HTMLInputElement).value).toBe("6");
  });

  test("a save that fails says so and keeps the change pending", async () => {
    const flushSync = await mount(chatWith());
    const c = ctx();
    (c.api as unknown as { setScenePrompting: () => Promise<never> }).setScenePrompting = async () => { throw new Error("offline"); };
    const { PromptingWing } = await import("./scene-prompting");
    flushSync(() => root.render(<PromptingWing ctx={c} chat={chatWith()} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
    await press(flushSync, byText("Scene Note"));
    await press(flushSync, byText("Every 4th"), 100);
    await settle(flushSync, 1_100);
    expect(text()).toContain("Couldn't save Scene Note. Your changes are still pending.");
    expect(text()).toContain("Unsaved");
  });

  test("leaving the tab while a save fails is said on the status line, not swallowed", async () => {
    const flushSync = await mount(chatWith());
    const c = ctx();
    (c.api as unknown as { setScenePrompting: () => Promise<never> }).setScenePrompting = async () => { throw new Error("offline"); };
    const { PromptingWing } = await import("./scene-prompting");
    flushSync(() => root.render(<PromptingWing ctx={c} chat={chatWith()} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
    await press(flushSync, byText("Scene Note"));
    await press(flushSync, byText("Every 4th"), 50);
    expect(statuses).toEqual([]);
    await press(flushSync, byText("Guides"), 50);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toContain("Couldn't save Scene Note. Your changes are still pending.");
    expect(statuses[0]).toContain("offline");
  });

  test("a save that fails while the tab is open says so inline and on the status line", async () => {
    const flushSync = await mount(chatWith());
    const c = ctx();
    (c.api as unknown as { setScenePrompting: () => Promise<never> }).setScenePrompting = async () => { throw new Error("offline"); };
    const { PromptingWing } = await import("./scene-prompting");
    flushSync(() => root.render(<PromptingWing ctx={c} chat={chatWith()} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
    await press(flushSync, byText("Scene Note"));
    await press(flushSync, byText("Every 4th"), 100);
    await waitFor(flushSync, () => text().includes("Couldn't save Scene Note.") && statuses.length === 1, "Scene Note save error and status");
    expect(text()).toContain("Couldn't save Scene Note.");
    expect(statuses).toHaveLength(1);
  });
});
