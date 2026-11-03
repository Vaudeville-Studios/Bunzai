/** The Prompt Inspector shows the parameters going out with the request, read-only, and never a header's value. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, type InstalledDom } from "../../_shared/test-dom";
import type { Review } from "./use-scene-turn";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8321/", pretendToBeVisual: true, extraGlobals: ["HTMLInputElement", "HTMLTextAreaElement", "Event"] });
  dom = installed.dom;
});
afterAll(() => installed.teardown());

async function shown(review: Review) {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { PromptInspector } = await import("./scene-inspector");
  dom.window.document.body.replaceChildren();
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  flushSync(() => createRoot(host).render(<PromptInspector review={review} onAnswer={async () => undefined} />));
  return dom.window.document.body.querySelector<HTMLTextAreaElement>('[data-part="scene.inspector.params"] textarea');
}
const base: Review = { turnId: "t", messages: [{ role: "user", content: "hi" }], tokens: 3 };

test("lists what is sent under its wire name, what is not and why, and the custom text with header names only", async () => {
  const box = await shown({ ...base, params: { sent: { random_seed: 7 }, notSent: [{ id: "tfs", why: "unsupported" }], customBody: '{"a": 1}', customHeaderNames: ["x-secret"] } });
  const text = JSON.parse(box!.value) as Record<string, unknown>;
  expect(text["sent"]).toEqual({ random_seed: 7 });
  expect(text["notSent"]).toEqual(["tfs: this provider does not take it"]);
  expect(text["custom"]).toEqual({ headers: ["x-secret"], body: '{"a": 1}' });
  expect(box!.readOnly).toBe(true);
});

test("a request with nothing extra shows no section", async () => {
  expect(await shown({ ...base, params: { sent: {}, notSent: [] } })).toBeNull();
  expect(await shown(base)).toBeNull();
});

test("a media-bearing review labels its token count as an incomplete text estimate", async () => {
  await shown({ ...base, mediaEstimateIncomplete: true, files: [{ message: 0, name: "reference.pdf", kind: "pdf" }] });
  expect(dom.window.document.body.textContent).toContain("This text estimate excludes image and PDF token costs.");
});

test("500 messages mount fewer than 60 editable rows", async () => {
  await shown({ ...base, messages: Array.from({ length: 500 }, (_, i) => ({ role: "user" as const, content: `message ${String(i)}` })) });
  const rows = dom.window.document.body.querySelectorAll(".pi-msg").length;
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(60);
});
