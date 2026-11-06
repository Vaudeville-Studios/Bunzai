/**
 * The picker's overlay-darkness and video-speed sliders save once they rest (300 ms). Closing the picker inside
 * that window used to drop the change (dry audit A3): the effect cleanup only cleared the timer. A pending value
 * is now flushed on close, a pick cancels it, and a failed save is shown instead of an unhandled rejection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { useState, type JSX } from "react";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { AppContext } from "../../app-contract";
import type { ChatBackdrop } from "../../../stage/contracts/chat-store";
import { installDom, type InstalledDom, waitFor } from "../../_shared/test-dom";
import { BackdropPicker } from "./scene-backdrop-picker";

let dom: JSDOM;
let installed: InstalledDom;
class NoObserver { observe(): void { /* no layout in jsdom */ } disconnect(): void { /* nothing */ } }
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8324/",
    extraGlobals: ["SVGElement", "Event", "CustomEvent"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0), IntersectionObserver: NoObserver }
  });
  dom = installed.dom;
});
afterAll(() => installed.teardown());
beforeEach(() => { installed.reinstall(); saves = []; fail = false; });

const sentinel = (n: number): string => `\u0000b:u:image/jpeg:${n.toString(16).padStart(64, "0")}`;
const packEntity = { schemaVersion: "1", kind: "pack", id: "st", body: { name: "Backdrops", pack: { items: [{ id: "a", label: "Harbor", ref: sentinel(1) }, { id: "b", label: "Tavern", ref: sentinel(2) }] } } };
const ctx = {
  api: {
    listEntities: async () => [{ id: "st", name: "Backdrops" }],
    getLightEditableEntity: async () => ({ entity: packEntity, revision: "r1" }),
  },
} as unknown as AppContext;

let saves: (ChatBackdrop | null)[] = [];
let fail = false;
let root: Root;
let host: HTMLElement;
type FlushSync = typeof import("react-dom")["flushSync"];
const settle = async (flushSync: FlushSync, ms = 30): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); flushSync(() => undefined); };

/** A parent like the Stage row: it holds the backdrop and hands every pick back down. */
function Harness({ start, closed }: { start: ChatBackdrop; closed: () => void }): JSX.Element {
  const [backdrop, setBackdrop] = useState<ChatBackdrop | undefined>(start);
  return (
    <BackdropPicker ctx={ctx} backdrop={backdrop} onClose={closed}
      onPick={async (next) => {
        if (fail) throw new Error("offline");
        saves.push(next);
        setBackdrop(next ?? undefined);
      }} />
  );
}

async function open(): Promise<FlushSync> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<Harness start={{ pack: "st", item: "a" }} closed={() => undefined} />));
  await settle(flushSync);
  return flushSync;
}
function drag(flushSync: FlushSync, label: string, value: number): void {
  const input = dom.window.document.querySelector(`input[aria-label="${label}"]`)!;
  const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"))!;
  const onChange = (input as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!.onChange;
  flushSync(() => onChange({ target: { value: String(value) } }));
}

describe("the backdrop picker's sliders", () => {
  test("a drag rests for 300 ms, then saves once", async () => {
    const flushSync = await open();
    drag(flushSync, "Overlay darkness", 0.5);
    drag(flushSync, "Overlay darkness", 0.75);
    expect(saves).toEqual([]);
    await settle(flushSync, 450);
    expect(saves).toEqual([{ pack: "st", item: "a", dim: 0.75 }]);
    flushSync(() => root.unmount());
  });

  test("the blur slider saves with the dim it sits beside, and zero blur leaves the field out", async () => {
    const flushSync = await open();
    drag(flushSync, "Blur", 12);
    await settle(flushSync, 450);
    expect(saves).toEqual([{ pack: "st", item: "a", dim: 0.6, blur: 12 }]);
    drag(flushSync, "Blur", 0);
    await settle(flushSync, 450);
    expect(saves[1]).toEqual({ pack: "st", item: "a", dim: 0.6 });
    flushSync(() => root.unmount());
  });

  test("closing the picker inside that window still saves the change", async () => {
    const flushSync = await open();
    drag(flushSync, "Overlay darkness", 0.8);
    flushSync(() => root.unmount());
    await settle(flushSync, 450);
    expect(saves).toEqual([{ pack: "st", item: "a", dim: 0.8 }]);
  });

  test("picking another picture takes the pending value with it and does not save the old picture afterwards", async () => {
    const flushSync = await open();
    drag(flushSync, "Overlay darkness", 0.7);
    const tavern = [...dom.window.document.querySelectorAll('[role="option"]')].find((t) => t.textContent?.includes("Tavern")) as HTMLElement;
    flushSync(() => tavern.click());
    flushSync(() => root.unmount());
    await settle(flushSync, 450);
    expect(saves).toEqual([{ pack: "st", item: "b", dim: 0.7 }]);
  });

  test("a save that fails is said in the picker rather than thrown away", async () => {
    const flushSync = await open();
    fail = true;
    drag(flushSync, "Overlay darkness", 0.4);
    await waitFor(flushSync, () => dom.window.document.body.textContent?.includes("Could not save the backdrop"), "the failed save to be said");
    flushSync(() => root.unmount());
  });
});
