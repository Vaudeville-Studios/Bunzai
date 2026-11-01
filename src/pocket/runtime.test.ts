/** Browser-runtime contract: API compatibility, volatile storage, and host-only refusal. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { DocsIndex } from "../ui/docs-types";
import { webStorage } from "../ui/_shared/web-storage";
import { gateScreen, type Status } from "../ui/shell/library-gate";
import { installPocketRuntime } from "./runtime";
import type { ThemePackageInput } from "../extensions/theme-contract";
import { fixtureThemePackage } from "../extensions/theme-test-fixture";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const themePackage = (id: string, name: string): Promise<ThemePackageInput> => fixtureThemePackage(id, name);

describe("temporary browser studio", () => {
  const KEYS = ["document", "window", "localStorage", "sessionStorage", "CustomEvent", "__BUNZAI_POCKET_DATA__"];
  const original = KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  let dispose: (() => void) | undefined;
  const dom = new JSDOM('<!doctype html><meta name="bunzai-runtime" content="browser">', {
    url: "https://example.test/Bunzai/",
  });

  beforeAll(async () => {
    const docsIndex: DocsIndex = { generated: "test", count: 0, docs: [] };
    Object.assign(globalThis, {
      document: dom.window.document,
      window: dom.window,
      CustomEvent: dom.window.CustomEvent,
      localStorage: new MemoryStorage(),
      sessionStorage: new MemoryStorage(),
      __BUNZAI_POCKET_DATA__: {
        manifests: [{ id: "library" }],
        setupSteps: ["theme"],
        docsIndex,
        docFigures: [],
        themePackages: { theater: await themePackage("theater", "Theater") },
        exampleThemePackages: { "bunzai.theme.encore": await themePackage("bunzai.theme.encore", "Encore") },
      },
    });
    globalThis.localStorage.setItem("native-sentinel", "untouched");
    dispose = installPocketRuntime();
  });

  afterAll(() => {
    dispose?.();
    for (const [k, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else Reflect.deleteProperty(globalThis, k);
    }
    dom.window.close();
  });

  test("the library gate opens straight into the Studio: the in-memory library is never locked", async () => {
    const res = await fetch("/api/library/status");
    expect(res.status).toBe(200);
    const status = (await res.json()) as Status;
    expect(gateScreen(status, { loadInSeen: false })).toBe("studio");
  });

  test("theme appearance reads use the unified extension owner; old theme mutation routes are retired", async () => {
    const before = await (await fetch("/api/extensions/revision")).json() as { revision: string };
    const packages = await (await fetch("/api/extensions/list")).json() as { id: string; hostTrusted: boolean }[];
    expect(packages).toContainEqual(expect.objectContaining({ id: "bunzai.host.theme.theater", hostTrusted: true }));
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "bunzai.theme.encore" }),
    });
    expect(await (await fetch("/api/themes/effective")).json()).toMatchObject({ themeId: null, appearance: null, fallbackReason: "not-installed" });
    const previewResponse = await fetch("/api/extensions/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: await themePackage("bunzai.theme.encore", "Encore") }) });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { challenge: string; expectedRevision: number; package: { manifest: { theme: { requests: string[] } } } };
    const installed = await fetch("/api/extensions/install", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge: preview.challenge, grants: [], themeScopes: preview.package.manifest.theme.requests, expectedRevision: preview.expectedRevision }),
    });
    expect(installed.status).toBe(200);
    const installedControl = await installed.json() as { id: string; revision: number };
    expect((await fetch("/api/extensions/enable", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: installedControl.id, expectedRevision: installedControl.revision }) })).status).toBe(200);
    expect(await (await fetch("/api/themes/effective")).json()).toMatchObject({ themeId: "bunzai.theme.encore", appearance: expect.objectContaining({ shape: expect.any(Object) }) });
    const activeControl = (await (await fetch("/api/extensions/list")).json() as { id: string; revision: number }[]).find((item) => item.id === "bunzai.theme.encore")!;
    expect((await fetch("/api/extensions/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: activeControl.id, expectedRevision: activeControl.revision }) })).status).toBe(200);
    expect(await (await fetch("/api/themes/effective")).json()).toMatchObject({ themeId: null, appearance: null, fallbackReason: "revoked" });
    const after = await (await fetch("/api/extensions/revision")).json() as { revision: string };
    expect(after.revision).not.toBe(before.revision);
  });

  test("old standalone theme installation route is unavailable", async () => {
    const response = await fetch("/api/themes/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: "old", digest: "a".repeat(64), decision: "approve" }),
    });
    expect(response.status).toBe(404);
  });

  test("Browser extensions use one volatile host and report only Browser-supported operations", async () => {
    const revision = await (await fetch("/api/extensions/revision")).json() as { revision: string };
    expect(revision.revision).toMatch(/^[a-f0-9]{64}$/);
    const installed = await (await fetch("/api/extensions/list")).json() as { id: string; hostTrusted: boolean }[];
    expect(installed).toContainEqual(expect.objectContaining({ id: "bunzai.host.theme.theater", hostTrusted: true }));

    const manifest = await Bun.file("src/extensions/examples/bunzai.extension.inspector/manifest.json").json();
    const main = await Bun.file("src/extensions/examples/bunzai.extension.inspector/main.js").text();
    const previewResponse = await fetch("/api/extensions/preview", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { manifest, files: { "main.js": main } } }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { unsupported: string[] };
    expect(preview.unsupported).toEqual([]);

    const fileManifest = await Bun.file("src/extensions/examples/bunzai.extension.file-reader/manifest.json").json();
    const fileMain = await Bun.file("src/extensions/examples/bunzai.extension.file-reader/main.js").text();
    const unavailable = await fetch("/api/extensions/preview", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { manifest: fileManifest, files: { "main.js": fileMain } } }),
    });
    expect(unavailable.status).toBe(400);
    expect(await unavailable.json()).toMatchObject({ error: { code: "UNSUPPORTED_HOST" } });
  });

  test("rejects an oversized JSON stream before reading the rest of its body", async () => {
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { canceled = true; },
    });
    const request = new Request("https://example.test/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const response = await fetch(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload too large" });
    expect(pulls).toBeLessThanOrEqual(34); // 32 MiB cap, rejecting chunk, and one queued pull
    expect(canceled).toBe(true);
  });

  test("serves the editing API and starts empty after a new page load", async () => {
    webStorage("local")?.setItem("pocket-only", "one load");
    expect(globalThis.localStorage.getItem("native-sentinel")).toBe("untouched");
    expect(globalThis.localStorage.getItem("pocket-only")).toBeNull();
    expect(await (await fetch("/api/apps")).json()).toEqual([{ id: "library" }]);
    expect(await (await fetch("/api/version")).json()).toMatchObject({ mode: "browser" });

    const entity = {
      schemaVersion: "1",
      kind: "character",
      id: "test-character",
      body: {
        identity: { name: "Test Character" },
        persona: {},
        prompts: {},
        greetings: {},
        examples: {},
        media: {},
        attribution: {},
        discovery: {},
      },
    };
    const saved = await fetch("/api/studio/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entity),
    });
    expect(saved.status).toBe(200);
    expect(await (await fetch("/api/studio/list")).json()).toMatchObject([
      { id: "test-character", kind: "character", name: "Test Character" },
    ]);

    const exported = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity, targetId: "vaud-json" }),
    });
    expect(exported.status).toBe(200);
    const output = await exported.json() as { text?: string; suggestedExtension?: string };
    expect(output.suggestedExtension).toBe("json");
    expect(JSON.parse(output.text ?? "")).toMatchObject({ id: "test-character", kind: "character" });

    const inspected = await fetch("/api/inspect", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-filename": "test-character.json",
      },
      body: output.text,
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ ok: true, formatId: "vaud-json", kind: "character" });

    const unavailableResponse = await fetch("/api/remote/status");
    expect(unavailableResponse.status).toBe(501);
    expect(await unavailableResponse.json()).toEqual({
      error: "This control needs the installed Bunzai app and is unavailable in the temporary browser studio.",
    });

    dispose?.();
    dispose = installPocketRuntime();
    expect(webStorage("local")?.getItem("pocket-only")).toBeNull();
    expect(await (await fetch("/api/studio/list")).json()).toEqual([]);
  });
});
