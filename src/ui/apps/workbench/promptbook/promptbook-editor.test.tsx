/** Authoring contracts through the real editor: one saved workflow across views and a model-free rehearsal. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { PromptbookEditor } from "./promptbook-editor";
import { installPieceDom, mountEditor, tick } from "../pieces/fake-piece-rig";
import type { InstalledDom } from "../../../_shared/test-dom";
import { emptyPromptbookBody, newBookPhase } from "../../../../core/promptbook";
import type { PromptbookBody } from "../../../../entities/promptbook/schema";

let installed: InstalledDom;
beforeAll(() => { installed = installPieceDom(); });
afterAll(() => installed.teardown());
const api = { listEntities: async () => [], sceneConnections: async () => [] };
test("a recipe, phase edits and saved setups persist as one revision-checked book", async () => {
  const imported = emptyPromptbookBody("Casebook");
  imported.phases[0]!.id = "think";
  const m = await mountEditor(PromptbookEditor, "promptbook", imported, { api });
  try {
    await m.click(m.button(/^Think, then write$/));
    await m.type(m.field("Phase name"), "Plan the scene");
    await m.type(m.field("Setup name"), "Full workflow");
    await m.click(m.button(/^Save setup$/));
    await m.click(m.button(/^Save$/));
    expect(m.saves).toHaveLength(1);
    expect(m.saves[0]!.kind).toBe("promptbook");
    expect(m.saves[0]!.expected).toBe("r1");
    const body = (m.saves[0]!.patch.head as { body: PromptbookBody }).body;
    expect(body.phases).toHaveLength(2);
    expect(body.phases[0]!.name).toBe("Plan the scene");
    expect(body.phases[0]!.id).not.toBe(body.phases[1]!.id);
    expect(body.phases[1]!.reads).toEqual([body.phases[0]!.id]);
    expect(body.setups[0]!.name).toBe("Full workflow");
  } finally { await m.unmount(); }
});
test("Cards and Board preserve edits; Try a line creates no save or provider request", async () => {
  const m = await mountEditor(PromptbookEditor, "promptbook", emptyPromptbookBody("Casebook"), { api });
  try {
    await m.type(m.field("Phase name"), "Tell the story");
    await m.click(m.button(/^Cards$/));
    expect(m.field<HTMLInputElement>("Phase name").value).toBe("Tell the story");
    await m.click(m.button(/^Board$/));
    expect(m.host.querySelector('[data-part="promptbook.board"]')).not.toBeNull();
    expect(m.field<HTMLInputElement>("Phase name").value).toBe("Tell the story");
    await m.type(m.field("Rehearsal line"), "I open the door.");
    await m.click(m.button(/^Try$/));
    expect(m.host.textContent).toContain("Tell the story: Runs");
    expect(m.saves).toHaveLength(0);
  } finally { await m.unmount(); }
});
test("a phase prompt adopts its staged attachment only with the committed save", async () => {
  const sha = "a".repeat(64);
  const ref = `\u0000b:u:application/pdf:${sha}`;
  const receipts: string[][] = [];
  const savedPatches: unknown[] = [];
  const discarded: string[][] = [];
  let staged = 0;
  const m = await mountEditor(PromptbookEditor, "promptbook", emptyPromptbookBody("Casebook"), { api: {
    listEntities: async () => [],
    sceneConnections: async () => [],
    uploadAsset: async () => ({ sha, mime: "application/pdf", bytes: 5, ref: `receipt-${++staged}`, asset: ref }),
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
    patchEditedEntity: async (_kind: string, _id: string, _expected: string, patch: unknown, uploads: string[] = []) => {
      savedPatches.push(patch);
      receipts.push(uploads); return { revision: "r2", summary: { id: "p1", kind: "promptbook", name: "Casebook" } };
    },
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "brief.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    expect(m.host.textContent).toContain("brief.pdf");
    expect(m.host.textContent).toContain("application/pdf");
    await m.click(m.button(/^Remove$/));
    expect(discarded).toEqual([]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); await tick(); });
    expect(m.host.textContent).toContain("brief.pdf");
    await m.click(m.button(/^Save$/));
    expect(receipts.flat()).toEqual(["receipt-1"]);
    expect(JSON.stringify(savedPatches)).toContain("brief.pdf");
    expect(JSON.stringify(savedPatches)).toContain("application/pdf");
    expect(discarded).toEqual([]);
  } finally { await m.unmount(); }
});

test("switching prompt blocks cancels a pending file and discards its late grant", async () => {
  const body = emptyPromptbookBody("Casebook");
  body.phases[0]!.preset.prompts = ["a", "b"].map((id) => ({
    id, name: `Prompt ${id}`, content: "", role: "user" as const, enabled: true, systemPrompt: false,
    marker: false, placement: "relative", injectionDepth: 0, injectionOrder: 0, forbidOverrides: false,
  }));
  const sha = "c".repeat(64), asset = `\u0000b:u:application/pdf:${sha}`;
  const discarded: string[][] = [];
  let signal: AbortSignal | undefined;
  let resolveStage!: (grant: { sha: string; mime: "application/pdf"; bytes: number; ref: string; asset: string }) => void;
  const stage = new Promise<{ sha: string; mime: "application/pdf"; bytes: number; ref: string; asset: string }>((resolve) => { resolveStage = resolve; });
  const m = await mountEditor(PromptbookEditor, "promptbook", body, { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async (_file: File, next?: AbortSignal) => { signal = next; return stage; },
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
  } });
  try {
    const settings = m.buttons(/^Settings$/);
    await m.click(settings[0]!);
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "late.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    expect(signal?.aborted).toBe(false);
    expect(picker.disabled).toBe(true);
    expect(m.host.textContent).toContain("Staging file…");
    await m.click(m.buttons(/^Settings$/)[1]!);
    expect(signal?.aborted).toBe(true);
    resolveStage({ sha, mime: "application/pdf", bytes: 5, ref: "late-receipt", asset });
    await act(async () => { await tick(); });
    expect(m.host.textContent).not.toContain("late.pdf");
    expect(discarded).toEqual([["late-receipt"]]);
  } finally { await m.unmount(); }
});

test("switching phases cancels a pending upload even when both phases reuse the prompt id", async () => {
  const body = emptyPromptbookBody("Casebook");
  const first = body.phases[0]!;
  first.id = "phase-one";
  const shared = { ...first.preset.prompts[0]!, id: "shared-prompt" };
  first.preset.prompts = [shared];
  const second = newBookPhase("phase-two", "Second phase", "after");
  second.preset.prompts = [{ ...shared }];
  body.phases.push(second);
  const sha = "f".repeat(64), asset = `\u0000b:u:application/pdf:${sha}`;
  const discarded: string[][] = [];
  let signal: AbortSignal | undefined;
  let resolveStage!: (grant: { sha: string; mime: "application/pdf"; bytes: number; ref: string; asset: string }) => void;
  const stage = new Promise<{ sha: string; mime: "application/pdf"; bytes: number; ref: string; asset: string }>((resolve) => { resolveStage = resolve; });
  const m = await mountEditor(PromptbookEditor, "promptbook", body, { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async (_file: File, next?: AbortSignal) => { signal = next; return stage; },
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "phase-file.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    expect(signal?.aborted).toBe(false);
    await m.click(m.button(/^2\. Second phase/));
    expect(signal?.aborted).toBe(true);
    resolveStage({ sha, mime: "application/pdf", bytes: 5, ref: "late-phase-receipt", asset });
    await act(async () => { await tick(); });
    expect(m.host.textContent).not.toContain("phase-file.pdf");
    expect(discarded).toEqual([["late-phase-receipt"]]);
  } finally { await m.unmount(); }
});

test("a removed staged file stays available to undo after a save", async () => {
  const sha = "b".repeat(64), asset = `\u0000b:u:application/pdf:${sha}`;
  const discarded: string[][] = [];
  const receipts: string[][] = [];
  const m = await mountEditor(PromptbookEditor, "promptbook", emptyPromptbookBody("Casebook"), { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async () => ({ sha, mime: "application/pdf", bytes: 5, ref: "retained-receipt", asset }),
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
    patchEditedEntity: async (_kind: string, _id: string, _expected: string, _patch: unknown, used: string[] = []) => { receipts.push(used); return { revision: "r2", summary: { id: "p1", kind: "promptbook", name: "Casebook" } }; },
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "undoable.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    await m.click(m.button(/^Remove$/));
    await m.type(m.field("Phase name"), " changed");
    await m.click(m.button(/^Save$/));
    expect(receipts.flat()).toEqual([]);
    expect(discarded).toEqual([]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); await tick(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); await tick(); });
    expect(m.host.textContent).toContain("undoable.pdf");
    expect(discarded).toEqual([]);
  } finally { await m.unmount(); }
  expect(discarded).toEqual([["retained-receipt"]]);
});

test("a removed staged file is discarded once bounded history can no longer restore it", async () => {
  const sha = "9".repeat(64), asset = `\u0000b:u:application/pdf:${sha}`;
  const discarded: string[][] = [];
  const m = await mountEditor(PromptbookEditor, "promptbook", emptyPromptbookBody("Casebook"), { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async () => ({ sha, mime: "application/pdf", bytes: 5, ref: "evicted-receipt", asset }),
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "evicted.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    await m.click(m.button(/^Remove$/));
    expect(discarded).toEqual([]);
    for (let i = 0; i < 105; i++) await m.type(m.field("Phase description"), `x${i}`);
    await act(async () => { await tick(); });
    expect(discarded).toEqual([["evicted-receipt"]]);
  } finally { await m.unmount(); }
});

test("prompt attachment limit is checked before staging", async () => {
  const body = emptyPromptbookBody("Casebook");
  const atLimit = Array.from({ length: 8 }, (_, index) => ({
    name: `file-${index}.pdf`, ref: `\u0000b:u:application/pdf:${String(index + 1).repeat(64)}`,
  }));
  body.phases[0]!.preset.prompts = body.phases[0]!.preset.prompts.map((prompt) => ({ ...prompt, attachments: atLimit }));
  const m = await mountEditor(PromptbookEditor, "promptbook", body, { api });
  try {
    await m.click(m.button(/^Settings$/));
    expect(m.host.textContent).toContain("at most 8 attachments");
    expect(m.host.querySelector('[aria-label="Add prompt attachment"]')).toBeNull();
  } finally { await m.unmount(); }
});

test("a duplicate block reference is discarded instead of adding a duplicate row", async () => {
  const body = emptyPromptbookBody("Casebook");
  const sha = "d".repeat(64), asset = `\u0000b:u:application/pdf:${sha}`;
  body.phases[0]!.preset.prompts[0]!.attachments = [{ name: "kept.pdf", ref: asset }];
  const discarded: string[][] = [];
  const m = await mountEditor(PromptbookEditor, "promptbook", body, { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async () => ({ sha, mime: "application/pdf", bytes: 5, ref: "duplicate-receipt", asset }),
    discardAssetUploads: async (refs: readonly string[]) => { discarded.push([...refs]); },
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["%PDF-"], "another-name.pdf", { type: "application/pdf" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); });
    expect([...m.host.querySelectorAll("strong")].filter((node) => node.textContent === "kept.pdf")).toHaveLength(1);
    expect(discarded).toEqual([["duplicate-receipt"]]);
  } finally { await m.unmount(); }
});

test("staged image preview uses the bytes already held by the asset cache", async () => {
  const sha = "e".repeat(64), asset = `\u0000b:u:image/png:${sha}`;
  const previousObserver = globalThis.IntersectionObserver;
  const previousFetch = globalThis.fetch;
  const createUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const assetRequests: string[] = [];
  globalThis.IntersectionObserver = class {
    constructor(private readonly notify: IntersectionObserverCallback) {}
    observe(target: Element): void { this.notify([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as unknown as typeof IntersectionObserver;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    assetRequests.push(String(input));
    return new Response("asset was not saved", { status: 500 });
  }, { preconnect: previousFetch.preconnect });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:staged-prompt-image" });
  const m = await mountEditor(PromptbookEditor, "promptbook", emptyPromptbookBody("Casebook"), { api: {
    listEntities: async () => [], sceneConnections: async () => [],
    uploadAsset: async () => ({ sha, mime: "image/png", bytes: 4, ref: "image-receipt", asset }),
    discardAssetUploads: async () => {},
  } });
  try {
    await m.click(m.button(/^Settings$/));
    const picker = m.field<HTMLInputElement>("Add prompt attachment");
    Object.defineProperty(picker, "files", { configurable: true, value: [new File([new Uint8Array([137, 80, 78, 71])], "portrait.png", { type: "image/png" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); await tick(); await tick(); });
    expect(m.host.querySelector("img")?.getAttribute("src")).toBe("blob:staged-prompt-image");
    expect(assetRequests).toEqual([]);
  } finally {
    await m.unmount();
    globalThis.fetch = previousFetch;
    globalThis.IntersectionObserver = previousObserver;
    if (createUrl) Object.defineProperty(URL, "createObjectURL", createUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
  }
});

test("inline native attachments show their decoded type, size, and image preview", async () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const text = "data:text/plain;base64,SGVsbG8=";
  const body = emptyPromptbookBody("Casebook");
  body.phases[0]!.preset.prompts[0]!.attachments = [
    { name: "inline.png", ref: png },
    { name: "inline.txt", ref: text },
  ];
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(private readonly notify: IntersectionObserverCallback) {}
    observe(target: Element): void { this.notify([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as unknown as typeof IntersectionObserver;
  const m = await mountEditor(PromptbookEditor, "promptbook", body, { api: {
    listEntities: async () => [], sceneConnections: async () => [],
  } });
  try {
    await m.click(m.button(/^Settings$/));
    expect(m.host.textContent).toContain("inline.png");
    expect(m.host.textContent).toContain("image/png · 8 bytes");
    expect(m.host.textContent).toContain("inline.txt");
    expect(m.host.textContent).toContain("text/plain · 5 bytes");
    expect(m.host.querySelector("img")?.getAttribute("src")).toBe(png);
  } finally {
    await m.unmount();
    globalThis.IntersectionObserver = previousObserver;
  }
});
