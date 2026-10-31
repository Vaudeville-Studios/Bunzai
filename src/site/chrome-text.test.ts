/** Keep the preroll phrase visible when WebGL is unavailable or motion is reduced. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { sitePages } from "./pages";
import { createChromeText } from "./chrome-text";

function fixture(reduced = false, forced = false) {
  const dom = new JSDOM(sitePages([])[0]!.html, { pretendToBeVisual: true });
  const win = dom.window;
  const motion = new win.EventTarget(), forcedColors = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.assign(forcedColors, { matches: forced });
  Object.defineProperty(win, "matchMedia", { value: (query: string) => query.includes("forced-colors") ? forcedColors : motion });
  const canvas = win.document.querySelector<HTMLCanvasElement>("[data-preroll-chrome]")!;
  const source = win.document.querySelector<HTMLElement>("[data-preroll-word]")!;
  return { dom, win, motion, canvas, source };
}

test("forced colors leaves the system-readable DOM phrase uncovered", () => {
  const f = fixture(false, true);
  let contextRequests = 0;
  f.win.HTMLCanvasElement.prototype.getContext = (() => { contextRequests++; return null; }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const chrome = createChromeText(f.canvas, f.source);
  chrome.pulse();
  expect(contextRequests).toBe(0);
  expect(f.source.textContent).toBe("A STAGE");
  chrome.stop();
  f.dom.window.close();
});

test("reduced motion keeps the accessible phrase and never asks for WebGL", () => {
  const f = fixture(true);
  const word = f.source.textContent;
  const originalStyle = f.canvas.getAttribute("style");
  let contextRequests = 0;
  f.win.HTMLCanvasElement.prototype.getContext = (() => { contextRequests++; return null; }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const chrome = createChromeText(f.canvas, f.source);
  chrome.refresh();
  chrome.pulse();
  chrome.stop();
  chrome.stop();
  expect(contextRequests).toBe(0);
  expect(f.source.textContent).toBe(word);
  expect(f.source.hidden).toBe(false);
  expect(f.canvas.getAttribute("style")).toBe(originalStyle);
  f.dom.window.close();
});

test("WebGL construction failure leaves the real DOM text as the visible fallback", () => {
  const f = fixture();
  const word = f.source.textContent;
  const originalStyle = f.canvas.getAttribute("style");
  f.win.HTMLCanvasElement.prototype.getContext = (() => { throw new Error("WebGL unavailable"); }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const originalError = console.error;
  console.error = () => {};
  try {
    const chrome = createChromeText(f.canvas, f.source);
    chrome.refresh();
    chrome.pulse();
    chrome.stop();
    expect(f.source.textContent).toBe(word);
    expect(f.source.hidden).toBe(false);
    expect(f.source.getAttribute("data-tone")).toBe("rose");
    expect(f.canvas.getAttribute("style")).toBe(originalStyle);
  } finally {
    console.error = originalError;
    f.dom.window.close();
  }
});
