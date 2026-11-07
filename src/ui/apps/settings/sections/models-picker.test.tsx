/** Model setup rejects a late list for an older endpoint, even when the provider kind stays the same. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Root } from "react-dom/client";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import section from "./models";

let installed: InstalledDom;
let root: Root | null = null;
const pending: { body: { baseURL?: string }; resolve(response: Response): void }[] = [];
let fixtureKinds: Record<string, unknown>[] = [];
const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (String(input).endsWith("/models")) return new Promise((resolve) => pending.push({ body: JSON.parse(String(init?.body)), resolve }));
  return Response.json({ providers: [], kinds: [...fixtureKinds, { id: "ollama", label: "Ollama", keyless: true, needsBaseUrl: true, defaultBaseURL: "http://localhost:11434", defaultModel: "llama3.1" }] });
};
beforeAll(() => { installed = installDom('<!doctype html><head><meta name="vaude-session" content="fixture"></head><body></body>', { url: "http://127.0.0.1:8333/", extraGlobals: ["Event", "HTMLElement", "HTMLInputElement", "HTMLSelectElement"], globals: { fetch } }); });
afterAll(() => installed.teardown());
beforeEach(() => installed.reinstall());
afterEach(async () => { const { flushSync } = await import("react-dom"); if (root) flushSync(() => root!.unmount()); root = null; for (const request of pending.splice(0)) request.resolve(Response.json({ models: [] })); });

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 150; i++) { if (check()) return; await Bun.sleep(10); }
  throw new Error("the fixture did not reach its expected UI state");
}

async function mount(firstLookup = true) {
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const doc = installed.dom.window.document;
  const host = doc.createElement("div"); doc.body.append(host); root = createRoot(host);
  const Section = section.Component;
  flushSync(() => root!.render(<Section ctx={{ setStatus: () => undefined } as never} />));
  const add = () => [...doc.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add a provider");
  await until(() => !!add() && !add()!.disabled);
  flushSync(() => add()!.click());
  if (firstLookup) await until(() => pending.length === 1);
  return { doc, flushSync };
}

function changeURL(doc: Document, value: string): void {
  const field = [...doc.querySelectorAll("label")].find((label) => label.textContent?.trim().startsWith("Base URL"))!.querySelector("input")!;
  Object.getOwnPropertyDescriptor(installed.dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new installed.dom.window.Event("input", { bubbles: true }));
}

test("the latest Base URL owns the picker when an older same-kind lookup finishes last", async () => {
  const { doc, flushSync } = await mount();
  flushSync(() => changeURL(doc, "http://second:11434"));
  await until(() => pending.length === 2);
  expect(pending[1]!.body.baseURL).toBe("http://second:11434");
  pending[1]!.resolve(Response.json({ models: [{ id: "beta", label: "Beta endpoint" }] }));
  await until(() => !![...doc.querySelectorAll("option")].find((option) => option.value === "beta"));
  pending[0]!.resolve(Response.json({ models: [{ id: "alpha", label: "Older endpoint" }] }));
  await Bun.sleep(10);
  expect([...doc.querySelectorAll("option")].some((option) => option.value === "beta")).toBe(true);
  expect([...doc.querySelectorAll("option")].some((option) => option.value === "alpha")).toBe(false);
});

test("a failed lookup is visible, and a successful new endpoint clears that failure", async () => {
  const { doc, flushSync } = await mount();
  pending[0]!.resolve(Response.json({ error: "offline" }, { status: 502 }));
  await until(() => doc.body.textContent!.includes("Could not load this provider's models"));
  flushSync(() => changeURL(doc, "http://second:11434"));
  await until(() => pending.length === 2);
  pending[1]!.resolve(Response.json({ models: [{ id: "beta", label: "Beta endpoint" }] }));
  await until(() => [...doc.querySelectorAll("option")].some((option) => option.value === "beta"));
  expect(doc.body.textContent).not.toContain("Could not load this provider's models");
});

test("saving closes the form and cancels its pending model lookup", async () => {
  const { doc, flushSync } = await mount();
  const save = [...doc.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save")!;
  flushSync(() => save.click());
  await until(() => ![...doc.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Save"));
  pending[0]!.resolve(Response.json({ error: "late failure" }, { status: 502 }));
  await Bun.sleep(10);
  expect(doc.body.textContent).not.toContain("Could not load this provider's models");
});

function typeInto(doc: Document, label: string, value: string): void {
  const field = [...doc.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(label))!.querySelector("input")!;
  Object.getOwnPropertyDescriptor(installed.dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new installed.dom.window.Event("input", { bubbles: true }));
}

test("a provider that needs a key asks nothing and offers no model until the key is in, then lists with that key", async () => {
  fixtureKinds = [{ id: "router", label: "Router", keyless: false, needsBaseUrl: false }];
  try {
    const { doc, flushSync } = await mount(false);
    await Bun.sleep(20);
    expect(pending.length).toBe(0);
    expect(doc.body.textContent).not.toContain("Default model");
    expect(doc.body.textContent).not.toContain("Could not load");
    const order = [...doc.querySelectorAll("label")].map((label) => label.firstChild?.textContent).filter((text) => text === "Provider" || text === "API key" || text === "Name (optional)");
    expect(order).toEqual(["Provider", "API key", "Name (optional)"]);
    flushSync(() => typeInto(doc, "API key", "sk-test"));
    await until(() => pending.length === 1);
    expect(pending[0]!.body).toMatchObject({ kind: "router", apiKey: "sk-test" });
    pending[0]!.resolve(Response.json({ models: [{ id: "alpha" }, { id: "beta" }] }));
    await until(() => doc.body.textContent!.includes("2 models available."));
    expect(doc.body.textContent).toContain("Default model");
    expect([...doc.querySelectorAll("option")].some((option) => option.value === "alpha")).toBe(true);
  } finally { fixtureKinds = []; }
});

test("a server with no model list says so and still takes a typed model", async () => {
  const { doc } = await mount();
  pending[0]!.resolve(Response.json({ models: [], manual: true }));
  await until(() => doc.body.textContent!.includes("This server doesn't list its models."));
  expect(doc.body.textContent).toContain("Default model");
});
