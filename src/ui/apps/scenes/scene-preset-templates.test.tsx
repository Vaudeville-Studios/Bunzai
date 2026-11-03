/**
 * The preset's system prompts as the Prompting wing shows them: the Preset tab's Templates section
 * (RoleCall's eight always-listed fields, collapsed, "empty" or "~N") and the Writing Tools tab's
 * prompt editors, which edit the same fields through the wing's one text writer. Mounted as
 * PromptingWing, since the writer lives there.
 *
 * Typing is not simulated (see scene-preset-wing.test.tsx's header): a field's real onChange is called
 * straight off its React props, and a bubbling 'focusout' stands for leaving the field.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { PresetBody, PresetPrompt } from "../../../entities/preset/schema";
import type { Chat } from "../../../stage/contracts/chat-store";
import { countText } from "../../../core/tokens";
import { installDom, type InstalledDom } from "../../_shared/test-dom";


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
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 240 : 200; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return this.className === "side-list" ? 400 : 40; } });
});
afterAll(() => installed.teardown());

const block = (id: string): PresetPrompt => ({
  id, name: id, content: `content-${id}`, role: "system", enabled: true, systemPrompt: true, marker: false,
  placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false,
});
const bodyWith = (systemPrompts?: PresetBody["systemPrompts"]): PresetBody => ({ name: "Test Preset", prompts: [block("main")], groups: [], samplers: {}, ...(systemPrompts ? { systemPrompts } : {}) });
const cast = { character: { id: "c1", version: 1, name: "Char" } } as Chat["cast"];
const withPreset: Chat = { id: "chat1", title: "Scene", cast, activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1, preset: { kind: "preset", id: "p1", toggles: {}, samplers: {} } };

let body: PresetBody;
let saves: { body: PresetBody; revision: string }[] = [];
beforeEach(() => { installed.reinstall(); body = bodyWith(); saves = []; });

const ctx = (): AppContext => ({
  api: {
    listEntities: async () => [],
    listGuides: async () => [],
    getEditableEntity: async () => ({ entity: { kind: "preset", id: "p1", body }, revision: "r1" }),
    saveEditedEntity: async (ent: { body: PresetBody }, revision: string) => {
      saves.push({ body: ent.body, revision });
      body = ent.body;
      return { revision: `r${String(saves.length + 1)}` };
    },
  },
  workbench: { open: () => undefined },
  prefs: { get: () => undefined, set: () => undefined },
  setStatus: () => undefined,
  openApp: () => undefined,
} as unknown as AppContext);

let root: Root;
let host: HTMLElement;
type FlushSync = typeof import("react-dom")["flushSync"];
const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll("button")];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? "").includes(t));
const text = () => host.textContent ?? "";
const settle = async (flushSync: FlushSync, ms = 30) => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };
const press = async (flushSync: FlushSync, b: HTMLButtonElement | undefined) => { flushSync(() => b!.click()); await settle(flushSync); };

async function mount(chat: Chat = withPreset): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { PromptingWing } = await import("./scene-prompting");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<PromptingWing ctx={ctx()} chat={chat} presetBody={null} onChanged={() => undefined} onBody={() => undefined} />));
  await settle(flushSync);
  return flushSync;
}
function typeInto(flushSync: FlushSync, el: Element, value: string): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"))!;
  const onChange = (el as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!.onChange;
  flushSync(() => onChange({ target: { value } }));
}
const blurOut = (flushSync: FlushSync, el: Element) => flushSync(() => el.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
const LABELS = ["Impersonation Prompt", "New Chat Prompt", "New Group Chat Prompt", "New Example Chat Prompt", "Continue Nudge Prompt", "Group Nudge Prompt", "Assistant Prefill", "Assistant Impersonation"];

describe("the Preset tab's Templates section", () => {
  test("is collapsed, counts the configured fields, and lists all eight, each empty, when opened", async () => {
    const flushSync = await mount();
    const header = byText("Templates")!;
    expect(header.textContent).toContain("0/8");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(text()).not.toContain("Impersonation Prompt");
    await press(flushSync, header);
    const rows = [...host.querySelectorAll(".tpl-item [data-control='disclosure']")];
    expect(rows.map((r) => r.querySelector("[data-slot='label']")!.textContent)).toEqual(LABELS);
    expect(rows.every((r) => r.querySelector("[data-slot='meta']")!.textContent === "empty")).toBe(true);
  });

  test("a filled field shows its token estimate and is counted; Behavior is not drawn", async () => {
    body = bodyWith({ impersonation: "Write as me.", continueNudge: "Go on." });
    const flushSync = await mount();
    const header = byText("Templates")!;
    expect(header.textContent).toContain("2/8");
    await press(flushSync, header);
    const meta = (label: string) => [...host.querySelectorAll(".tpl-item [data-control='disclosure']")].find((r) => r.textContent!.includes(label))!.querySelector("[data-slot='meta']")!.textContent;
    expect(meta("Impersonation Prompt")).toBe(`~${String(countText("Write as me."))}`);
    expect(meta("New Chat Prompt")).toBe("empty");
    expect(text()).not.toContain("Behavior");
  });

  test("editing a field and leaving it saves that one system prompt to the preset", async () => {
    const flushSync = await mount();
    await press(flushSync, byText("Templates"));
    await press(flushSync, byText("Group Nudge Prompt"));
    const area = host.querySelector<HTMLTextAreaElement>("textarea[aria-label='Group Nudge Prompt text']")!;
    typeInto(flushSync, area, "[Only {{char}} replies.]");
    blurOut(flushSync, area);
    await settle(flushSync, 40);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.revision).toBe("r1");
    expect(saves[0]!.body.systemPrompts).toEqual({ groupNudge: "[Only {{char}} replies.]" });
    expect(saves[0]!.body.prompts).toEqual(bodyWith().prompts);
  });

  test("the prompt search narrows the fields, and says when none match", async () => {
    const flushSync = await mount();
    await press(flushSync, byText("Templates"));
    const search = host.querySelector("input[aria-label='Search prompts']")!;
    typeInto(flushSync, search, "nudge");
    expect([...host.querySelectorAll(".tpl-item [data-slot='label']")].map((n) => n.textContent)).toEqual(["Continue Nudge Prompt", "Group Nudge Prompt"]);
    typeInto(flushSync, search, "zzz");
    expect(text()).toContain("No templates match search");
  });
});


describe("the Writing Tools tab", () => {
  const noPreset: Chat = { ...withPreset, preset: undefined };
  const tab = () => byText("Writing Tools");
  const area = (label: string) => host.querySelector<HTMLTextAreaElement>(`textarea[aria-label='${label} text']`);

  test("is the fourth tab with no meta, opens on RoleCall's heading, and lists the tools that are built", async () => {
    const flushSync = await mount();
    expect([...host.querySelectorAll(".tabs button")].map((b) => b.textContent)).toEqual(["PresetNot loaded", "Guides0 active", "Scene NoteOngoing direction", "Writing Tools"]);
    await press(flushSync, tab());
    expect(text()).toContain("Your turn helpers");
    expect(text()).toContain("Every tool that rewrites a reply or drafts yours, with the prompt it uses. The \"+\" menu and message menu run these same tools.");
    expect([...host.querySelectorAll(".wt-group > [data-control='disclosure']")].map((h) => h.textContent)).toEqual(["Change the reply4 tools", "Write in character1 tool", "Your draft1 tool"]);
    expect([...host.querySelectorAll(".wt-tool .wt-name")].map((n) => n.textContent)).toEqual(["Regenerate", "Guided re-roll", "Continue", "Correct", "Expand as character"]);
    expect(text()).toContain("The prompts stay saved in the preset. This tab edits the same fields as Preset, so the two never disagree.");
  });

  test("Continue names its prompt, where it is used, and edits the same field the Preset tab's Templates does", async () => {
    const flushSync = await mount();
    await press(flushSync, tab());
    expect(text()).toContain("Uses this prompt: Continue Nudge Prompt · saved in your preset");
    expect(text()).toContain("Used when the model cannot take a started reply");
    await press(flushSync, byText("Continue Nudge Prompt"));
    typeInto(flushSync, area("Continue Nudge Prompt")!, "[Go on.]");
    await press(flushSync, host.querySelector<HTMLButtonElement>(".tabs button")!);
    expect(saves.at(-1)!.body.systemPrompts).toEqual({ continueNudge: "[Go on.]" });
    await press(flushSync, byText("Templates"));
    expect([...host.querySelectorAll(".tpl-item [data-control='disclosure']")].find((r) => r.textContent!.includes("Continue Nudge"))!.querySelector("[data-slot='meta']")!.textContent).toBe(`~${String(countText("[Go on.]"))}`);
    await press(flushSync, byText("Continue Nudge Prompt"));
    typeInto(flushSync, area("Continue Nudge Prompt")!, "[Go on, softly.]");
    await press(flushSync, tab());
    await press(flushSync, byText("Continue Nudge Prompt"));
    expect(area("Continue Nudge Prompt")!.value).toBe("[Go on, softly.]");
  });

  test("without a preset it says to choose one, and a tool with no preset field shows none (Your draft starts closed)", async () => {
    const flushSync = await mount(noPreset);
    await press(flushSync, tab());
    expect(text()).toContain("Choose a preset to edit this prompt.");
    expect(host.querySelectorAll("textarea")).toHaveLength(0);
    expect(text().match(/Uses this prompt/g)).toHaveLength(2);
  });

  test("every tool's prompt is readable: a collapsed What this sends opens to the request's own words", async () => {
    const flushSync = await mount();
    await press(flushSync, tab());
    const sends = [...host.querySelectorAll(".wt-tool")].map((t) => t.querySelector<HTMLButtonElement>("[data-part='scene.prompting.tools.sends']")!);
    expect(sends).toHaveLength(5);
    expect(sends.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false", "false", "false"]);
    expect(host.querySelectorAll(".wt-sends-text")).toHaveLength(0);
    await press(flushSync, sends[2]);
    expect(host.querySelector(".wt-sends-text")!.textContent).toContain("Continue from the preceding assistant message.");
    await press(flushSync, sends[4]);
    expect(host.textContent).toContain("Write in third person, by name.");
  });

  test("a group opens and closes", async () => {
    const flushSync = await mount();
    await press(flushSync, tab());
    await press(flushSync, host.querySelector<HTMLButtonElement>(".wt-group > [data-control='disclosure']")!);
    expect(host.querySelectorAll(".wt-tool")).toHaveLength(1);
  });
});
