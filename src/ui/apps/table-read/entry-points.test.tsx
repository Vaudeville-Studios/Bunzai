/** Real Library creation doors and the discovered Apps catalog launch the production Table Read without creating a character. */
import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDom } from "../../_shared/test-dom";
import type { AppContext } from "../../app-contract";
import { discoverApps } from "../../server-static";
import { NewInDeckButton } from "../library/new-in-deck-button";
import { AppCatalog } from "../app-catalog";
import app from "./index";

test.each([false, true])("the Library character creation door opens Table Read (compact=%s)", async (compact) => {
  const installed = installDom(undefined, { extraGlobals: ["DOMParser"], globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  const doc = installed.dom.window.document;
  const host = doc.createElement("div"); doc.body.append(host);
  const root = createRoot(host);
  const opened: string[] = [];
  let created = 0;
  const ctx = { openApp: (id: string) => opened.push(id) } as unknown as AppContext;
  try {
    await act(async () => root.render(<NewInDeckButton kind="character" compact={compact} ctx={ctx} onCreated={() => { created++; }} />));
    const door = doc.querySelector<HTMLButtonElement>('[data-part="library.new.interview"]')!;
    expect(door.disabled).toBe(false);
    await act(async () => door.click());
    expect(opened).toEqual([app.manifest.id]);
    expect(created).toBe(0);
  } finally { await act(async () => root.unmount()); installed.teardown(); }
});

test("the discovered production app is available and opens from the normal Apps catalog", async () => {
  expect((await discoverApps()).some((entry) => entry.id === app.manifest.id)).toBe(true);
  const installed = installDom(undefined, { extraGlobals: ["DOMParser"], globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  const doc = installed.dom.window.document;
  const host = doc.createElement("div"); doc.body.append(host);
  const root = createRoot(host);
  const opened: string[] = [];
  const ctx = { apps: () => [app.manifest], openApp: (id: string) => opened.push(id), setStatus: () => undefined } as unknown as AppContext;
  try {
    await act(async () => root.render(<AppCatalog ctx={ctx} />));
    expect(doc.querySelector('[data-part="app-catalog.card"]')?.textContent).toContain("The Table Read");
    await act(async () => doc.querySelector<HTMLButtonElement>('[data-part="app-catalog.card"] button')!.click());
    expect(opened).toEqual([app.manifest.id]);
  } finally { await act(async () => root.unmount()); installed.teardown(); }
});
