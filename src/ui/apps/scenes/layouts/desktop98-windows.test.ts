/** VAUDEVILLE window-state contract: bounds, resize, focus, taskbar and restore survive the port. */
import { describe, expect, it } from "bun:test";
import { clampDesktop98Bounds, createDesktop98WindowState, desktop98VisibleBounds, desktop98WindowReducer, resizeDesktop98Bounds, type Desktop98ResizeEdge } from "./desktop98-windows";

const viewport = { width: 1280, height: 800 };
describe("Desktop 98 window ownership", () => {
  it("reopens one canonical window while retaining bounds and increasing focus", () => {
    let state = createDesktop98WindowState(viewport);
    state = desktop98WindowReducer(state, { type: "open", id: "settings", viewport });
    state = desktop98WindowReducer(state, { type: "bounds", id: "settings", bounds: { x: 250, y: 110, width: 600, height: 420 }, viewport });
    state = desktop98WindowReducer(state, { type: "close", id: "settings" });
    expect(state.activeId).toBe("chat");
    expect(state.windows.find(window => window.id === "settings")?.open).toBe(false);
    state = desktop98WindowReducer(state, { type: "open", id: "settings", viewport });
    expect(state.windows).toHaveLength(2);
    expect(state.activeId).toBe("settings");
    expect(state.windows[1]!.bounds).toEqual({ x: 250, y: 110, width: 600, height: 420 });
  });

  it("minimizes to the taskbar and focuses the last visible window", () => {
    let state = desktop98WindowReducer(createDesktop98WindowState(viewport), { type: "open", id: "regex", viewport });
    state = desktop98WindowReducer(state, { type: "open", id: "trackers", viewport });
    state = desktop98WindowReducer(state, { type: "minimize", id: "trackers" });
    expect(state.activeId).toBe("regex");
    expect(state.windows[2]!).toMatchObject({ open: true, minimized: true });
    state = desktop98WindowReducer(state, { type: "open", id: "trackers", viewport });
    expect(state.activeId).toBe("trackers");
    expect(state.windows[2]!.minimized).toBe(false);
  });

  it("maximizes without destroying the user's restore geometry", () => {
    const state = createDesktop98WindowState(viewport);
    const maximized = desktop98WindowReducer(state, { type: "maximize", id: "chat" });
    expect(desktop98VisibleBounds(maximized.windows[0]!, viewport)).toEqual({ x: 0, y: 0, width: 1280, height: 762 });
    const restored = desktop98WindowReducer(maximized, { type: "maximize", id: "chat" });
    expect(restored.windows[0]!.bounds).toEqual(state.windows[0]!.bounds);
  });

  it("bounds dragging and resizing inside the usable desktop", () => {
    expect(clampDesktop98Bounds({ x: -100, y: 900, width: 1500, height: 40 }, viewport)).toEqual({ x: 0, y: 582, width: 1280, height: 180 });
    expect(clampDesktop98Bounds({ x: 900, y: 900, width: 560, height: 580 }, { width: 390, height: 640 })).toEqual({ x: 0, y: 22, width: 390, height: 580 });
  });

  it("uses the full mobile viewport above the taskbar", () => {
    const state = createDesktop98WindowState(viewport);
    expect(desktop98VisibleBounds(state.windows[0]!, { width: 390, height: 620 })).toEqual({ x: 0, y: 0, width: 390, height: 582 });
  });

  it("cannot focus closed windows or create duplicate focus state", () => {
    let state = desktop98WindowReducer(createDesktop98WindowState(viewport), { type: "open", id: "tools", viewport });
    state = desktop98WindowReducer(state, { type: "close", id: "tools" });
    expect(desktop98WindowReducer(state, { type: "focus", id: "tools" })).toBe(state);
    expect(desktop98WindowReducer(state, { type: "focus", id: "chat" })).toBe(state);
  });

  it.each<[Desktop98ResizeEdge, { x: number; y: number; width: number; height: number }]>([
    ["n", { x: 200, y: 180, width: 600, height: 370 }],
    ["ne", { x: 200, y: 180, width: 620, height: 370 }],
    ["e", { x: 200, y: 150, width: 620, height: 400 }],
    ["se", { x: 200, y: 150, width: 620, height: 430 }],
    ["s", { x: 200, y: 150, width: 600, height: 430 }],
    ["sw", { x: 220, y: 150, width: 580, height: 430 }],
    ["w", { x: 220, y: 150, width: 580, height: 400 }],
    ["nw", { x: 220, y: 180, width: 580, height: 370 }],
  ])("resizes %s with the opposite edges anchored", (edge, expected) => {
    expect(resizeDesktop98Bounds({ x: 200, y: 150, width: 600, height: 400 }, edge, 20, 30, viewport)).toEqual(expected);
  });

  it("keeps opposite corners anchored at minimum size and viewport limits", () => {
    const start = { x: 200, y: 150, width: 600, height: 400 };
    expect(resizeDesktop98Bounds(start, "nw", 2000, 2000, viewport)).toEqual({ x: 520, y: 370, width: 280, height: 180 });
    expect(resizeDesktop98Bounds(start, "nw", -2000, -2000, viewport)).toEqual({ x: 0, y: 0, width: 800, height: 550 });
    expect(resizeDesktop98Bounds(start, "se", -2000, -2000, viewport)).toEqual({ x: 200, y: 150, width: 280, height: 180 });
    expect(resizeDesktop98Bounds(start, "se", 2000, 2000, viewport)).toEqual({ x: 200, y: 150, width: 1080, height: 612 });
  });
});
