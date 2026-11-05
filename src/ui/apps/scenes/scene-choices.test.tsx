/**
 * The Preset tab's Choices row and walkthrough (RoleCall's ChoiceGroupsSection and ChoiceWalkthroughModal): hidden without groups, a
 * one-time offer, a stepper that saves every pick and blocks Next until a group is satisfied, and a summary that jumps back.
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { PresetBody } from "../../../entities/preset/schema";
import type { Chat, ChoicePick } from "../../../stage/contracts/chat-store";
import { resolveSelections } from "../../../core/macros/choice-groups";
import { PRESET_CHOICE_DEFAULTS_KEY, defaultsFor, toChoiceGroups, withDefaults } from "../../../core/preset/choices";
import { installRigDom, props, rig, settle, type FlushSync } from "./fake-scene-page-rig";
import { waitFor } from "../../_shared/test-dom";

const click = (flushSync: FlushSync, el: Element): void => { flushSync(() => props(el)["onClick"]!({ stopPropagation: () => undefined, shiftKey: false })); };
import { ChoicesRow } from "./scene-choices";
import type { SceneChoices } from "./use-scene-choices";

beforeAll(installRigDom);

const body: PresetBody = {
  name: "Heist", description: "Read this first.",
  prompts: [{ id: "pa", name: "Alpha prompt", content: "ALPHA TEXT" }] as PresetBody["prompts"],
  choices: [
    { id: "tone", label: "Tone", type: "one", default: "dark", options: [{ id: "dark", label: "Dark", enablesPrompts: ["pa"] }, { id: "light", label: "Light" }] },
    { id: "cast", label: "Cast", type: "many", min: 2, default: ["x", "y"], options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }, { id: "z", label: "Z" }] },
  ],
};
const chat = { id: "chat1", title: "t", cast: { character: { id: "v", version: 1 } }, activeBranchId: "b1", createdAt: 1, updatedAt: 1, snapshotVersion: 1, preset: { kind: "preset", id: "preset1", toggles: {}, samplers: {} } } as Chat;

let prefs: Map<string, unknown>;
let picks: Record<string, ChoicePick>;
let saved: [string, ChoicePick][];
beforeEach(() => { prefs = new Map(); picks = {}; saved = []; });

const ctx = (): AppContext => ({ prefs: { get: (k: string) => prefs.get(k), set: (k: string, v: unknown) => { prefs.set(k, v); } } }) as unknown as AppContext;
const choicesOf = (b: PresetBody, withSaved = false): SceneChoices => {
  const groups = toChoiceGroups(b.choices);
  return { groups, selections: resolveSelections(groups, withSaved ? withDefaults(defaultsFor(prefs.get(PRESET_CHOICE_DEFAULTS_KEY), "preset1"), picks) : picks), error: null, select: async (id, v) => { saved.push([id, v]); picks = { ...picks, [id]: v }; } };
};

async function mount(b: PresetBody = body, withSaved = false): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  const render = (): void => flushSync(() => rig.root.render(createElement(ChoicesRow, { ctx: ctx(), chat, body: b, choices: choicesOf(b, withSaved) })));
  (globalThis as Record<string, unknown>)["__rerender"] = render;
  render();
  await settle(flushSync);
  return flushSync;
}
const doc = (): Document => rig.dom.window.document;
const unmount = (flushSync: FlushSync): void => { flushSync(() => rig.root.unmount()); rig.host.remove(); doc().body.querySelectorAll(".ch-modal,.ch-offer").forEach((e) => e.closest("[role=dialog]")?.remove()); };
const button = (label: string): HTMLButtonElement => [...doc().querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
const rerender = (): void => (globalThis as unknown as { __rerender(): void }).__rerender();

describe("the Choices row", () => {
  test("a preset with no groups shows nothing", async () => {
    const flushSync = await mount({ ...body, choices: [] });
    expect(rig.host.textContent).toBe("");
    unmount(flushSync);
  });

  test("it counts the groups that differ from their default, and offers the walkthrough once", async () => {
    picks = { tone: "light" };
    const flushSync = await mount();
    expect(rig.host.textContent).toContain("1 of 2 customized");
    expect(doc().body.textContent).toContain("This preset has options and a guided walkthrough. Set it up now?");
    expect(prefs.get("scenes.choiceOffered.chat1.preset1")).toBe(true);
    click(flushSync, button("Use defaults"));
    unmount(flushSync);
    const again = await mount();
    expect(doc().body.textContent).not.toContain("Set it up now?");
    unmount(again);
  });
});

describe("the walkthrough", () => {
  test("opens on the about step, saves each pick as it is made, never lets a select_many fall below its minimum, and ends on a summary that can jump back", async () => {
    prefs.set("scenes.choiceOffered.chat1.preset1", true);
    const flushSync = await mount();
    click(flushSync, button("Open walkthrough"));
    expect(doc().body.textContent).toContain("About this preset");
    expect(doc().body.textContent).toContain("Read this first.");
    click(flushSync, button("Next"));
    expect(doc().body.textContent).toContain("Question 1 of 2");
    // peeking at the block an option names shows its text without picking it
    click(flushSync, button("View prompt"));
    expect(doc().body.textContent).toContain("ALPHA TEXT");
    expect(saved).toEqual([]);
    click(flushSync, [...doc().querySelectorAll<HTMLElement>("[role=radio]")].find((r) => r.textContent?.includes("Light"))!);
    expect(saved).toEqual([["tone", "light"]]);
    await waitFor(flushSync, () => doc().body.textContent?.includes("Question 2 of 2"), "the walkthrough to advance to question 2");
    expect(doc().body.textContent).toContain("Question 2 of 2");
    const boxes = [...doc().querySelectorAll<HTMLElement>("[role=checkbox]")];
    click(flushSync, boxes.find((r) => r.textContent?.includes("Y"))!);
    expect(saved.at(-1)).toEqual(["cast", ["x"]]);
    // an answer below the minimum cannot stand, so the declared default is what is in effect (RoleCall resolveSelections)
    rerender();
    expect([...doc().querySelectorAll<HTMLElement>("[role=checkbox]")].map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    click(flushSync, button("Next"));
    expect(doc().body.textContent).toContain("All set");
    expect(doc().body.textContent).toContain("Light");
    click(flushSync, [...doc().querySelectorAll("button")].filter((b) => b.textContent === "Change")[0]!);
    expect(doc().body.textContent).toContain("Question 1 of 2");
    click(flushSync, button("Skip - keep defaults"));
    expect(doc().body.textContent).not.toContain("Question 1 of 2");
    unmount(flushSync);
  });
});

describe("the person's saved defaults", () => {
  test("a scene that never answered shows the saved default for a group, and its own answer wins", async () => {
    prefs.set("scenes.choiceOffered.chat1.preset1", true);
    prefs.set("scenes.presetChoiceDefaults", { preset1: { tone: "light" }, other: { tone: "dark" } });
    const flushSync = await mount(body, true);
    expect(rig.host.textContent).toContain("1 of 2 customized");
    unmount(flushSync);
    picks = { tone: "dark" };
    const again = await mount(body, true);
    expect(rig.host.textContent).toContain("0 of 2 customized");
    unmount(again);
  });

  test("the last step says Save & done, and saving keeps the run's answers as the person's defaults for the preset, leaving other presets alone", async () => {
    prefs.set("scenes.choiceOffered.chat1.preset1", true);
    prefs.set("scenes.presetChoiceDefaults", { other: { tone: "dark" } });
    picks = { tone: "light" };
    const flushSync = await mount(body, true);
    click(flushSync, button("Open walkthrough"));
    for (let i = 0; i < 3; i++) click(flushSync, button("Next"));
    expect(doc().body.textContent).toContain("All set");
    expect(prefs.get("scenes.presetChoiceDefaults")).toEqual({ other: { tone: "dark" } });
    click(flushSync, button("Save & done"));
    expect(prefs.get("scenes.presetChoiceDefaults")).toEqual({ other: { tone: "dark" }, preset1: { tone: "light", cast: ["x", "y"] } });
    expect(doc().body.textContent).not.toContain("All set");
    unmount(flushSync);
  });
});
