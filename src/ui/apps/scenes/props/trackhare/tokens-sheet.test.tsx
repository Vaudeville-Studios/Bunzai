/**
 * The Tokens sheet, mounted: the legend's what-if click, Reset, a section's expand-to-text and Copy,
 * the not-raw note, the export/copy footer actions (download helper mocked), and Escape. tokens-core.
 * test.ts proves the math; this proves the wiring a pure test cannot: clicks reach state, state reaches
 * the DOM, and the footer calls the real download helper with the right name and content.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { Root } from "react-dom/client";
import type { SceneTrace, TraceBlockView } from "../../../../app-contract-scenes";
import { installDom } from "../../../../_shared/test-dom";

const installed = installDom("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:8324/",
  extraGlobals: ["HTMLButtonElement", "SVGElement", "Event", "KeyboardEvent", "CustomEvent"],
  globals: { requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) }
});
const dom = installed.dom;
{
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["attachEvent"] ??= () => undefined;
  proto["detachEvent"] ??= () => undefined;
}
afterAll(async () => { mock.module("../../../../components/export-dialog/download", () => realDownload); await installed.teardown(); });

// -- clipboard + download stand-ins ---------------------------------------------------------------

const clipboardWrites: string[] = [];
Object.defineProperty(dom.window.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text: string) => { clipboardWrites.push(text); } },
});

const downloadCalls: { filename: string; text: string }[] = [];
const realDownload = { ...(await import("../../../../components/export-dialog/download")) }; // mock.module rewrites the live module, so snapshot the real exports and restore them in afterAll
mock.module("../../../../components/export-dialog/download", () => ({
  exportBlob: (payload: { suggestedExtension: string; text?: string }, baseName: string) => ({
    blob: new Blob([payload.text ?? ""]),
    filename: `${baseName}.${payload.suggestedExtension}`,
  }),
  triggerDownload: async (blob: Blob, filename: string) => {
    downloadCalls.push({ filename, text: await blob.text() });
  },
}));

// -- fixtures --------------------------------------------------------------------------------------

const block = (over: Partial<TraceBlockView> = {}): TraceBlockView => ({
  kind: "prompt", label: "Main Prompt", role: "system", tokens: 100, category: "preset", ...over,
});

const trace = (over: Partial<SceneTrace> = {}): SceneTrace => ({
  reply: { messageId: "m1", swipeId: "s1", number: 14, model: "claude", take: "Director's Cut" },
  blocks: [
    block({ label: "Main Prompt", tokens: 420, category: "preset", role: "system", text: "Write in a literary register." }),
    block({ label: "The lighthouse", tokens: 120, category: "lore", role: "system", text: "The lighthouse text." }),
    block({ label: "Message 12", tokens: 2474, category: "history", role: "user", text: "You came up the stairs." }),
  ],
  window: { context: 32000, reply: 1200, stated: true },
  trimmed: 6,
  lore: { injected: [], cut: [], missed: [], chains: [], totalTokens: 120, share: 8000, seed: 1 },
  rawAvailable: true,
  replies: [],
  ...over,
});

// -- mount helpers -----------------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLElement;
const doc = (): Document => dom.window.document;

async function mount(t: SceneTrace, onClose: () => void): Promise<typeof import("react-dom")["flushSync"]> {
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const { TokensSheet } = await import("./tokens-sheet");
  host = doc().createElement("div");
  doc().body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(<TokensSheet trace={t} model="Claude Sonnet" onClose={onClose} />));
  return flushSync;
}

function unmount(): void {
  root?.unmount();
  host?.remove();
  root = null;
}

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll("button")];
const byText = (text: string): HTMLButtonElement | undefined => buttons().find((b) => (b.textContent ?? "").trim() === text);
const click = (flushSync: typeof import("react-dom")["flushSync"], el: Element): void => {
  flushSync(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
};

// -----------------------------------------------------------------------------------------------

describe("renders totals and legend", () => {
  test("the donut total and each legend row's tokens show", async () => {
    await mount(trace(), () => undefined);
    expect(host.textContent).toContain("3,014"); // 420 + 120 + 2474
    expect(host.textContent).toContain("Preset prompts");
    expect(host.textContent).toContain("420");
    expect(host.textContent).toContain("Chat history");
    expect(host.textContent).toContain("2,474");
    unmount();
  });
});

describe("the what-if", () => {
  test("clicking a legend row excludes it and the total drops; Reset restores it", async () => {
    const flushSync = await mount(trace(), () => undefined);
    const loreRow = buttons().find((b) => b.closest(".tok-leg") !== null && (b.textContent ?? "").includes("Lore"))!;

    click(flushSync, loreRow);
    expect(host.textContent).toContain("2,894"); // 3014 - 120
    expect(loreRow.hasAttribute("data-excluded")).toBe(true);

    click(flushSync, byText("Reset what-if")!);
    expect(host.textContent).toContain("3,014");
    expect(loreRow.hasAttribute("data-excluded")).toBe(false);
    unmount();
  });
});

describe("a section's raw text", () => {
  test("expands to its text, and Copy writes it to the clipboard", async () => {
    const flushSync = await mount(trace(), () => undefined);
    clipboardWrites.length = 0;
    const open = buttons().find((b) => (b.textContent ?? "").trim() === "Main Prompt")!;

    click(flushSync, open);
    expect(host.textContent).toContain("Write in a literary register.");

    click(flushSync, byText("Copy")!);
    expect(clipboardWrites).toEqual(["Write in a literary register."]);
    unmount();
  });
});

describe("no raw text", () => {
  test("shows the not-raw note, and offers no raw copy or txt export", async () => {
    await mount(trace({ rawAvailable: false, blocks: trace().blocks.map((b) => ({ ...b, text: undefined })) }), () => undefined);
    expect(host.textContent).toContain("Raw text is kept for each take's latest reply; this one shows sizes only.");
    expect(byText("Copy the raw request")).toBeUndefined();
    expect(byText("Export .txt")).toBeUndefined();
    unmount();
  });
});

test("the stored This Turn view names files and marks image and PDF costs as excluded from the text estimate", async () => {
  await mount(trace({ files: [{ message: 2, name: "reference.pdf", kind: "pdf" }] }), () => undefined);
  expect(host.textContent).toContain("reference.pdf (pdf)");
  expect(host.textContent).toContain("Image and PDF token costs are not included in the text estimate.");
  unmount();
});

describe("exports", () => {
  test("Export .json calls the download helper with the right name and the whole trace", async () => {
    downloadCalls.length = 0;
    const flushSync = await mount(trace(), () => undefined);

    click(flushSync, byText("Export .json")!);
    await new Promise((r) => setTimeout(r, 0)); // triggerDownload awaits blob.text()

    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]!.filename).toBe("bunzai-reply-14.json");
    expect(JSON.parse(downloadCalls[0]!.text)).toEqual(trace());
    unmount();
  });

  test("Export .txt calls the download helper with the raw request text", async () => {
    downloadCalls.length = 0;
    const flushSync = await mount(trace(), () => undefined);

    click(flushSync, byText("Export .txt")!);
    await new Promise((r) => setTimeout(r, 0)); // triggerDownload awaits blob.text()

    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]!.filename).toBe("bunzai-reply-14.txt");
    expect(downloadCalls[0]!.text).toContain("[system] Main Prompt\nWrite in a literary register.");
    unmount();
  });
});

describe("Summary-aware context truncation", () => {
  test("recap blocks are listed in the Chat history card by name, and the header counts messages apart from recaps", async () => {
    const blocks = [block({ kind: "summary", label: "Summary: Fog night", tokens: 80, category: "history", text: "[Summary: Fog night]" }), block({ kind: "history", label: "Message 12", tokens: 40, category: "history" })];
    await mount(trace({ blocks, summarized: [2, 3, 4, 7], trimmed: 0 }), () => undefined);
    expect(host.textContent).toContain("Chat history (1 message, messages 2-4, 7 replaced by summaries)");
    expect(host.textContent).toContain("Summary: Fog night");
    unmount();
  });
});

// th-t4-gaps 4
describe("the preset name and the Lore card's book grouping", () => {
  test("the Preset prompts card names the scene's preset when the trace carries one", async () => {
    await mount(trace({ presetName: "Velvet Quill" }), () => undefined);
    expect(host.textContent).toContain("Preset prompts (Velvet Quill)");
    unmount();
  });

  test("an old trace with no presetName falls back to the plain count", async () => {
    await mount(trace(), () => undefined);
    expect(host.textContent).toContain("Preset prompts (1)");
    unmount();
  });

  test("the Lore card groups its entries under book names, matched to lore.injected by title", async () => {
    const t = trace({
      blocks: [
        ...trace().blocks,
        block({ label: "The storm of '09", tokens: 180, category: "lore", role: "system", text: "The storm text." }),
      ],
      lore: {
        injected: [
          { bookId: "b1", entryId: "e1", bookName: "Keeper's Log", title: "The lighthouse", reason: "constant", matched: [], tokens: 120, place: "World", loop: 0 },
          { bookId: "b2", entryId: "e2", bookName: "The Drowned Coast", title: "The storm of '09", reason: "key", matched: ["storm"], tokens: 180, place: "World", loop: 0 },
        ],
        cut: [], missed: [], chains: [], totalTokens: 300, share: 8000, seed: 1,
      },
    });
    await mount(t, () => undefined);
    expect(host.textContent).toContain("Keeper's Log");
    expect(host.textContent).toContain("The Drowned Coast");
    const headers = [...host.querySelectorAll(".tok-bkh")].map((el) => el.textContent);
    expect(headers).toEqual(["Keeper's Log", "The Drowned Coast"]);
    unmount();
  });
});

describe("closing", () => {
  test("Escape calls onClose", async () => {
    let closed = false;
    const flushSync = await mount(trace(), () => { closed = true; });
    const sheet = host.querySelector('[role="dialog"]')!;

    flushSync(() => sheet.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

    expect(closed).toBe(true);
    unmount();
  });

  test("the Close button calls onClose", async () => {
    let closed = false;
    const flushSync = await mount(trace(), () => { closed = true; });

    click(flushSync, host.querySelector("button[aria-label=Close]")!);

    expect(closed).toBe(true);
    unmount();
  });

  // B15: tokens-sheet's own Tab-trap filter only skipped `[hidden]`, so an `inert` focusable (the
  // same shape bottom-sheet's `visibleIn` already excludes) could still steal a Tab cycle.
  test("Tab never lands on an inert focusable inside the sheet", async () => {
    const flushSync = await mount(trace(), () => undefined);
    const sheet = host.querySelector('[role="dialog"]') as HTMLElement;
    const decoy = doc().createElement("button");
    decoy.textContent = "decoy";
    const inertWrap = doc().createElement("div");
    inertWrap.setAttribute("inert", "");
    inertWrap.appendChild(decoy);
    sheet.insertBefore(inertWrap, sheet.firstChild);

    sheet.focus();
    flushSync(() =>
      sheet.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })),
    );

    expect(doc().activeElement).not.toBe(decoy);
    unmount();
  });

  // B16: tokens-sheet's own Escape handler had no IME-composition guard, so an IME cancel inside
  // the sheet (committing a candidate) would also close it.
  test("an IME composition Escape does not close the sheet", async () => {
    let closed = false;
    const flushSync = await mount(trace(), () => { closed = true; });
    const sheet = host.querySelector('[role="dialog"]')!;

    flushSync(() =>
      sheet.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );

    expect(closed).toBe(false);
    unmount();
  });
});
