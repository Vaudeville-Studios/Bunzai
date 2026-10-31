/**
 * The Workbench's empty-room message while a saved bench is still restoring (use-boot.ts's
 * `restoringWorkspace`, read via `ctx.workbench.restoring()`): before this fix, an empty
 * `openPieces` was indistinguishable from "the workbench is clear", so a bench still being
 * confirmed against the piece list flashed the empty-room CTAs (and could invite a click into
 * "New pack folder" mid-restore) instead of a quiet "Restoring your bench..." line.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { createRoot, type Root } from "react-dom/client";
import type { AppContext, StudioEntitySummary } from "../../app-contract";
import { PieceStore } from "../../_shared/piece-store";
import { installDom, type InstalledDom } from "../../_shared/test-dom";
import app from "./index";

let dom: JSDOM;
let installed: InstalledDom;

beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8324/", observers: true,
    extraGlobals: ["SVGElement", "Event", "DOMParser"],
    globals: {
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
    }
  });
  dom = installed.dom;
});
afterAll(() => installed.teardown());
beforeEach(() => installed.reinstall());

/** A bare-minimum ctx: enough for WorkbenchRoom to mount with no pieces and no active editor. */
function makeCtx(restoring: boolean, restoreFailure: string | null = null): AppContext {
  return {
    pieces: new PieceStore(),
    api: { listEntities: async () => [], extensions: { list: async () => [] } } as unknown as AppContext["api"],
    setStatus: () => undefined,
    openApp: () => undefined,
    prefs: { get: () => undefined, set: () => undefined },
    workbench: {
      pieces: (): StudioEntitySummary[] => [],
      active: () => null,
      beside: () => null,
      dirty: () => ({}),
      recents: () => ({}),
      restoring: () => restoring,
      restoreFailure: () => restoreFailure,
      onChange: () => () => undefined,
    },
    agent: { publish: () => undefined, current: () => null, onChange: () => () => undefined },
  } as unknown as AppContext;
}

let root: Root;
let host: HTMLElement;

function mount(ctx: AppContext): void {
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
  root.render(<app.Component ctx={ctx} />);
}

async function flush(): Promise<void> {
  await new Promise((r) => dom.window.setTimeout(r, 20));
}

test("while restoring, the ghost room shows a quiet restoring line and hides the create CTAs", async () => {
  mount(makeCtx(true));
  await flush();

  expect(host.textContent).toContain("Restoring your workbench");
  expect(host.textContent).not.toContain("the workbench is clear");
  expect(host.querySelector("button")?.textContent).not.toBe("New pack folder");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New pack folder")).toBe(false);
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New lorebook")).toBe(false);

  root.unmount();
});

test("once settled with nothing to restore, the ordinary empty room and its CTAs show", async () => {
  mount(makeCtx(false));
  await flush();

  expect(host.textContent).toContain("Your workbench is empty");
  expect(host.textContent).not.toContain("Restoring your workbench");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Open Library")).toBe(true);
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New pack folder")).toBe(true);
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New lorebook")).toBe(true);

  root.unmount();
});

test("an exhausted restore shows its reason while keeping restoration-gated actions hidden", async () => {
  mount(makeCtx(true, "The saved bench could not be restored."));
  await flush();

  expect(host.textContent).toContain("We couldn't restore the workbench");
  expect(host.textContent).toContain("The saved bench could not be restored.");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New pack folder")).toBe(false);
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "New lorebook")).toBe(false);

  root.unmount();
});
