/** Public landing entrance checks: click-gated media, motion preference, skip and recovery paths. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { runCurtainIntro } from "./curtain";
import { sitePages } from "./pages";
import { runScreening } from "./screening";

function fixture(reduced = false, blocked = false) {
  const dom = new JSDOM(sitePages([])[0]!.html, { url: "https://example.test/Bunzai/" });
  const win = dom.window;
  const doc = win.document;
  const root = doc.querySelector<HTMLElement>("[data-curtain-intro]")!;
  const video = root.querySelector("video")!;
  const motion = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.defineProperty(win, "matchMedia", { value: () => motion });
  Object.defineProperty(win, "IntersectionObserver", { value: class { observe() {} disconnect() {} } });
  let deadline: (() => void) | undefined, loads = 0, plays = 0, pauses = 0;
  Object.defineProperty(win, "setTimeout", { value: (callback: () => void) => { deadline = callback; return 1; } });
  Object.defineProperty(win, "clearTimeout", { value: () => { deadline = undefined; } });
  video.load = () => { loads++; };
  video.pause = () => { pauses++; };
  video.play = () => { plays++; return blocked ? Promise.reject(new Error("Autoplay blocked")) : Promise.resolve(); };
  return { dom, win, doc, root, video, motion, expire: () => deadline?.(), counts: () => ({ loads, plays, pauses }) };
}

test("the first public frame is Bunzai; begin owns the click-gated curtain and recovered screen sequence", async () => {
  const home = sitePages([])[0]!.html;
  expect(home).toContain("Bunzai | All the worlds: your stage");
  expect(home).toContain("All the worlds: your stage");
  expect(home).toContain("data-curtain-intro hidden");
  expect(home).toContain("data-screen-preroll hidden");
  expect(home).toContain("VAUDEVILLE PRESENTS");
  const f = fixture();
  const intro = runCurtainIntro(f.doc);
  const stopScreening = runScreening(f.doc, intro.start);
  expect(f.root.hidden).toBe(true);
  expect(f.counts()).toEqual({ loads: 0, plays: 0, pauses: 0 });
  f.doc.querySelector<HTMLButtonElement>("[data-screening-open]")!.click();
  expect(f.doc.querySelector(".auditorium")!.getAttribute("data-screening-state")).toBe("entering");
  await Promise.resolve();
  expect(f.root.hidden).toBe(false);
  intro.stop();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(f.doc.querySelector<HTMLElement>("[data-screen-preroll]")!.hidden).toBe(false);
  f.doc.querySelector<HTMLButtonElement>("[data-preroll-skip]")!.click();
  expect(f.doc.querySelector(".screen-slide.is-current")!.getAttribute("data-title")).toBe("Scenes");
  stopScreening();
  f.dom.window.close();
});

test("reduced motion opens directly without loading the curtain film", async () => {
  const f = fixture(true);
  const intro = runCurtainIntro(f.doc);
  await intro.start();
  expect(f.root.hidden).toBe(true);
  expect(f.counts().loads).toBe(0);
  expect(f.doc.querySelector("main")!.inert).not.toBe(true);
  f.dom.window.close();
});

test("video progress drives zoom and reveal; completion restores the page and focus", async () => {
  const f = fixture();
  const intro = runCurtainIntro(f.doc);
  const finished = intro.start();
  expect(f.root.hidden).toBe(false);
  expect(f.doc.querySelector("header")!.inert).toBe(true);
  expect(f.video.muted).toBe(true);
  expect(f.counts().plays).toBe(1);
  f.video.currentTime = 3.8;
  f.video.dispatchEvent(new f.win.Event("timeupdate"));
  expect(f.root.classList.contains("zooming")).toBe(true);
  f.video.currentTime = 5.4;
  f.video.dispatchEvent(new f.win.Event("timeupdate"));
  expect(f.root.classList.contains("revealing")).toBe(true);
  f.video.dispatchEvent(new f.win.Event("ended"));
  await finished;
  expect(f.root.hidden).toBe(true);
  expect(f.doc.querySelector("header")!.inert).not.toBe(true);
  expect(f.doc.querySelector("source")!.hasAttribute("src")).toBe(false);
  expect(f.doc.documentElement.classList.contains("curtain-active")).toBe(false);
  expect(f.counts().pauses).toBe(1);
  f.dom.window.close();
});

test("skip, Escape, media error, timeout and reduced-motion changes cannot strand the page", async () => {
  for (const exit of ["skip", "escape", "error", "timeout", "motion"]) {
    const f = fixture();
    const intro = runCurtainIntro(f.doc);
    const finished = intro.start();
    if (exit === "skip") f.root.querySelector<HTMLButtonElement>("[data-curtain-skip]")!.click();
    if (exit === "escape") f.doc.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "Escape" }));
    if (exit === "error") f.video.dispatchEvent(new f.win.Event("error"));
    if (exit === "timeout") f.expire();
    if (exit === "motion") { Object.assign(f.motion, { matches: true }); f.motion.dispatchEvent(new f.win.Event("change")); }
    await finished;
    expect(f.root.hidden).toBe(true);
    expect(f.doc.documentElement.classList.contains("curtain-active")).toBe(false);
    expect(f.doc.querySelector("header")!.inert).not.toBe(true);
    f.dom.window.close();
  }
});

test("autoplay rejection releases the curtain layer", async () => {
  const f = fixture(false, true);
  const intro = runCurtainIntro(f.doc);
  await intro.start();
  await Promise.resolve();
  expect(f.root.hidden).toBe(true);
  expect(f.doc.querySelector("header")!.inert).not.toBe(true);
  f.dom.window.close();
});
