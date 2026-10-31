/**
 * The Settings room: a rail of four acts built from the sections' own act, status and lock; one page head per tab; the
 * lock line on a protected tab. The real registry keeps every tab id, opens on Appearance and groups the tabs into the four acts.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { installDom, type InstalledDom } from "../../_shared/test-dom";
import { SETTINGS_ACTS, type SettingsSection } from "./section-contract";

const Body = (name: string) => (): JSX.Element => <p data-testid="body">{name} controls</p>;
const fake = (id: string, label: string, actId: SettingsSection["act"], order: number, extra: Partial<SettingsSection> = {}): SettingsSection =>
  ({ id, label, act: actId, order, title: `${label} page`, lede: `${label} lede.`, Component: Body(label), ...extra });
const FAKES: SettingsSection[] = [
  fake("one", "One", "studio", 10, { status: (ctx) => (ctx.prefs.get("flag") === true ? "flag on" : "flag off") }),
  fake("two", "Two", "agent", 5, { protectedNote: "Keys never come back." }),
  fake("three", "Three", "studio", 20),
  fake("four", "Four", "house", 1, { lede: "" }),
];
const realSettingsSections = (await import("./sections/registry")).settingsSections; // kept so the mock below can be undone for the other test files
const realSections = realSettingsSections();
mock.module("./sections/registry", () => ({ settingsSections: () => [...FAKES].sort((a, b) => SETTINGS_ACTS.findIndex((x) => x.id === a.act) - SETTINGS_ACTS.findIndex((x) => x.id === b.act) || a.order - b.order) }));
const { default: app } = await import("./index");

let installed: InstalledDom;
let tree: Root;
let host: HTMLElement;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8327/", extraGlobals: ["SVGElement"], globals: { IS_REACT_ACT_ENVIRONMENT: true } }); });
afterAll(() => { installed.teardown(); mock.module("./sections/registry", () => ({ settingsSections: realSettingsSections })); });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); tree = createRoot(host); });

const published: unknown[] = [];
let flag = false;
const makeCtx = (): never => ({ setStatus: () => undefined, agent: { publish: (s: unknown) => published.push(s) }, prefs: { get: (k: string) => (k === "flag" ? flag : undefined), set: () => undefined } }) as never;
const Room = app.Component;
const tabs = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
const selected = (): string | undefined => tabs().find((t) => t.getAttribute("aria-selected") === "true")?.dataset.tab;

test("the rail lists every tab grouped by act, with act lines, status lines and a lock on the protected one", async () => {
  await act(async () => { tree.render(<Room ctx={makeCtx()} />); });
  expect(tabs().map((t) => t.dataset.tab)).toEqual(["one", "three", "two", "four"]);
  expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-orientation")).toBe("vertical");
  expect([...host.querySelectorAll('[role="tab"] > span[aria-hidden="true"]')].map((n) => n.textContent)).toEqual(["Your studio", "The agent", "The house"]);
  expect(tabs()[0]!.textContent).toContain("flag off");
  expect(tabs()[2]!.querySelector("svg")).not.toBeNull();
  expect(tabs()[0]!.querySelector("svg")).toBeNull();
  expect(selected()).toBe("one");
  await act(async () => tree.unmount());
});

test("a status line re-reads its pref when the shell hands the room a new ctx", async () => {
  flag = false;
  await act(async () => { tree.render(<Room ctx={makeCtx()} />); });
  flag = true;
  await act(async () => { tree.render(<Room ctx={makeCtx()} />); });
  expect(tabs()[0]!.textContent).toContain("flag on");
  await act(async () => tree.unmount());
});

test("picking a tab opens its page: kicker (the act), title, lede, and the lock line only where protected", async () => {
  await act(async () => { tree.render(<Room ctx={makeCtx()} />); });
  const head = (): string => host.querySelector('[data-part="settings.page-head"]')?.textContent ?? "";
  expect(head()).toBe("Your studioOne pageOne lede.");
  expect(host.querySelector('[data-part="settings.protected"]')).toBeNull();
  await act(async () => { tabs().find((t) => t.dataset.tab === "two")!.click(); });
  expect(selected()).toBe("two");
  expect(head()).toBe("The agentTwo pageTwo lede.");
  expect(host.querySelector('[data-part="settings.protected"]')?.textContent).toContain("Keys never come back.");
  expect(host.querySelector('[data-testid="body"]')?.textContent).toBe("Two controls");
  await act(async () => { tabs().find((t) => t.dataset.tab === "four")!.click(); });
  expect(head()).toBe("The houseFour page");
  await act(async () => tree.unmount());
});

test("the data-parts and hooks themes and variants reach are still there", async () => {
  await act(async () => { tree.render(<Room ctx={makeCtx()} />); });
  for (const part of ["settings.root", "settings.tabs", "settings.body", "settings.header"]) expect(host.querySelector(`[data-part="${part}"]`), part).not.toBeNull();
  expect(tabs().every((t) => t.dataset.part === "settings.tab")).toBe(true);
  for (const sx of ["room", "tabs", "body"]) expect(host.querySelector(`[data-sx="${sx}"]`), sx).not.toBeNull();
  await act(async () => tree.unmount());
});

test("the registry keeps every section id, opens on Appearance, and groups the tabs into the four acts", () => {
  const real = realSections;
  expect(real.map((s) => s.id).sort()).toEqual(["about", "appearance", "backups", "connections", "extensions", "memory", "models", "remote-access", "security", "spotify", "studio", "updates", "workbench"]);
  expect(real[0]!.id).toBe("appearance");
  expect(real.map((s) => s.act)).toEqual(["studio", "studio", "studio", "studio", "agent", "agent", "agent", "vault", "vault", "house", "house", "house", "house"]);
});
