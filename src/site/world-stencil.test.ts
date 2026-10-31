/** The source image remains available if motion is reduced or the stencil renderer fails. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { sitePages } from "./pages";
import { createWorldStencil } from "./world-stencil";

function fixture(reduced = false, forced = false) {
  const dom = new JSDOM(sitePages([])[0]!.html, { pretendToBeVisual: true });
  const win = dom.window;
  const motion = new win.EventTarget(), forcedColors = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.assign(forcedColors, { matches: forced });
  Object.defineProperty(win, "matchMedia", { value: (query: string) => query.includes("forced-colors") ? forcedColors : motion });
  return {
    dom,
    win,
    motion,
    canvas: win.document.querySelector<HTMLCanvasElement>("[data-preroll-world-stencil]")!,
    image: win.document.querySelector<HTMLImageElement>('[data-preroll-world="oz"]')!,
  };
}

test("forced colors keeps the original story plate and skips GPU masking", async () => {
  const f = fixture(false, true);
  let contextRequests = 0;
  f.win.HTMLCanvasElement.prototype.getContext = (() => { contextRequests++; return null; }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const stencil = createWorldStencil(f.canvas, f.image);
  expect(await stencil.prepare()).toBe(false);
  stencil.activate();
  expect(stencil.ready()).toBe(false);
  expect(contextRequests).toBe(0);
  expect(f.image.hidden).toBe(false);
  stencil.stop();
  f.dom.window.close();
});

test("reduced motion leaves the selected world image as the only visible picture", async () => {
  const f = fixture(true);
  const originalSrc = f.image.getAttribute("src");
  let contextRequests = 0;
  f.win.HTMLCanvasElement.prototype.getContext = (() => { contextRequests++; return null; }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const stencil = createWorldStencil(f.canvas, f.image);
  stencil.activate();
  stencil.refresh();
  expect(await stencil.prepare()).toBe(false);
  expect(stencil.ready()).toBe(false);
  expect(contextRequests).toBe(0);
  expect(f.image.getAttribute("src")).toBe(originalSrc);
  expect(f.image.hidden).toBe(false);
  stencil.stop();
  f.dom.window.close();
});

test("WebGL failure leaves the source image visible and the stencil canvas transparent", async () => {
  const f = fixture();
  const originalSrc = f.image.getAttribute("src");
  const originalStyle = f.canvas.getAttribute("style");
  f.win.HTMLCanvasElement.prototype.getContext = (() => { throw new Error("WebGL unavailable"); }) as typeof f.win.HTMLCanvasElement.prototype.getContext;
  const originalError = console.error;
  console.error = () => {};
  try {
    const stencil = createWorldStencil(f.canvas, f.image);
    stencil.activate();
    stencil.refresh();
    expect(await stencil.prepare()).toBe(false);
    expect(stencil.ready()).toBe(false);
    expect(f.image.getAttribute("src")).toBe(originalSrc);
    expect(f.image.hidden).toBe(false);
    expect(f.canvas.getAttribute("style")).toBe(originalStyle);
    stencil.stop();
  } finally {
    console.error = originalError;
    f.dom.window.close();
  }
});
