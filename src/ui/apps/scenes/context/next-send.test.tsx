/** Next send (rc-parity 08): RoleCall's PromptPreviewPanel over the forecast, and the hook that asks for it after a pause in typing. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import type { AppContext } from "../../../app-contract";
import type { SceneForecast } from "../../../app-contract-scenes";
import type { Chat } from "../../../../stage/contracts/chat-store";
import type { ForecastState } from "./use-forecast";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/", extraGlobals: ["MouseEvent", "Event", "InputEvent"] });
  dom = installed.dom;
});
afterAll(() => installed.teardown());

const forecast: SceneForecast = {
  messages: [{ role: "system", content: "Be Vera, who keeps the light.", tokens: 8 }, { role: "user", content: "Any storms?", tokens: 4 }],
  tokens: 14, window: { context: 8000, reply: 1000, stated: true }, model: "m", notes: ["Prompt regex runs when you send; this forecast shows the request before it."],
};
const settle = async (ms = 15): Promise<void> => { const { flushSync } = await import("react-dom"); await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };

async function mountView(state: ForecastState): Promise<{ host: HTMLElement; done(): void }> {
  const [{ flushSync }, { createRoot }, { NextSend }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./next-send")]);
  const el = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() => root.render(<NextSend state={state} />));
  return { host: el, done: () => flushSync(() => root.unmount()) };
}
const click = async (el: Element | null | undefined): Promise<void> => { const { flushSync } = await import("react-dom"); flushSync(() => (el as HTMLElement).click()); };
const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  const { flushSync } = await import("react-dom");
  const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => { set.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
};

describe("Next send", () => {
  test("nothing typed: RoleCall's two lines, and Copy is off", async () => {
    const m = await mountView({ forecast: null, loading: false, error: null });
    expect(m.host.textContent).toContain("Type a message to see preview");
    expect(m.host.textContent).toContain("Type a message to see the preview");
    expect(m.host.textContent).toContain("Preview updates in real-time as you type");
    expect((m.host.querySelector(".ns-hd button") as HTMLButtonElement).disabled).toBe(true);
    m.done();
  });
  test("the forecast: the count line, a block per message with its role and the assembler's count, the footer and what it leaves out", async () => {
    const m = await mountView({ forecast, loading: false, error: null });
    expect(m.host.querySelector(".ns-hd p")?.textContent).toBe("2 messages | ~14 tokens");
    expect([...m.host.querySelectorAll(".ns-msg > div")].map((d) => d.textContent)).toEqual(["system~8 tokens", "user~4 tokens"]);
    expect(m.host.textContent).toContain("This is an assembly forecast and may change before dispatch.");
    expect(m.host.textContent).toContain("Prompt regex runs when you send");
    m.done();
  });
  test("attached files remain named and an incomplete image/PDF estimate is explicit", async () => {
    const m = await mountView({ forecast: { ...forecast, files: [
      { message: 1, name: "notes.txt", kind: "text", owner: "Reference" },
      { message: 2, name: "cover.png", kind: "image", owner: "Reference" },
      { message: 3, name: "brief.pdf", kind: "pdf", owner: "Reference" },
    ], mediaEstimateIncomplete: true }, loading: false, error: null });
    expect(m.host.textContent).toContain("Reference: notes.txt (text)");
    expect(m.host.textContent).toContain("Reference: cover.png (image)");
    expect(m.host.textContent).toContain("Reference: brief.pdf (pdf)");
    expect(m.host.textContent).toContain("Image and PDF token costs are not included in the text estimate.");
    m.done();
  });
  test("500 messages mount fewer than 60 blocks", async () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({ role: "user" as const, content: `message ${String(i)}`, tokens: 3 }));
    const m = await mountView({ forecast: { ...forecast, messages }, loading: false, error: null });
    const blocks = m.host.querySelectorAll(".ns-msg").length;
    expect(blocks).toBeGreaterThan(0);
    expect(blocks).toBeLessThan(60);
    m.done();
  });
  test("a new forecast being built shows Updating... over the last one", async () => {
    const m = await mountView({ forecast, loading: true, error: null });
    expect(m.host.querySelector(".ns-upd")?.textContent).toBe("Updating...");
    expect(m.host.querySelectorAll(".ns-msg")).toHaveLength(2);
    m.done();
  });
  test("an error is the Preview Error state with the server's words", async () => {
    const m = await mountView({ forecast: null, loading: false, error: "this scene has no connection" });
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain("Preview Error");
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain("this scene has no connection");
    m.done();
  });
  test("search keeps the blocks whose role or text match, marks the match, counts them, and says so when none do", async () => {
    const m = await mountView({ forecast, loading: false, error: null });
    await type(m.host.querySelector('[aria-label="Search role or content"]') as HTMLInputElement, "storm");
    expect(m.host.querySelectorAll(".ns-msg")).toHaveLength(1);
    expect(m.host.querySelector("mark")?.textContent).toBe("storm");
    expect(m.host.textContent).toContain("Showing 1 of 2 messages");
    await type(m.host.querySelector('[aria-label="Search role or content"]') as HTMLInputElement, "zzz");
    expect(m.host.textContent).toContain("No matches found");
    await click(m.host.querySelector('[aria-label="Clear search"]'));
    expect(m.host.querySelectorAll(".ns-msg")).toHaveLength(2);
    m.done();
  });
  test("Copy puts RoleCall's format on the clipboard and reads Copied!", async () => {
    const copied: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (t: string) => { copied.push(t); } }, configurable: true });
    const m = await mountView({ forecast, loading: false, error: null });
    await click(m.host.querySelector(".ns-hd button"));
    await settle();
    expect(copied[0]).toBe("[SYSTEM]\nBe Vera, who keeps the light.\n\n---\n\n[USER]\nAny storms?\n");
    expect(m.host.querySelector(".ns-hd button")?.textContent).toBe("Copied!");
    m.done();
  });
});

describe("useForecast", () => {
  async function probe(draft: string, on: boolean, ask: (draft: string, signal?: AbortSignal) => Promise<SceneForecast>): Promise<{ read(): ForecastState; done(): void }> {
    const [{ flushSync }, { createRoot }, { useForecast }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./use-forecast")]);
    let latest!: ForecastState;
    const ctx = { api: { getSceneForecast: (_id: string, d: string, s?: AbortSignal) => ask(d, s) } } as unknown as AppContext;
    const chat = { id: "c1", updatedAt: 1, activeBranchId: "b1" } as unknown as Chat;
    function Probe(): null { latest = useForecast(ctx, chat, draft, on, 5); return null; }
    const el = dom.window.document.createElement("div");
    const root = createRoot(el);
    flushSync(() => root.render(<Probe />));
    return { read: () => latest, done: () => flushSync(() => root.unmount()) };
  }
  test("asks once after the pause, with the draft, and holds the answer", async () => {
    const asked: string[] = [];
    const p = await probe("Any storms?", true, async (d) => { asked.push(d); return forecast; });
    await settle(40);
    expect(asked).toEqual(["Any storms?"]);
    expect(p.read()).toEqual({ forecast, loading: false, error: null });
    p.done();
  });
  test("asks nothing for an empty draft or while its tab is not showing", async () => {
    const asked: string[] = [];
    const ask = async (d: string) => { asked.push(d); return forecast; };
    let p = await probe("   ", true, ask);
    await settle(40);
    p.done();
    p = await probe("Hi", false, ask);
    await settle(40);
    expect(p.read()).toEqual({ forecast: null, loading: false, error: null });
    p.done();
    expect(asked).toEqual([]);
  });
  test("a refusal becomes the error line and no forecast", async () => {
    const p = await probe("Hi", true, async () => { throw new Error("this scene has no connection"); });
    await settle(40);
    expect(p.read()).toEqual({ forecast: null, loading: false, error: "this scene has no connection" });
    p.done();
  });
});
