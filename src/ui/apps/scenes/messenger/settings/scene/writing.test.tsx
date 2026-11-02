/** The Writing page is rows: each reads the stored value and writes through the writer Full Chat uses; tools are drill rows to their program; no wing body is drawn inside. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { teardownAllDoms, waitFor, type InstalledDom } from "../../../../../_shared/test-dom";
import { installSingleDom, mountSingle } from "../../../single-wing-rig";
import { bodyOfSection, control, none, rig, rowOf, setValue, wait, type Rig } from "./fake-scene-rig";
import { stub, withPreset } from "./writing-test-rig";
import { writingCategory } from "./writing";

let installed: InstalledDom;
beforeAll(() => { installed = installSingleDom(8431); });
afterAll(async () => { await teardownAllDoms(); });

const WINGS = ["scene.prompting", "scene.prompting.preset", "scene.prompting.guides", "scene.prompting.note", "scene.prompting.tools", "scene.generation", "scene.generation.params", "scene.ai.models", "scene.ai.picker", "scene.finalcut", "scene.finalcut.regex", "scene.context.memory", "scene.messenger.settings.tool", "scene.messenger.settings.studio"];
const body = (r: Rig, id: string): ReactNode => bodyOfSection(writingCategory(r.a, r.open), id);
const mount = (node: ReactNode): ReturnType<typeof mountSingle> => mountSingle(installed, createElement("div", null, node));
const click = (el: Element): void => (el as HTMLElement).click();
const withOwn = (): Rig => { const r = rig({ chat: { preset: { kind: "preset", id: "p1", toggles: {}, samplers: {} } } as never }); withPreset(r); return r; };
const sentSamplers = (r: Rig, at = 0): Record<string, unknown> => (r.calls["setScenePreset"]?.[at]?.[1] as { samplers: Record<string, unknown> }).samplers;

describe("Writing page", () => {
  test("the sections, in the wireframe's order, with the scene scope's ids", () => {
    const r = rig();
    expect(writingCategory(r.a, r.open).sections.map((s) => s.id)).toEqual(["preset", "samplers", "guides", "note", "helpers", "regex", "final-cut"]);
    expect(writingCategory({ a: r.a, open: r.open }).sections).toHaveLength(7);
  });

  test("the preset select names the preset, the blocks drill counts what is on, the editor opens its program, and a new preset starts clean", async () => {
    const r = withOwn();
    stub(r, "listEntities", (kind) => (kind === "preset" ? [{ id: "p1", kind: "preset", name: "Narrator bank" }, { id: "p2", kind: "preset", name: "Plain" }] : []));
    const m = await mountSingle(installed, createElement("div", null, body(r, "preset")));
    await wait(30);
    expect(control<HTMLSelectElement>(m.host, "Preset").value).toBe("preset:p1");
    expect(rowOf(m.host, "Switch each prompt").textContent).toContain("0 of 0 on");
    click(rowOf(m.host, "What each prompt says"));
    expect(r.opened).toEqual(["prompts"]);
    setValue(control<HTMLSelectElement>(m.host, "Preset"), "preset:p2");
    await wait(30);
    expect(r.calls["setScenePreset"]).toEqual([["c1", { kind: "preset", id: "p2", toggles: {}, samplers: {} }]]);
    none(m.host, ...WINGS);
    m.done();
  });

  test("a sampler reads the scene's value over the preset's and one write carries the change", async () => {
    const r = rig({ chat: { preset: { kind: "preset", id: "p1", toggles: {}, samplers: { temperature: 0.8 } } } as never });
    withPreset(r);
    const m = await mount(body(r, "samplers"));
    try {
      await wait(60);
      const slider = control<HTMLInputElement>(m.host, "Temperature");
      expect(slider.value).toBe("0.8");
      setValue(slider, "0.9");
      await waitFor(flushSync, () => r.calls["setScenePreset"]?.length === 1, "temperature save");
      expect(r.calls["setScenePreset"]).toEqual([["c1", { kind: "preset", id: "p1", toggles: {}, samplers: { temperature: 0.9 } }]]);
      none(m.host, ...WINGS);
    } finally { m.done(); }
  });

  test("Max reply length is a typed number that saves once it rests, within its range", async () => {
    const r = withOwn();
    const m = await mount(body(r, "samplers"));
    try {
      await wait(60);
      setValue(control<HTMLInputElement>(m.host, "Max reply length"), "900");
      await waitFor(flushSync, () => r.calls["setScenePreset"]?.length === 1, "max reply length save");
      expect(sentSamplers(r)["maxTokens"]).toBe(900);
    } finally { m.done(); }
  });

  test("reasoning, start reply with and the thinking switches write the scene's prompting settings", async () => {
    const r = withOwn();
    const m = await mount(body(r, "samplers"));
    try {
      await wait(60);
      setValue(control<HTMLSelectElement>(m.host, "Reasoning effort"), "high");
      click(control(m.host, "Show prefill in chat"));
      click(control(m.host, "Let the model see its old thinking"));
      setValue(control<HTMLTextAreaElement>(m.host, "Start reply with"), "<think>");
      await waitFor(flushSync, () => r.calls["setScenePrompting"]?.length === 4, "reasoning and prefill saves");
      expect(r.calls["setScenePrompting"]).toEqual([["c1", { reasoningEffort: "high" }], ["c1", { showPrefill: true }], ["c1", { keepThinking: true }], ["c1", { prefill: "<think>" }]]);
    } finally { m.done(); }
  });

  test("Catch thinking: Only these starts from the common tags and lists them as switches", async () => {
    const r = withOwn();
    const m = await mount(body(r, "samplers"));
    await wait(60);
    expect(m.host.querySelector('[aria-label="Catch <think>"]')).toBeNull();
    const only = [...m.host.querySelectorAll<HTMLElement>('[aria-label="Catch thinking"] button')].find((b) => b.textContent === "Only these");
    click(only!);
    await wait(30);
    expect((r.calls["setScenePrompting"]?.[0]?.[1] as { capture: { mode: string; builtinTags: string[] } }).capture).toMatchObject({ mode: "only", builtinTags: ["<think>", "<thinking>", "<thought>"] });
    m.done();
  });

  test("a catalogue parameter is a switch with its value row while it is on, and Logit bias leads to the sampler tool", async () => {
    const r = withOwn();
    const m = await mount(body(r, "samplers"));
    try {
      await wait(60);
      expect(m.host.querySelector('[aria-label="Min P value"]')).toBeNull();
      click(control(m.host, "Min P"));
      await waitFor(flushSync, () => r.calls["setScenePreset"]?.length === 1, "Min P save");
      expect((sentSamplers(r)["params"] as Record<string, unknown>)["min_p"]).toEqual({ on: true });
      expect(control<HTMLInputElement>(m.host, "Min P value").value).toBe("0.05");
      click(control(m.host, "Logit Bias"));
      await wait(30);
      click(rowOf(m.host, "Logit bias words"));
      expect(r.opened).toEqual(["sampler"]);
    } finally { m.done(); }
  });

  test("Custom request parameters save only a text that holds up", async () => {
    const r = withOwn();
    const m = await mount(body(r, "samplers"));
    try {
      await wait(60);
      const box = control<HTMLTextAreaElement>(m.host, "Include Request Headers");
      setValue(box, "{nope");
      await wait(900);
      expect(r.calls["setScenePreset"]).toBeUndefined();
      expect(m.host.textContent).toContain("That is not valid JSON");
      setValue(box, "{\"x-trace\": \"on\"}");
      await waitFor(flushSync, () => r.calls["setScenePreset"]?.length === 1, "valid custom request save");
      expect(sentSamplers(r)["customHeaders"]).toBe("{\"x-trace\": \"on\"}");
    } finally { m.done(); }
  });

  test("with no preset the sampler values give way to a link to the preset tool", async () => {
    const r = rig();
    const m = await mount(body(r, "samplers"));
    await wait(30);
    expect(m.host.querySelector('[aria-label="Temperature"]')).toBeNull();
    click(rowOf(m.host, "Sampler values"));
    expect(r.opened).toEqual(["prompts"]);
    m.done();
  });

  test("a guide is a switch per guide on the scene's own list, and the editor is a drill row", async () => {
    const r = rig({ chat: { prompting: { guides: ["g2"] } } as never });
    stub(r, "listGuides", () => [{ id: "g1", title: "Slow burn", category: "situational", mode: "standard", visible: true }, { id: "g2", title: "Show, do not tell", category: "rules", mode: "depth", visible: true }, { id: "g3", title: "Hidden", category: "rules", mode: "standard", visible: false }]);
    const m = await mount(body(r, "guides"));
    await wait(40);
    expect(control(m.host, "Show, do not tell").getAttribute("aria-checked")).toBe("true");
    expect(m.host.querySelector('[aria-label="Hidden"]')).toBeNull();
    click(control(m.host, "Slow burn"));
    await wait(30);
    expect(r.calls["setScenePrompting"]).toEqual([["c1", { guides: ["g2", "g1"] }]]);
    click(rowOf(m.host, "Guide editor"));
    expect(r.opened).toEqual(["guides"]);
    none(m.host, ...WINGS);
    m.done();
  });

  test("the scene note saves its text after a pause, shows depth only in chat, and writes the whole note", async () => {
    const r = rig({ chat: { prompting: { note: { text: "Keep the lamps out.", position: "in_chat", depth: 2, frequency: 1 } } } as never });
    const m = await mount(body(r, "note"));
    expect(control<HTMLTextAreaElement>(m.host, "Note").value).toBe("Keep the lamps out.");
    expect(control<HTMLInputElement>(m.host, "Injection depth").value).toBe("2");
    setValue(control<HTMLTextAreaElement>(m.host, "Note"), "Lamps stay out.");
    await wait(1150);
    expect(r.calls["setScenePrompting"]).toEqual([["c1", { note: { text: "Lamps stay out.", position: "in_chat", depth: 2, frequency: 1 } }]]);
    setValue(control<HTMLSelectElement>(m.host, "Frequency"), "3");
    await wait(30);
    expect(r.calls["setScenePrompting"]?.[1]?.[1]).toMatchObject({ note: { frequency: 3 } });
    m.done();
  });

  test("the writing helpers are drill rows to the Writing Helpers program", async () => {
    const r = rig();
    const m = await mount(body(r, "helpers"));
    click(rowOf(m.host, "Continue"));
    expect(r.opened).toEqual(["writing-tools"]);
    none(m.host, ...WINGS);
    m.done();
  });

  test("a regex script is a switch on the scene's own list, and the workshop is a drill row", async () => {
    const r = rig({ chat: { regex: { sets: ["r2"] } } as never });
    stub(r, "setSceneRegex", () => r.a.scene.chat);
    stub(r, "listEntities", () => [{ id: "r1", kind: "regex", name: "Strip stage directions", facts: { regex: { ruleCount: 2 } } }, { id: "r2", kind: "regex", name: "Hide OOC notes" }]);
    const m = await mount(body(r, "regex"));
    await wait(40);
    expect(control(m.host, "Hide OOC notes").getAttribute("aria-checked")).toBe("true");
    expect(m.host.textContent).toContain("2 rules");
    click(control(m.host, "Strip stage directions"));
    await wait(30);
    expect(r.calls["setSceneRegex"]).toEqual([["c1", { sets: ["r2", "r1"] }]]);
    click(rowOf(m.host, "Regex scripts"));
    expect(r.opened).toEqual(["regex"]);
    none(m.host, ...WINGS);
    m.done();
  });

  test("Final Cut has a master switch and a switch per pass, and the workshop is a drill row", async () => {
    const r = rig();
    stub(r, "setSceneFinalCut", () => r.a.scene.chat);
    const m = await mount(body(r, "final-cut"));
    try {
      expect(control(m.host, "Final Cut").getAttribute("aria-checked")).toBe("false");
      click(control(m.host, "Final Cut"));
      click(control(m.host, "Output safety check"));
      await waitFor(flushSync, () => r.calls["setSceneFinalCut"]?.length === 1, "coalesced Final Cut settings save");
      const sent = r.calls["setSceneFinalCut"]!.at(-1)![1] as { on: boolean; passes: { type: string }[] };
      expect(sent.on).toBe(true);
      expect(sent.passes.map((p) => p.type)).toEqual(["validator"]);
      expect(m.host.querySelector('[aria-label="Also check my messages before send"]')).not.toBeNull();
      click(rowOf(m.host, "Final Cut workshop"));
      expect(r.opened).toEqual(["post-production"]);
      none(m.host, ...WINGS);
    } finally { m.done(); }
  });
});
