/**
 * The Compendium tab at each state RoleCall's screenshots show (rc-world-compendium, rc-world-8, rc-world-comp-dashboard-full,
 * -browse, -dossier, -storyboards): the empty note, the hero and tab row, the book bar and its read-only chip, the Dashboard's
 * cells, Browse with a 213-entry book mounting a screenful, an entry's page with its parsed fields and relationships,
 * Storyboards, and the two mount points. And the contract that matters most: opening and walking every tab calls the library
 * once to read the book and nothing else (no write, no chat setting).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { AppContext } from "../../../app-contract";
import type { Chat } from "../../../../stage/contracts/chat-store";
import type { SceneLoreBook } from "../../../app-contract-scenes";
import type { LorebookEntry } from "../../../../entities/lorebook/schema";
import { fixtureBook, typedEntry } from "../../../../core/compendium/fixture-book";
import { expectWindowed, teardownAllDoms } from "../../../_shared/test-dom";
import { CHAT, bodyOf, installLoreDom, press, q, qa, resetLore, rig, settle, text, typeInto, unmount, waitFor, type FlushSync } from "../fake-lore-rig";
import { CompendiumWing } from "./compendium-wing";

const BOOK: SceneLoreBook = { id: "b1", name: "The Drowned Coast", source: "scene", enabled: true, missing: false, entries: 213, tokens: 0 };
let calls: string[] = [];
let flushSync: FlushSync;

function ctxFor(entries: LorebookEntry[]): AppContext {
  const api = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => {
      calls.push(name);
      return async (query: string) => {
        if (name === "getCompendiumTree") return { tree: null };
        if (name === "getSceneProps") return { on: [] };
        if (name !== "getLightEditableEntity") throw new Error(`the Compendium called ${name}`);
        return { entity: { kind: "lorebook", id: /id=([^&]+)/.exec(query)![1], body: bodyOf(BOOK.name, entries) }, revision: "r1", version: 1 };
      };
    },
  });
  return { api, setStatus: () => undefined, prefs: { get: () => undefined, set: () => undefined } } as unknown as AppContext;
}

async function mount(books: SceneLoreBook[] | null, entries: LorebookEntry[] = fixtureBook().slice(0, 213), chat: Chat = CHAT, extra: Record<string, unknown> = {}): Promise<void> {
  const { createRoot } = await import("react-dom/client");
  rig.host = rig.dom.window.document.createElement("div");
  rig.dom.window.document.body.appendChild(rig.host);
  rig.root = createRoot(rig.host);
  flushSync(() => rig.root.render(createElement(CompendiumWing, { ctx: ctxFor(entries), chat, books, ...extra })));
  await settle(flushSync);
  await settle(flushSync);
}
const tab = (label: string): HTMLElement => qa('[role="tab"]').find((t) => t.textContent === label)!;
async function go(label: string): Promise<void> { await press(flushSync, tab(label), 30); }

beforeAll(async () => { installLoreDom(); flushSync = (await import("react-dom")).flushSync; });
afterAll(async () => { await teardownAllDoms(); });
afterEach(() => { unmount(flushSync); });
beforeEach(() => { resetLore(); calls = []; });

describe("no book (rc-world-compendium.png)", () => {
  test("says there is no active lorebook, and reads nothing", async () => {
    await mount([]);
    expect(text()).toContain("No active lorebook to browse.");
    expect(text()).toContain("Add a lorebook to this chat to see the compendium.");
    expect(calls).toEqual([]);
  });
});

describe("the shell (rc-world-8.png)", () => {
  test("hero copy, the five tabs, the book bar with the read-only chip", async () => {
    await mount([BOOK]);
    expect(text()).toContain("Living world reference");
    expect(q("h2")!.textContent).toBe("The Compendium");
    expect(text()).toContain("Browse, curate, and standardize the lorebooks the AI reads alongside this chat: every entry, dossier, and tree at a glance.");
    expect(qa('.cp-tabs [role="tab"]').map((t) => t.textContent)).toEqual(["Dashboard", "Browse", "Storyboards", "Activity", "Settings"]);
    expect(q(".cp-bar")!.textContent).toContain("Compendium");
    expect(q(".cp-bar .nm")!.textContent).toBe("The Drowned Coast");
    expect(q(".cp-chip")!.textContent).toBe("Read-Only");
  });
  test("a chat granted write reads Read + Write", async () => {
    await mount([BOOK], undefined, { ...CHAT, compendium: { books: { b1: { access: "read_write" } } } } as Chat);
    expect(q(".cp-chip")!.textContent).toBe("Read + Write");
  });
});

describe("the Dashboard (rc-world-comp-dashboard-full.png)", () => {
  test("header, strip and every cell with RoleCall's titles", async () => {
    await mount([BOOK]);
    await waitFor(flushSync, () => q(".cp-dash"), "the dashboard");
    expect(q(".cp-dh h1")!.textContent).toBe("The Drowned Coast");
    expect(q(".cp-dh .crumb2")!.textContent).toContain("Lorebook");
    expect(text()).toContain("Updated -");
    expect(text()).toMatch(/TV Tree . \d+ nodes . depth \d+/);
    const titles = qa(".cp-cell .ct").map((t) => t.textContent);
    for (const t of ["World Concepts", "Featured Cast", "Entry Counts", "Recent Writes", "Plots in Motion", "Threat Radar", "TV Tree Structure", "Historian's Recaps (by Plot)", "Cross-Reference Graph", "Spotlight Location", "Featured Creature"]) expect(titles.some((x) => x?.includes(t)), t).toBe(true);
    expect(qa(".cp-note3 [data-control=card] > span:first-child").map((k) => k.textContent)).toEqual(["ITEM", "ORG", "EVENT"]);
    expect(qa(".cp-counts .l").map((l) => l.textContent)).toEqual(["Cast", "Places", "Items", "Orgs", "Events", "Plots", "Threats", "World", "Beasts", "Recaps"]);
    expect(text()).toContain("Currently:");
    expect(q("[data-mount='compendium.headerActions']")).not.toBeNull();
    expect(text()).not.toContain("EXPORT");
  });
  test("an empty book shows RoleCall's empty lines", async () => {
    await mount([BOOK], []);
    await waitFor(flushSync, () => q(".cp-dash"), "the dashboard");
    for (const line of ["No concepts yet.", "No recent writes yet.", "No active plots.", "No active threats.", "No tree built yet.", "No summaries yet.", "No cross-references yet.", "No location yet.", "No creature yet.", "No character yet."]) expect(text(), line).toContain(line);
  });
  test("a cell opens its entry in Browse", async () => {
    await mount([BOOK]);
    await waitFor(flushSync, () => q(".cp-dash"), "the dashboard");
    await press(flushSync, q(".cp-cast .bd button"));
    await waitFor(flushSync, () => q(".cp-page"), "the entry page");
    expect(q(".cp-page h1")!.textContent).toBe("Mira Vance");
    expect(tab("Browse").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Browse (rc-world-comp-browse.png)", () => {
  test("the Catalogue, its three views, the search and the empty detail", async () => {
    await mount([BOOK]);
    await go("Browse");
    await waitFor(flushSync, () => q(".cp-cat"), "the catalogue");
    expect(q(".cp-cat .hd")!.textContent).toBe("The Catalogue");
    expect(q<HTMLInputElement>(".cp-cat input")!.placeholder).toBe("Search the codex...");
    expect(qa('.cp-cat [role="tab"]').map((b) => b.textContent)).toEqual(["By Type", "TV Tree", "Summaries"]);
    expect(q(".cp-sel b")!.textContent).toBe("Select an entry");
    expect(text()).toContain("Choose any entry from the sidebar to read its compendium page.");
    expect(q(".cp-sh span")!.textContent).toBe("Cast");
  });
  test("a 213-entry book mounts a screenful of rows, not every row", async () => {
    await mount([BOOK]);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    expectWindowed(rig.host, ".cp-vs .vr", 213, 60);
    expect(Number(q(".cp-sh em")!.textContent)).toBeGreaterThan(40);
  });
  test("search narrows the list and says so when nothing matches", async () => {
    await mount([BOOK]);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    typeInto(flushSync, q(".cp-cat input"), "Mira");
    await settle(flushSync);
    expect(qa("[data-entry-id]").map((r) => r.textContent)).toContain("Mira Vance");
    typeInto(flushSync, q(".cp-cat input"), "zzzzqqq");
    await settle(flushSync);
    expect(text()).toContain("No entries match.");
  });
  test("TV Tree and Summaries views, with RoleCall's empty copy on a classic book", async () => {
    await mount([BOOK]);
    await go("Browse");
    await press(flushSync, byView("TV Tree"));
    expect(q(".cp-cat .st")!.textContent).toMatch(/\d+ nodes . depth \d+/);
    expect(qa("[data-node-id]").length).toBeGreaterThan(5);
    await press(flushSync, byView("Summaries"));
    expect(qa("[data-entry-id] i").length).toBeGreaterThan(0);
  });
  test("a book with no typed entries reads 'No typed entries yet.'", async () => {
    await mount([BOOK], [{ ...fixtureBook()[0]!, metadata: {} }]);
    await go("Browse");
    await waitFor(flushSync, () => q(".cp-cat"), "the catalogue");
    expect(text()).toContain("No typed entries yet.");
  });
});
const byView = (label: string): HTMLElement => qa('.cp-cat [role="tab"]').find((b) => b.textContent === label)!;

describe("an entry's page (rc-world-comp-dossier.png)", () => {
  test("shows the parsed fields, the arc and the relationships", async () => {
    await mount([BOOK]);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    typeInto(flushSync, q(".cp-cat input"), "Mira Vance");
    await settle(flushSync);
    await press(flushSync, qa("[data-entry-id]").find((r) => r.textContent === "Mira Vance"));
    await waitFor(flushSync, () => q(".cp-page"), "the entry page");
    expect(q(".cp-page .crumb2")!.textContent).toBe("The Drowned Coast▸Character▸Mira Vance");
    expect(q(".cp-page .tchip")!.textContent).toContain("Character");
    expect(q(".cp-page .tg")!.textContent).toBe("Keeps the last lantern lit.");
    expect(qa(".cp-fb .fl").map((l) => l.textContent)).toEqual(expect.arrayContaining(["✦Age", "✦Affiliation", "✦Grade", "✦Character Arc", "✦Relationships", "✦Possessions", "✦Family"]));
    // The schema writes affiliations (a list); the tile reads its first one, never a bare hyphen.
    expect(byText2(".cp-fb", "Affiliation")!.textContent).toContain("Lantern Guild");
    const arc = q(".cp-ms")!;
    expect([...arc.children].map((c) => c.textContent)).toEqual(["01Arrives", "02Loses the lantern", "03Finds it"]);
    expect(q(".cp-ms .cur")!.textContent).toBe("02Loses the lantern");
    const rel = byText2(".cp-fb", "Relationships")!;
    expect(rel.textContent).toContain("Dov Ketter");
    expect(rel.textContent).toContain("ally");
    expect(text()).toContain("Brass Lantern");
  });
  test("lists who else names this character, and the entries it links to", async () => {
    await mount([BOOK]);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    typeInto(flushSync, q(".cp-cat input"), "Mira Vance");
    await settle(flushSync);
    await press(flushSync, qa("[data-entry-id]").find((r) => r.textContent === "Mira Vance"));
    expect(byText2(".cp-fb", "Referenced By")!.textContent).toContain("Oz");
    expect(q(".cp-linked")!.textContent).toContain("Linked Entries");
    await press(flushSync, qa(".cp-linked button").find((b) => b.textContent === "Dov Ketter"));
    expect(q(".cp-page h1")!.textContent).toBe("Dov Ketter");
  });
  test("an unknown authored field is shown, not dropped; a wrong-kind field is named", async () => {
    const odd = typedEntry("w1", "Salt", "worldbuilding", { topic: "Salt", category: "tide", description: "d", house_rule: "No iron.", key_facts: "not a list" });
    await mount([BOOK], [odd]);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    await press(flushSync, q("[data-entry-id]"));
    expect(byText2(".cp-fb", "Other Fields")!.textContent).toContain("No iron.");
    expect(text()).toContain("Key Facts should be a list.");
  });
  test("a classic entry reads 'No structured data for this entry.'", async () => {
    await mount([BOOK], [{ ...fixtureBook()[0]!, metadata: {} }]);
    await go("Browse");
    await press(flushSync, byView("TV Tree"));
    await press(flushSync, q("[data-node-id]"));
    await press(flushSync, q("[data-entry-id]"));
    expect(text()).toContain("No structured data for this entry.");
  });
});
const byText2 = (sel: string, t: string): HTMLElement | undefined => qa(sel).find((e) => (e.querySelector(".fl")?.textContent ?? "").includes(t));

describe("Storyboards, Activity, Settings (rc-world-comp-storyboards.png)", () => {
  test("Storyboards says none are enabled, and where to turn them on", async () => {
    await mount([BOOK]);
    await go("Storyboards");
    expect(q(".cp-note")!.textContent).toBe("No Storyboards are enabled for this chat. Turn on Quest Board, Cast, Map, or Renown in Props to use this panel.");
  });
  test("Activity is a mount point the Activity tab fills with the open book's id", async () => {
    await mount([BOOK], undefined, undefined, { activity: (m: { bookId: string }) => createElement("p", { id: "act" }, `activity for ${m.bookId}`) });
    await go("Activity");
    expect(text()).toContain("activity for b1");
  });
});

describe("read-only", () => {
  test("walking every tab and opening an entry reads the book, the tree the scene stored and the Props switched on, and writes nothing", async () => {
    await mount([BOOK]);
    for (const t of ["Browse", "Storyboards", "Activity", "Settings", "Dashboard"]) await go(t);
    await go("Browse");
    await waitFor(flushSync, () => q("[data-entry-id]"), "rows");
    await press(flushSync, q("[data-entry-id]"));
    expect(calls).toEqual(["getLightEditableEntity", "getCompendiumTree", "getSceneProps"]);
    expect(rig.patches).toEqual([]);
    expect(rig.setLore).toEqual([]);
    expect(rig.statuses).toEqual([]);
  });
});
