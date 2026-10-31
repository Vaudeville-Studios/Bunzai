/** Verify the recovered screen animation advances only in active, motion-enabled view. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { sitePages } from "./pages";
import { runScreenPreroll } from "./preroll";

function fixture(reduced = false) {
  const dom = new JSDOM(sitePages([])[0]!.html, { pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
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
  return { dom, win, doc, motion, advance, root: doc.querySelector<HTMLElement>("[data-screen-preroll]")! };
}

test("screen film runs the production card, NOBUNNY title, accelerated word run and exact Bunzai tagline", () => {
  const f = fixture();
  let completed = 0;
  runScreenPreroll(f.doc, () => { completed++; });
  const cards = () => f.root.querySelector<HTMLElement>(".screen-preroll-card.is-current")!.dataset.prerollCard;
  expect(cards()).toBe("production");
  f.advance(5000);
  expect(cards()).toBe("presents");
  f.advance(5000);
  expect(cards()).toBe("words");
  expect(f.root.querySelector("[data-preroll-word]")!.textContent).toBe("A STAGE");
  f.advance(2400);
  expect(f.root.querySelector("[data-preroll-word]")!.textContent).toBe("A STORY");
  for (let elapsed = 0; elapsed < 40000 && f.root.querySelector<HTMLElement>("[data-preroll-tagline]")!.hidden; elapsed += 100) f.advance(100);
  expect(f.root.querySelector<HTMLElement>("[data-preroll-tagline]")!.hidden).toBe(false);
  expect(f.root.querySelector("[data-preroll-tagline]")!.textContent).toBe("All the worlds: your stage");
  f.advance(2600);
  expect(completed).toBe(1);
  expect(f.root.hidden).toBe(true);
  let replayCompleted = 0;
  runScreenPreroll(f.doc, () => { replayCompleted++; });
  expect(f.root.hidden).toBe(false);
  expect(cards()).toBe("production");
  expect(f.root.querySelector<HTMLElement>("[data-preroll-prefix]")!.hidden).toBe(false);
  expect(f.root.querySelector<HTMLElement>("[data-preroll-word]")!.textContent).toBe("A STAGE");
  expect(f.root.querySelector<HTMLElement>("[data-preroll-tagline]")!.hidden).toBe(true);
  f.root.querySelector<HTMLButtonElement>("[data-preroll-skip]")!.click();
  expect(replayCompleted).toBe(1);
  f.dom.window.close();
});

test("hidden tabs pause the screen film and reduced motion skips to the feature picture", () => {
  const f = fixture();
  let completed = 0;
  runScreenPreroll(f.doc, () => { completed++; });
  Object.defineProperty(f.doc, "hidden", { value: true, configurable: true });
  f.doc.dispatchEvent(new f.win.Event("visibilitychange"));
  f.advance(10000);
  expect(f.root.querySelector<HTMLElement>(".screen-preroll-card.is-current")!.dataset.prerollCard).toBe("production");
  Object.defineProperty(f.doc, "hidden", { value: false, configurable: true });
  f.doc.dispatchEvent(new f.win.Event("visibilitychange"));
  f.advance(5000);
  expect(f.root.querySelector<HTMLElement>(".screen-preroll-card.is-current")!.dataset.prerollCard).toBe("presents");
  f.dom.window.close();
  const reduced = fixture(true);
  let reducedComplete = 0;
  runScreenPreroll(reduced.doc, () => { reducedComplete++; });
  expect(reducedComplete).toBe(1);
  expect(reduced.root.hidden).toBe(true);
  expect(reduced.doc.querySelector("[data-screening-open]")!.textContent).toContain("Begin the showing");
  reduced.dom.window.close();
});
