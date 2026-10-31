/** Cover symbol order, bounded source loading, single-impact timing, and pause/replay behavior. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { sitePages } from "./pages";
import { runScreenPreroll, SCREEN_PREROLL_PHRASES } from "./preroll";

function fixture(reduced = false, failedSlug = "") {
  const dom = new JSDOM(sitePages([])[0]!.html, { pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  win.HTMLCanvasElement.prototype.getContext = (() => null) as typeof win.HTMLCanvasElement.prototype.getContext;
  const createElement = doc.createElement.bind(doc);
  doc.createElement = ((tag: string, options?: ElementCreationOptions): HTMLElement => {
    const element = createElement(tag, options);
    if (tag.toLowerCase() === "img") {
      const image = element as HTMLImageElement;
      let source = "";
      Object.defineProperties(image, {
        complete: { configurable: true, get: () => source.length > 0 },
        naturalWidth: { configurable: true, get: () => source.length > 0 && (!failedSlug || !source.includes(`${failedSlug}-v`)) ? 120 : 0 },
        naturalHeight: { configurable: true, get: () => source.length > 0 && (!failedSlug || !source.includes(`${failedSlug}-v`)) ? 120 : 0 },
        decode: { configurable: true, value: () => Promise.resolve() },
        src: { configurable: true, get: () => source, set: (value: string) => {
          source = value;
          queueMicrotask(() => image.dispatchEvent(new win.Event(failedSlug && source.includes(`${failedSlug}-v`) ? "error" : "load")));
        } },
      });
    }
    return element;
  }) as typeof doc.createElement;
  const symbol = doc.querySelector<HTMLImageElement>("[data-preroll-symbol]")!;
  Object.defineProperties(symbol, {
    complete: { configurable: true, get: () => symbol.hasAttribute("src") },
    naturalWidth: { configurable: true, get: () => symbol.hasAttribute("src") ? 120 : 0 },
    naturalHeight: { configurable: true, get: () => symbol.hasAttribute("src") ? 120 : 0 },
    decode: { configurable: true, value: () => Promise.resolve() },
  });
  let now = 0, nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const motion = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.defineProperty(win, "matchMedia", { value: () => motion });
  Object.defineProperty(win.performance, "now", { value: () => now });
  Object.defineProperty(win, "setTimeout", { value: (callback: () => void, delay = 0) => { const id = ++nextId; timers.set(id, { due: now + delay, callback }); return id; } });
  Object.defineProperty(win, "clearTimeout", { value: (id: number) => { timers.delete(id); } });
  const advance = (milliseconds: number): void => {
    const target = now + milliseconds;
    while (true) {
      const entry = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry || entry[1].due > target) break;
      timers.delete(entry[0]);
      now = entry[1].due;
      entry[1].callback();
    }
    now = target;
  };
  return { dom, win, doc, motion, advance, root: doc.querySelector<HTMLElement>("[data-screen-preroll]")!, symbol };
}

async function flush(): Promise<void> { for (let i = 0; i < 80; i++) await Promise.resolve(); }
async function enterWords(f: ReturnType<typeof fixture>): Promise<void> {
  f.advance(4000);
  await flush();
  f.advance(0);
  await flush();
}

test("the single phrase table maps all 32 lines to distinct props and distinct hard-entry motions", () => {
  expect(SCREEN_PREROLL_PHRASES).toHaveLength(32);
  expect(new Set(SCREEN_PREROLL_PHRASES.map(phrase => phrase.symbol)).size).toBe(32);
  expect(SCREEN_PREROLL_PHRASES.slice(0, 8).map(phrase => phrase.symbol)).toEqual([
    "oz", "harry-potter", "inception", "phantom", "howl-moving-castle", "death-note", "uncharted", "one-piece",
  ]);
  expect(SCREEN_PREROLL_PHRASES[8]).toMatchObject({ text: "BOUNDLESS", tone: "lilac", duration: 1200, symbol: "back-to-future" });
  expect(SCREEN_PREROLL_PHRASES.every(phrase => phrase.duration >= 1000)).toBe(true);
  expect(SCREEN_PREROLL_PHRASES.at(-1)).toMatchObject({ text: "YOURS", tone: "rose", duration: 2200, symbol: "bunzai-logo" });
  expect(new Set(SCREEN_PREROLL_PHRASES.map(phrase => phrase.motion.join("|"))).size).toBe(32);
  expect(SCREEN_PREROLL_PHRASES.every(phrase => phrase.motion[2] >= 90 && phrase.motion[2] <= 180)).toBe(true);
});

test("the film shows one transparent symbol beside intact words and coordinates a single hard entry", async () => {
  const f = fixture();
  const prefix = f.root.querySelector<HTMLElement>("[data-preroll-prefix]")!;
  const word = f.root.querySelector<HTMLElement>("[data-preroll-word]")!;
  const symbolStage = f.root.querySelector<HTMLElement>("[data-preroll-symbol-stage]")!;
  const canvas = f.root.querySelector<HTMLCanvasElement>("[data-preroll-symbol-stencil]")!;
  expect(f.root.querySelectorAll("[data-preroll-symbol]")).toHaveLength(1);
  expect(f.root.querySelector("[data-preroll-chrome], [data-preroll-world], [data-preroll-worlds]")).toBeNull();
  expect(f.root.querySelector("[data-preroll-symbol]")!.hasAttribute("src")).toBe(false);
  let completed = 0;
  runScreenPreroll(f.doc, () => { completed++; });
  await enterWords(f);
  expect(word.textContent).toBe("A STAGE");
  expect(f.symbol.getAttribute("src")).toBe("media/preroll-symbols/oz-v2.webp");
  expect(prefix.textContent).toBe("ALL THE WORLD'S");
  expect(symbolStage.classList.contains("is-stencilled")).toBe(false);
  expect(word.classList.contains("is-changing")).toBe(false);
  f.advance(299);
  expect(symbolStage.classList.contains("is-stencilled")).toBe(false);
  f.advance(1);
  expect(symbolStage.classList.contains("is-stencilled")).toBe(true);
  expect(word.classList.contains("is-changing")).toBe(true);
  expect(word.textContent).toBe("A STAGE");
  expect(word.style.clipPath).toBe("");
  expect(word.style.opacity).toBe("");
  expect(word.style.getPropertyValue("--word-entry-transform")).toBe(SCREEN_PREROLL_PHRASES[0]!.motion[0]);
  expect(word.style.getPropertyValue("--word-entry-duration")).toBe("150ms");
  expect(canvas.hidden).toBe(false);
  f.advance(1299);
  await flush();
  expect(word.textContent).toBe("A STAGE");
  f.advance(1);
  await flush();
  expect(word.textContent).toBe("A STORY");
  expect(f.symbol.getAttribute("src")).toBe("media/preroll-symbols/harry-potter-v2.webp");
  expect(completed).toBe(0);
  f.root.querySelector<HTMLButtonElement>("[data-preroll-skip]")!.click();
  expect(completed).toBe(1);
  f.dom.window.close();
});

test("the final YOURS line uses the existing full-color Bunzai mark without stencil recoloring", async () => {
  const f = fixture();
  runScreenPreroll(f.doc, () => {});
  await enterWords(f);
  for (let i = 0; i < SCREEN_PREROLL_PHRASES.length - 1; i++) {
    f.advance(SCREEN_PREROLL_PHRASES[i]!.duration);
    await flush();
  }
  expect(f.root.querySelector("[data-preroll-word]")!.textContent).toBe("YOURS");
  expect(f.symbol.getAttribute("src")).toBe("media/bunzai-mark.png");
  expect(f.root.querySelector("[data-preroll-symbol-stage]")!.classList.contains("is-logo")).toBe(true);
  expect(f.root.querySelector<HTMLCanvasElement>("[data-preroll-symbol-stencil]")!.hidden).toBe(true);
  expect(f.root.querySelector<HTMLElement>("[data-preroll-tagline]")!.hidden).toBe(true);
  f.dom.window.close();
});

test("hidden tabs pause the symbol reveal hold and reduced motion skips symbol downloads", async () => {
  const f = fixture();
  runScreenPreroll(f.doc, () => {});
  await enterWords(f);
  f.advance(250);
  Object.defineProperty(f.doc, "hidden", { value: true, configurable: true });
  f.doc.dispatchEvent(new f.win.Event("visibilitychange"));
  f.advance(1000);
  expect(f.root.querySelector("[data-preroll-symbol-stage]")!.classList.contains("is-stencilled")).toBe(false);
  Object.defineProperty(f.doc, "hidden", { value: false, configurable: true });
  f.doc.dispatchEvent(new f.win.Event("visibilitychange"));
  f.advance(49);
  expect(f.root.querySelector("[data-preroll-symbol-stage]")!.classList.contains("is-stencilled")).toBe(false);
  f.advance(1);
  expect(f.root.querySelector("[data-preroll-symbol-stage]")!.classList.contains("is-stencilled")).toBe(true);
  f.dom.window.close();
  const reduced = fixture(true);
  let completed = 0;
  runScreenPreroll(reduced.doc, () => { completed++; });
  expect(completed).toBe(1);
  expect(reduced.symbol.hasAttribute("src")).toBe(false);
  reduced.dom.window.close();
});

test("a preloaded symbol error settles promptly and leaves the following phrase available", async () => {
  const f = fixture(false, "oz");
  runScreenPreroll(f.doc, () => {});
  await enterWords(f);
  const progress = f.root.querySelector<HTMLElement>("[data-preroll-progress]")!;
  expect(f.root.querySelector("[data-preroll-word]")!.textContent).toBe("A STAGE");
  expect(progress.textContent).toContain("could not be loaded");
  f.advance(SCREEN_PREROLL_PHRASES[0]!.duration);
  await flush();
  expect(f.root.querySelector("[data-preroll-word]")!.textContent).toBe("A STORY");
  expect(f.symbol.getAttribute("src")).toBe("media/preroll-symbols/harry-potter-v2.webp");
  f.dom.window.close();
});
