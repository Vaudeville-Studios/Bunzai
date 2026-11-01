/**
 * Stage lights: the saved choice (and Reduce motion) decides what LightRays draws. Off mounts nothing, Still starts the renderer
 * for one frame, Moving starts it animated; Reduce motion turns Moving into Still and never turns Off back on.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SETTING_KEYS, parseSettings } from "../../../studio/settings-shape";
import { installDom, type InstalledDom } from "../../_shared/test-dom";

const realStart = (await import("./renderer")).startLightRays; // kept so the mock below can be undone for the other test files
const calls: { followMouse: boolean; animate: boolean | undefined }[] = [];
mock.module("./renderer", () => ({
  startLightRays: (_canvas: HTMLCanvasElement, followMouse: boolean, _influence: number, _fog: boolean, animate?: boolean) => { calls.push({ followMouse, animate }); return () => {}; },
}));
const { LightRays } = await import("./index");
const { useShellStore } = await import("../../shell/store");

const settingsBefore = useShellStore.getState().settings;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterAll(async () => { await installed.teardown(); useShellStore.setState({ settings: settingsBefore }); mock.module("./renderer", () => ({ startLightRays: realStart })); });
beforeEach(() => { calls.length = 0; });

async function mount(settings: Record<string, unknown>): Promise<{ host: HTMLElement; unmount(): Promise<void> }> {
  useShellStore.setState({ settings: parseSettings(settings) });
  const host = document.createElement("div");
  document.body.append(host);
  const tree = createRoot(host);
  await act(async () => { tree.render(<LightRays />); });
  return { host, unmount: async () => { await act(async () => tree.unmount()); host.remove(); } };
}

const key = SETTING_KEYS.uiStageLights;

test("Moving (and nothing saved) draws animated rays that follow the pointer", async () => {
  for (const settings of [{}, { [key]: "moving" }]) {
    calls.length = 0;
    const view = await mount(settings);
    expect(view.host.querySelector("canvas")).not.toBeNull();
    expect(calls).toEqual([{ followMouse: true, animate: true }]);
    await view.unmount();
  }
});

test("Still draws one frame with no animation", async () => {
  const view = await mount({ [key]: "still" });
  expect(view.host.querySelector("canvas")).not.toBeNull();
  expect(calls).toEqual([{ followMouse: true, animate: false }]);
  await view.unmount();
});

test("Off renders nothing and never starts the renderer", async () => {
  const view = await mount({ [key]: "off" });
  expect(view.host.innerHTML).toBe("");
  expect(calls).toEqual([]);
  await view.unmount();
});

test("Reduce motion holds Moving to Still and leaves Off off", async () => {
  const reduced = await mount({ [SETTING_KEYS.uiReduceMotion]: true });
  expect(calls).toEqual([{ followMouse: true, animate: false }]);
  await reduced.unmount();
  calls.length = 0;
  const off = await mount({ [SETTING_KEYS.uiReduceMotion]: true, [key]: "off" });
  expect(off.host.innerHTML).toBe("");
  expect(calls).toEqual([]);
  await off.unmount();
});
