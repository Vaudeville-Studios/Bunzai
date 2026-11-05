/**
 * The Participants tab as it mounts (cast/cast-participants-tab.tsx) over a fake API that keeps the roster with the real store rules:
 * RoleCall's registry copy and rows, no VOICE and no DELETE on the character and the player, colour controls that wait for the Dialogue
 * Colors prop, DELETE that retires and Restore, and RECONCILE that proposes, stores only what is confirmed, and Undo. JSDOM-proven.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { Proposal } from "../../../core/participants/reconcile";
import type { ChatParticipants, ParticipantChange } from "../../../stage/contracts/chat-store";
import { applyParticipantChange, checkParticipantChange } from "../../../stage/store/participant-rules";
import type { OpenScene } from "../../../studio/scenes";
import type { AppContext } from "../../app-contract";
import { installDom, waitFor, type InstalledDom } from "../../_shared/test-dom";
import { registerInserter } from "./context/draft-bus";
import { holdParticipants } from "./participants/participants-store";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => {
  installed = installDom("<!doctype html><html><body></body></html>", { observers: true,
    url: "http://127.0.0.1:8321/", pretendToBeVisual: true,
    extraGlobals: ["HTMLInputElement", "HTMLSelectElement", "SVGElement", "Event", "CustomEvent", "Node", "MutationObserver"], boundGlobals: ["getComputedStyle"],
    globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) },
  });
  dom = installed.dom;
});
afterAll(() => installed.teardown());

let n = 0;
const scene = (): OpenScene => ({
  chat: { id: `chat${++n}`, title: "Scene", activeBranchId: "b1", createdAt: 0, updatedAt: 0, snapshotVersion: 1, cast: { character: { id: "vera", version: 1, name: "Marguerite Vane" }, persona: { id: "nuit", version: 1, name: "Nuit" } } },
  snapshot: { character: { kind: "character", id: "vera", body: { identity: { name: "Marguerite Vane" }, presentation: { gradientColors: ["#ffc9ae", "#aabbcc"] } } }, persona: { kind: "persona", id: "nuit", body: { name: "Nuit" } } },
  hasPortrait: false, messages: [], messageOffset: 0, messageCount: 40, beforeSeq: null, hasMore: false, userMessageCount: 0,
}) as unknown as OpenScene;

let stored: ChatParticipants | null = null;
let props: string[] = [];
let changes: ParticipantChange[] = [];
let reconciles: number[] = [];
let applied: { name: string; description: string | null }[][] = [];
let undone: string[] = [];
let proposal: Proposal & { messages: number } | Error = { candidates: [], known: 0, rejected: 0, messages: 0 };
let ids = 0;

const apply = (c: ParticipantChange): ChatParticipants | null => (stored = applyParticipantChange(stored ?? undefined, checkParticipantChange(c), 1, () => `n${++ids}`) ?? null);
const ctx = (): AppContext => ({
  api: {
    getSceneParticipants: async () => ({ participants: stored }),
    changeSceneParticipants: async (_: string, c: ParticipantChange) => { changes.push(c); return { participants: apply(c) }; },
    reconcileSceneParticipants: async (_: string, count: number) => { reconciles.push(count); if (proposal instanceof Error) throw proposal; return proposal; },
    applySceneParticipants: async (_: string, people: { name: string; description: string | null }[]) => { applied.push(people); apply({ op: "add", run: "run1", people: people.map((p) => ({ name: p.name })) }); return { run: "run1", added: people.length, participants: stored }; },
    undoSceneParticipants: async (_: string, run: string) => { undone.push(run); return { participants: apply({ op: "undo", run }) }; },
    getSceneProps: async () => ({ on: props }),
    setSceneProps: async () => ({ on: props }),
  },
  prefs: { get: () => "", set: () => undefined }, setStatus: () => undefined,
}) as unknown as AppContext;

beforeEach(() => { installed.reinstall(); stored = null; props = []; changes = []; reconciles = []; applied = []; undone = []; ids = 0; proposal = { candidates: [], known: 0, rejected: 0, messages: 0 }; });

let root: Root;
let host: HTMLElement;
type Flush = typeof import("react-dom")["flushSync"];
const doc = (): Document => dom.window.document;
const text = (): string => doc().body.textContent ?? "";
const button = (label: string): HTMLButtonElement | undefined => [...doc().body.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
const settle = async (f: Flush, ms = 40): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); f(() => undefined); };
async function mount(s: OpenScene = scene()): Promise<{ f: Flush; s: OpenScene }> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { ParticipantsTab } = await import("./cast/cast-participants-tab");
  holdParticipants(s.chat.id, stored);
  host = doc().createElement("div");
  doc().body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(<ParticipantsTab ctx={ctx()} scene={s} />));
  await settle(flushSync, 60);
  return { f: flushSync, s };
}
const press = async (f: Flush, el: HTMLElement | undefined): Promise<void> => { if (!el) throw new Error("nothing to press"); f(() => el.click()); await settle(f); };
const unmount = (f: Flush): void => { f(() => root.unmount()); host.remove(); };
const fill = (f: Flush, label: string, value: string): void => { const el = doc().body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; f(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
const rows = (): HTMLElement[] => [...doc().body.querySelectorAll(".prow")] as HTMLElement[];

describe("the Participants tab", () => {
  test("RoleCall's registry: the hero and counters, the main (anchored, card gradient), the player and no VOICE", async () => {
    const { f } = await mount();
    for (const t of ["Participant Registry", "Registered", "NPCs", "On Stage", "Main Character", "Player", "Anchored to the scene card", "Uses Card Gradient", "@Marguerite Vane", "@Nuit"]) expect(text()).toContain(t);
    expect([...doc().body.querySelectorAll(".stat b")].map((b) => b.textContent)).toEqual(["2", "0", "2"]);
    expect(text()).toContain("#ffc9ae, #aabbcc");
    expect(text()).not.toMatch(/voice/i);
    expect(text()).not.toContain("Roster director");
    expect(rows().map((r) => r.querySelector('[data-protected="participant-delete"] button') !== null)).toEqual([false, false]);
    expect(rows()[1]!.textContent).toContain("Set Main");
    expect(changes).toEqual([]);
    expect(stored).toBeNull();
    unmount(f);
  });

  test("the Ping line's Insert button puts the mention in the composer draft and changes nothing else", async () => {
    const { f, s } = await mount();
    const got: string[] = [];
    const off = registerInserter(s.chat.id, (p) => { got.push(p); return true; });
    await press(f, rows()[1]!.querySelector<HTMLElement>('[data-part="scene.cast.participant.ping"]')!);
    expect(got).toEqual(["@Nuit"]);
    expect(changes).toEqual([]);
    off();
    unmount(f);
  });

  test("Ping with no composer open says the mention is queued, and the composer gets it when it opens", async () => {
    const { f, s } = await mount();
    await press(f, rows()[1]!.querySelector<HTMLElement>('[data-part="scene.cast.participant.ping"]')!);
    expect(rows()[1]!.querySelector('[data-part="scene.cast.participant.ping-notice"]')?.textContent).toContain("@Nuit is queued");
    expect(changes).toEqual([]);
    const got: string[] = [];
    const off = registerInserter(s.chat.id, (p) => { got.push(p); return true; });
    expect(got).toEqual(["@Nuit"]);
    off();
    unmount(f);
  });

  test("colour controls wait for the Dialogue Colors prop and say so, and work once it is on", async () => {
    const off = await mount();
    const player = rows()[1]!;
    expect(player.textContent).toContain("Colors apply when Dialogue Colors is on.");
    expect(player.querySelector("button[title=\"Custom color\"]")).toBeNull();
    expect([...player.querySelectorAll("button")].find((b) => b.textContent === "+ Gradient")!.disabled).toBe(true);
    unmount(off.f);
    props = ["dialogue-colors"];
    const on = await mount();
    expect(rows()[1]!.querySelector("button[title=\"Custom color\"]")).not.toBeNull();
    expect(rows()[1]!.textContent).not.toContain("Colors apply when");
    await press(on.f, [...rows()[1]!.querySelectorAll("button")].find((b) => b.textContent === "+ Gradient"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ op: "edit", id: "player", edit: { colors: [expect.any(String), expect.any(String)] } });
    unmount(on.f);
  });

  test("Scene presence is saved and counted: Absent takes the player off stage", async () => {
    const { f } = await mount();
    const select = rows()[1]!.querySelector("select") as HTMLSelectElement;
    select.value = "absent";
    f(() => select.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    await settle(f);
    expect(changes).toEqual([{ op: "edit", id: "player", edit: { presence: "absent" } }]);
    expect(text()).toContain("Absent, kept out of active context");
    expect([...doc().body.querySelectorAll(".stat b")].map((b) => b.textContent)).toEqual(["2", "0", "1"]);
    unmount(f);
  });

  test("Set Main moves the slot, and an NPC's Delete retires it and Restore brings it back", async () => {
    stored = { people: [{ id: "n9", kind: "npc", name: "Atlas Guard", at: 1 }] };
    const { f } = await mount();
    expect(text()).toContain("Background, retained, not injected");
    await press(f, [...rows()[2]!.querySelectorAll("button")].find((b) => b.textContent === "Set Main"));
    expect(changes[0]).toEqual({ op: "main", id: "n9" });
    expect(text()).toContain("Unset Main");
    expect(doc().body.textContent).toContain("No NPCs registered yet.");
    await press(f, button("Unset Main"));
    await press(f, doc().body.querySelector('[data-protected="participant-delete"] button') as HTMLElement);
    expect(changes.at(-1)).toEqual({ op: "edit", id: "n9", edit: { retired: true } });
    expect(text()).toContain("Retired");
    await press(f, button("Restore"));
    expect(text()).not.toContain("Retired");
    expect(rows().map((r) => r.querySelector(".nm") !== null)).toHaveLength(3);
    unmount(f);
  });

  test("RECONCILE proposes, adds nothing until confirmed, stores only the ticked names, and Undo retires the run", async () => {
    proposal = { candidates: [{ name: "Mira Vance", description: "a guard" }, { name: "Sol", description: null }], known: 1, rejected: 0, messages: 12 };
    const { f } = await mount();
    await press(f, button("Reconcile"));
    expect(reconciles).toEqual([12]);
    expect(text()).toContain("Found 2 new in the last 12 messages · 1 already known. Nothing is added until you confirm.");
    expect(stored).toBeNull();
    // every name starts ticked once the card has taken the proposal (an effect after it renders); untick only after that
    const boxes = await waitFor(f, () => { const all = [...doc().body.querySelectorAll(".found input[type=checkbox]")] as HTMLInputElement[]; return all.length === 2 && all.every((b) => b.checked) && all; }, "every proposed name ticked");
    f(() => boxes[1]!.click());
    await settle(f);
    await press(f, button("Add selected"));
    expect(applied).toEqual([[{ name: "Mira Vance", description: "a guard" }]]);
    expect(text()).toContain("1 added · 1 already known");
    expect(stored!.people.map((p) => p.name)).toEqual(["Mira Vance"]);
    await press(f, button("Undo"));
    expect(undone).toEqual(["run1"]);
    expect(stored!.people[0]!.retired).toBe(true);
    unmount(f);
  });

  test("a failed Reconcile says why and stores nothing", async () => {
    proposal = new Error("the model's answer could not be read: the answer is not a JSON object");
    const { f } = await mount();
    await press(f, button("Reconcile"));
    expect(text()).toContain("could not be read");
    expect(stored).toBeNull();
    expect(applied).toEqual([]);
    unmount(f);
  });
  test("Add participant writes one add run with the name, note and presence, and the new person shows up", async () => {
    const { f } = await mount();
    await press(f, button("Add participant"));
    fill(f, "New participant name", "  Atlas   Guard ");
    fill(f, "New participant note", "Keeper of the Customs seal");
    await press(f, button("Absent"));
    await press(f, button("Add"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ op: "add", run: expect.stringMatching(/^add-.{8,}/), people: [{ name: "Atlas Guard", description: "Keeper of the Customs seal", presence: "absent" }] });
    expect(stored!.people.map((p) => p.name)).toEqual(["Atlas Guard"]);
    expect(text()).toContain("Atlas Guard");
    expect(doc().body.querySelector('input[aria-label="New participant name"]')).toBeNull();
    await press(f, button("Add participant"));
    fill(f, "New participant name", "atlas guard");
    await press(f, button("Add"));
    expect(text()).toContain("atlas guard is already on the roster.");
    expect(changes).toHaveLength(1);
    expect(doc().body.querySelector<HTMLInputElement>('input[aria-label="New participant name"]')!.value).toBe("atlas guard");
    await press(f, button("Cancel"));
    expect(doc().body.querySelector('input[aria-label="New participant name"]')).toBeNull();
    unmount(f);
  });
});
