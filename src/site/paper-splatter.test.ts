/** Verify the symbol burst is deterministic, bounded, stoppable, and preference-aware. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { createPaperSplatter } from "./paper-splatter";

function fixture(reduced = false, forced = false) {
  const dom = new JSDOM("<canvas></canvas>", { pretendToBeVisual: true });
  const win = dom.window;
  const canvas = win.document.querySelector("canvas")!;
  win.document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 240, width: 240, height: 240, toJSON() {} });
  const calls: Array<[string, ...number[]]> = [];
  const context = {
    fillStyle: "#000",
    setTransform: (...args: number[]) => calls.push(["transform", ...args]),
    clearRect: (...args: number[]) => calls.push(["clear", ...args]),
    save: () => {}, restore: () => {}, translate: () => {}, rotate: (angle: number) => calls.push(["rotate", angle]), beginPath: () => {},
    moveTo: (...args: number[]) => calls.push(["move", ...args]),
    lineTo: (...args: number[]) => calls.push(["line", ...args]),
    closePath: () => {}, fill: () => calls.push(["fill"]),
  };
  win.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof win.HTMLCanvasElement.prototype.getContext;
  const motion = new win.EventTarget(), colors = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.assign(colors, { matches: forced });
  Object.defineProperty(win, "matchMedia", { value: (query: string) => query.includes("forced-colors") ? colors : motion });
  return { dom, win, canvas, calls, motion, colors };
}

test("fixed seed draws separated leftward shards and clear permits the next burst", () => {
  const f = fixture();
  const splatter = createPaperSplatter(f.canvas);
  splatter.burst({ seed: 23, main: "rgb(220, 70, 50)", shadow: "rgb(80, 20, 35)" });
  const first = f.calls.filter(([kind]) => kind === "move" || kind === "line");
  expect(f.calls.filter(([kind]) => kind === "fill")).toHaveLength(10);
  expect(first.length).toBeGreaterThanOrEqual(30);
  expect(first.length).toBeLessThanOrEqual(40);
  expect(f.calls.filter(([kind]) => kind === "rotate").every(([, angle]) => Math.cos(angle!) < 0)).toBe(true);
  splatter.clear();
  expect(f.calls.at(-1)?.[0]).toBe("clear");
  splatter.burst({ seed: 23, main: "rgb(220, 70, 50)", shadow: "rgb(80, 20, 35)" });
  const paths = f.calls.filter(([kind]) => kind === "move" || kind === "line").slice(first.length);
  expect(paths).toEqual(first);
  splatter.stop();
  expect(f.canvas.width * f.canvas.height).toBeLessThanOrEqual(500_000);
  f.dom.window.close();
});

test("reduced motion and forced colors omit the burst", () => {
  for (const f of [fixture(true), fixture(false, true)]) {
    const splatter = createPaperSplatter(f.canvas);
    splatter.burst({ seed: 1, main: "#f00", shadow: "#900" });
    expect(f.calls.filter(([kind]) => kind === "fill")).toHaveLength(0);
    splatter.stop();
    f.dom.window.close();
  }
});
