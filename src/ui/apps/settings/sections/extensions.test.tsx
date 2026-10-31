/** Purpose: verify extension package review, actions and host-rendered results at the settings boundary. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import type { AppContext } from "../../../app-contract";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import { disableVolatileWebStorage, enableVolatileWebStorage } from "../../../_shared/web-storage";
import type { InstalledExtensionSummary } from "../../../../extensions/runtime/service";

let dom: JSDOM;
let installed: InstalledDom;
const emptyHostActions = async () => ({ actions: [], panels: [], statuses: [], notices: [] });
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/", pretendToBeVisual: true, extraGlobals: ["MouseEvent"] }); dom = installed.dom; });
afterAll(() => installed.teardown());

test("manager uses expected revision and stops rendering a contribution after disable", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const item: InstalledExtensionSummary = { id: "demo.panel", hostTrusted: false, revision: 7, digest: "a".repeat(64), name: "Demo", version: "1.0.0", description: "A test extension", enabled: true, recoveryRequired: false, grants: [], requirements: [], contributions: [{ type: "command", id: "go", label: "Go", operation: "content.list" }, { type: "command", id: "hidden", label: "Hidden", operation: "content.list" }], eventSubscriptions: [], registeredCommands: ["go"], promptFailures: [{ id: "append", count: 2 }], suspendedPromptIds: ["inspect"], settings: undefined, theme: null, themeScopes: [], activity: [{ id: "receipt-1", packageId: "demo.panel", operation: "content.list", effect: "read", status: "committed", createdAt: 1, resourceCount: 2 }], dataKeys: [], dataBytes: 0 };
  const calls: unknown[][] = [];
  let current = item;
  const extensions = {
    list: async () => [current], preview: async () => { throw new Error("unused"); }, install: async () => { throw new Error("unused"); }, previewInstalled: async () => { throw new Error("unused"); }, setGrants: async () => { throw new Error("unused"); },
    enable: async (...args: unknown[]) => { calls.push(["enable", ...args]); return {} as never; },
    disable: async (...args: unknown[]) => { calls.push(["disable", ...args]); current = { ...current, enabled: false, revision: 8 }; return {} as never; },
    revoke: async (...args: unknown[]) => { calls.push(["revoke", ...args]); return {} as never; },
    activate: async (...args: unknown[]) => { calls.push(["activate", ...args]); return { version: 1, root: { type: "text", text: "Ran" } }; },
    hostActions: emptyHostActions, answerHostAction: async () => true,
  } as unknown as AppContext["api"]["extensions"];
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.textContent).toContain("Go");
  expect(host.textContent).not.toContain("Hidden");
  expect(host.textContent).toContain("append failed 2 times");
  expect(host.textContent).toContain("inspect suspended after 3 failures");
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Disable")?.click());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls[0]).toEqual(["disable", "demo.panel", 7]);
  expect(host.textContent).toContain("1 receipt");
  expect(host.textContent).not.toContain("Go");
  flushSync(() => root.unmount()); host.remove();
});

test("revision changes from another manager refresh installed state and remove disabled actions", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  let current: InstalledExtensionSummary = { id: "demo.panel", hostTrusted: false, revision: 2, digest: "b".repeat(64), name: "Demo", version: "1.0.0", description: "A test extension", enabled: true, recoveryRequired: false, grants: [], requirements: [], contributions: [{ type: "command", id: "go", label: "Go", operation: "content.list" }], eventSubscriptions: [], registeredCommands: ["go"], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  let revision = "one";
  const extensions = { list: async () => [current], revision: async () => revision, pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true, preview: async () => { throw new Error("unused"); }, install: async () => { throw new Error("unused"); }, previewInstalled: async () => { throw new Error("unused"); }, setGrants: async () => { throw new Error("unused"); }, enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(host.textContent).toContain("Go");
  current = { ...current, enabled: false, revision: 3 }; revision = "two";
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  expect(host.textContent).toContain("disabled"); expect(host.textContent).not.toContain("Go");
  flushSync(() => root.unmount()); host.remove();
});

test("effect ticket shows host review targets and sends explicit approval by ticket ID", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  let tickets = [{ id: "ticket-1", packageId: "demo.panel", packageName: "Demo", operation: "content.list", effect: "read", resources: [{ kind: "character", id: "char-1" }], fields: ["name"], methods: [], destinations: [], review: { changed: ["name"] }, expiresAt: Date.now() + 60_000 }];
  const answered: unknown[][] = [];
  const extensions = { list: async () => [], revision: async () => "one", pendingEffects: async () => tickets, pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true, answerEffect: async (id: string, approved: boolean) => { answered.push([id, approved]); tickets = []; return true; }, preview: async () => { throw new Error("unused"); }, install: async () => { throw new Error("unused"); }, previewInstalled: async () => { throw new Error("unused"); }, setGrants: async () => { throw new Error("unused"); }, enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 30));
  expect(host.textContent).toContain("character: char-1"); expect(host.textContent).toContain("changed");
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Approve this action")?.click());
  await new Promise((resolve) => setTimeout(resolve, 0)); expect(answered).toEqual([["ticket-1", true]]);
  flushSync(() => root.unmount()); host.remove();
});

test("host action dialog is extension-branded and receives explicit user input", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const principal = { storeId: "store", packageId: "demo.dialog", packageDigest: "d".repeat(64), grantRevision: 1, runEpoch: 1 };
  let actions = [{ id: "dialog-1", action: "ui.dialog.request" as const, operation: "ui.dialog.request", packageId: principal.packageId, principal, message: "Would you like to continue?", expiresAt: 100_000 }];
  const answered: unknown[][] = [];
  const current: InstalledExtensionSummary = { id: principal.packageId, hostTrusted: false, revision: 1, digest: principal.packageDigest, name: "Demo dialog", version: "1.0.0", description: "Fixture", enabled: true, recoveryRequired: false,
    grants: [{ operation: "ui.dialog.request", resources: [], fields: ["dialog"], methods: [], destinations: [], duration: "persistent", budget: { requests: 100, bytes: 25_600_000, tokens: 0 } }], requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  const extensions = { list: async () => [current], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: async () => ({ actions, panels: [], statuses: [], notices: [] }),
    answerHostAction: async (id: string, answer: unknown) => { answered.push([id, answer]); actions = []; return true; }, answerEffect: async () => true,
    preview: async () => { throw new Error("unused"); }, install: async () => ({} as never), previewInstalled: async () => ({} as never), setGrants: async () => ({} as never),
    enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 25));
  expect(host.textContent).toContain("Demo dialog asks"); expect(host.textContent).toContain("Would you like to continue?");
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Continue")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(answered).toEqual([["dialog-1", { status: "accepted" }]]);
  flushSync(() => root.unmount()); host.remove();
});

test("approved extension draft replaces the actual mounted scene composer and never sends", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }, { SceneComposer }, handoff] = await Promise.all([
    import("react-dom"), import("react-dom/client"), import("./extensions"), import("../../scenes/scene-composer"), import("../../../_shared/scene-handoff"),
  ]);
  const principal = { storeId: "store", packageId: "demo.composer", packageDigest: "e".repeat(64), grantRevision: 1, runEpoch: 1 };
  const ticket = { id: "draft-1", action: "composer.draft.set" as const, operation: "composer.draft.set", packageId: principal.packageId, principal,
    sceneId: "scene-draft-target", text: "Reviewed replacement, never sent.", expiresAt: Date.now() + 60_000 };
  const item: InstalledExtensionSummary = { id: principal.packageId, hostTrusted: false, revision: 1, digest: principal.packageDigest, name: "Draft helper", version: "1.0.0", description: "Fixture",
    enabled: true, recoveryRequired: false, grants: [{ operation: "composer.draft.set", resources: [{ kind: "scene", id: ticket.sceneId }], fields: ["scene.draft"], methods: [], destinations: [], duration: "session", budget: { requests: 10, bytes: 100_000, tokens: 0 } }],
    requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  let actions = [ticket]; const answers: unknown[] = []; const saved = new Map<string, string>(); let sends = 0;
  let managerRoot: ReturnType<typeof createRoot> | undefined, composerRoot: ReturnType<typeof createRoot> | undefined;
  const managerHost = dom.window.document.createElement("div"), composerHost = dom.window.document.createElement("div");
  dom.window.document.body.append(managerHost, composerHost);
  enableVolatileWebStorage();
  const prefs = { get: (key: string) => saved.get(key), set: (key: string, value: string) => { saved.set(key, value); } };
  const extensions = { list: async () => [item], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [],
    hostActions: async () => ({ actions, panels: [], statuses: [], notices: [] }), claimHostAction: async (id: string) => { const found = actions.find((entry) => entry.id === id) ?? null; if (found) actions = []; return found; },
    answerHostAction: async (id: string, answer: unknown) => { answers.push([id, answer]); actions = []; return true; }, answerEffect: async () => true,
    preview: async () => ({} as never), install: async () => ({} as never), previewInstalled: async () => ({} as never), setGrants: async () => ({} as never),
    enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), uninstall: async () => true,
    activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs, appearance: { get: () => ({}) },
    openApp: () => {
      const sceneId = handoff.handedScene(), loadId = handoff.handedSceneLoadId();
      composerRoot ??= createRoot(composerHost);
      flushSync(() => composerRoot!.render(<SceneComposer api={{ runSceneDraft: async () => ({}) } as never} chatId={sceneId!} prefs={prefs as never} persona="Player" expandTick={0} name="Character" connected busy={false} showAiHint={false}
        tools={{ open: false, rows: [], onToggle() {}, onPick() {} }} steering={null} onSteer={() => {}} onCancelSteer={() => {}} onStop={() => {}} onOpenAiWing={() => {}} onSend={async () => { sends++; return true; }} onEditLast={() => false} />));
      if (loadId) handoff.completeSceneHandoff(loadId, true);
    } } as unknown as AppContext;
  managerRoot = createRoot(managerHost);
  try {
    flushSync(() => managerRoot!.render(<ExtensionManager ctx={ctx} />));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(managerHost.textContent).toContain("Reviewed replacement, never sent.");
    flushSync(() => [...managerHost.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Apply to composer")?.click());
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(composerHost.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.value).toBe(ticket.text);
    expect(saved.get(`scenes.draft.${ticket.sceneId}`)).toBe(ticket.text);
    expect(sends).toBe(0);
    expect(answers).toEqual([[ticket.id, { status: "composer-draft-result", result: "applied" }]]);
  } finally {
    flushSync(() => { managerRoot?.unmount(); composerRoot?.unmount(); }); managerHost.remove(); composerHost.remove(); disableVolatileWebStorage();
  }
});

test("manager resolves declared package images through the digest-bound host route and revokes their Blob URL", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const packageDigest = "e".repeat(64), themeDigest = "f".repeat(64), assetDigest = "a".repeat(64);
  const theme = { id: "demo.images", name: "Image theme", version: "1.0.0", digest: themeDigest, requestedScopes: ["appearance.assets"], derivedScopes: ["appearance.assets"],
    appearance: {}, assets: [{ id: "cover", path: "assets/cover.png", mediaType: "image/png", digest: assetDigest, text: "AA==" }], fonts: [], styles: null, slots: {} };
  let current: InstalledExtensionSummary = { id: "demo.images", hostTrusted: false, revision: 1, digest: packageDigest, name: "Image extension", version: "1.0.0", description: "Fixture", enabled: true, recoveryRequired: false,
    grants: [{ operation: "ui.panel.set", resources: [], fields: ["panel"], methods: [], destinations: [], duration: "persistent", budget: { requests: 100, bytes: 25_600_000, tokens: 0 } }], requirements: [], contributions: [{ type: "panel", id: "cover-panel", title: "Cover", events: [] }],
    eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: theme as never, themeScopes: ["appearance.assets"], activity: [], dataKeys: [], dataBytes: 0 };
  const panel = { packageId: current.id, principal: { storeId: "store", packageId: current.id, packageDigest, grantRevision: 1, runEpoch: 1 }, digest: packageDigest, contributionId: "cover-panel",
    descriptor: { version: 1 as const, root: { type: "image" as const, asset: "cover", alt: "Cover image" } } };
  let visible = true;
  const assetReads: unknown[][] = [];
  const extensions = { list: async () => [current], revision: async () => `${current.revision}`, pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: async () => ({ actions: [], panels: visible ? [panel] : [], statuses: [], notices: [] }), answerHostAction: async () => true,
    preview: async () => ({} as never), install: async () => ({} as never), previewInstalled: async () => ({} as never), setGrants: async () => ({} as never), enable: async () => ({} as never), disable: async () => ({} as never),
    revoke: async () => { current = { ...current, enabled: false, revision: current.revision + 1 }; visible = false; return {} as never; }, answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL; const revoked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:approved-extension-image" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (url: string) => revoked.push(url) });
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }), readExtensionThemeAsset: async (...args: unknown[]) => { assetReads.push(args); return new Uint8Array([1, 2, 3]); } },
    prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  try {
    flushSync(() => root.render(<ExtensionManager ctx={ctx} />));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(assetReads.map((args) => args.slice(0, 4))).toEqual([[current.id, "cover", themeDigest, assetDigest]]);
    expect(host.querySelector('img[alt="Cover image"]')?.getAttribute("src")).toBe("blob:approved-extension-image");
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Revoke access")?.click());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(host.querySelector('img[alt="Cover image"]')).toBeNull();
    expect(revoked).toContain("blob:approved-extension-image");
  } finally {
    flushSync(() => root.unmount()); host.remove();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: oldCreate });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: oldRevoke });
  }
});

test("package review persists only the checked HTTP methods and exact destinations", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const pkg = { manifest: { schemaVersion: 1, id: "demo.network", version: "1.0.0", name: "Network demo", description: "Review methods.", author: "Test", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [{ operation: "network.request", resources: [], fields: [], methods: ["GET", "POST"], destinations: ["https://api.example", "https://other.example"], purpose: "Send a request", required: true }], contributions: [] }, files: { "main.js": "" } };
  let applied: unknown[][] = [];
  const preview = { challenge: "challenge", expiresAt: Date.now() + 60_000, expectedRevision: -1, digest: "a".repeat(64), package: pkg, requestedOperations: ["network.request"], unsupported: [] };
  const extensions = { list: async () => [], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true, preview: async () => preview, install: async (...args: unknown[]) => { applied.push(args); return {} as never; }, previewInstalled: async () => preview, setGrants: async () => ({} as never), enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 0));
  const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new dom.window.File([JSON.stringify(pkg)], "extension.json", { type: "application/json" })] });
  flushSync(() => fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }))); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fileInput.value).toBe("");
  const labels = [...host.querySelectorAll("label")];
  flushSync(() => {
    labels.find((label) => label.textContent === "GET")?.querySelector("input")?.click();
    labels.find((label) => label.textContent?.includes("https://other.example"))?.querySelector("input")?.click();
  });
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Approve and install")?.click());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(applied[0]?.[1]).toMatchObject([{ operation: "network.request", methods: ["POST"], destinations: ["https://api.example"] }]);
  flushSync(() => root.unmount()); host.remove();
});

test("re-review keeps the existing exact scopes and custom budget until changed", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const currentGrant = { operation: "content.read", resources: [{ kind: "character", id: "char-1" }], fields: ["links"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 4, bytes: 1_000, tokens: 0 } };
  const current: InstalledExtensionSummary = { id: "demo.content", hostTrusted: false, revision: 9, digest: "c".repeat(64), name: "Content demo", version: "1.0.0", description: "Review current access", enabled: true, recoveryRequired: false, grants: [currentGrant], requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  const pkg = { manifest: { schemaVersion: 1, id: "demo.content", version: "1.0.0", name: "Content demo", description: "Review current access", author: "Test", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [{ operation: "content.read", resources: ["character"], fields: ["body", "links"], methods: [], destinations: [], purpose: "Read a selected character", required: true }], contributions: [] }, files: { "main.js": "" } };
  const preview = { challenge: "fresh-review", expiresAt: Date.now() + 60_000, expectedRevision: 9, digest: current.digest, package: pkg, requestedOperations: ["content.read"], unsupported: [] };
  const applied: unknown[][] = [];
  const extensions = { list: async () => [current], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true, preview: async () => preview, install: async () => ({} as never), previewInstalled: async () => preview, setGrants: async (...args: unknown[]) => { applied.push(args); return {} as never; }, enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review access")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  const labels = [...host.querySelectorAll("label")];
  expect((labels.find((label) => label.textContent === "links")?.querySelector("input") as HTMLInputElement).checked).toBe(true);
  expect((labels.find((label) => label.textContent === "body")?.querySelector("input") as HTMLInputElement).checked).toBe(false);
  expect(host.querySelector<HTMLInputElement>('input[placeholder="resource id, resource id"]')?.value).toBe("char-1");
  expect([...host.querySelectorAll("select")].some((select) => select.value === "custom")).toBe(true);
  expect([...host.querySelectorAll("select")].some((select) => select.value === "persistent")).toBe(true);
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Apply access review")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(applied[0]?.slice(0, 2)).toEqual(["demo.content", "fresh-review"]);
  expect(applied[0]?.[2]).toMatchObject([{ operation: "content.read", resources: [{ kind: "character", id: "char-1" }], fields: ["links"], duration: "persistent", budget: currentGrant.budget }]);
  flushSync(() => root.unmount()); host.remove();
});

test("settings editor loads the installed schema and saves against the displayed revision", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const item: InstalledExtensionSummary = { id: "demo.settings", hostTrusted: false, revision: 3, digest: "d".repeat(64), name: "Settings demo", version: "1.0.0", description: "Settings", enabled: true, recoveryRequired: false,
    grants: [{ operation: "settings.update", resources: [], fields: ["settings"], methods: [], destinations: [], duration: "session", budget: { requests: 10, bytes: 10_000, tokens: 0 } }], requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  const writes: unknown[][] = [];
  const extensions = { list: async () => [item], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true,
    readSettings: async () => ({ schema: { type: "string", maxLength: 80 }, value: "before", revision: 4 }),
    writeSettings: async (...args: unknown[]) => { writes.push(args); return { status: "saved", revision: 5 }; },
    preview: async () => ({} as never), install: async () => ({} as never), previewInstalled: async () => ({} as never), setGrants: async () => ({} as never), enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), uninstall: async () => true, answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Edit settings")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!; const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  flushSync(() => { setter?.call(input, "after"); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Save settings")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toEqual([["demo.settings", "after", 4]]); expect(host.textContent).toContain("Settings saved.");
  flushSync(() => root.unmount()); host.remove();
});

test("uninstall requires an explicit confirmation and uses the displayed revision", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const item: InstalledExtensionSummary = { id: "demo.remove", hostTrusted: false, revision: 8, digest: "c".repeat(64), name: "Remove demo", version: "1.0.0", description: "Remove", enabled: false, recoveryRequired: false, grants: [], requirements: [], contributions: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], settings: undefined, theme: null, themeScopes: [], activity: [], dataKeys: [], dataBytes: 0 };
  const removed: unknown[][] = [];
  const extensions = { list: async () => [item], revision: async () => "one", pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions, answerHostAction: async () => true,
    preview: async () => ({} as never), install: async () => ({} as never), previewInstalled: async () => ({} as never), setGrants: async () => ({} as never), enable: async () => ({} as never), disable: async () => ({} as never), revoke: async () => ({} as never), uninstall: async (...args: unknown[]) => { removed.push(args); return true; }, answerEffect: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove extension")?.click());
  expect(host.textContent).toContain("Remove Remove demo?"); expect(removed).toEqual([]);
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove extension and data")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(removed).toEqual([["demo.remove", 8]]);
  flushSync(() => root.unmount()); host.remove();
});

test("manager previews a bounded real scene draft through its local prompt hook route", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionManager }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./extensions")]);
  const calls: unknown[][] = [];
  const preview = { sceneId: "scene-1", label: "Local prompt preview; no model called; unshaped and unbudgeted." as const,
    messages: [{ role: "system" as const, content: "Canonical assembly." }, { role: "system" as const, content: "Hook candidate." }, { role: "user" as const, content: "Draft text." }] };
  const extensions = { list: async () => [], revision: async () => "one", promptScenes: async () => [{ id: "scene-1", title: "Night Watch" }],
    previewPrompts: async (...args: unknown[]) => { calls.push(args); return preview; }, pendingEffects: async () => [], pendingFileActions: async () => [], hostActions: emptyHostActions,
    answerHostAction: async () => true, answerEffect: async () => true, preview: async () => ({} as never), install: async () => ({} as never),
    previewInstalled: async () => ({} as never), setGrants: async () => ({} as never), enable: async () => ({} as never), disable: async () => ({} as never),
    revoke: async () => ({} as never), uninstall: async () => true, activate: async () => ({ status: "completed" as const, output: null }) } as never;
  const ctx = { api: { extensions, listEntities: async () => [], getLightEditableEntity: async () => ({ entity: null }) }, prefs: { get: () => undefined, set: () => undefined }, appearance: { get: () => ({}) } } as unknown as AppContext;
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host); const root = createRoot(host);
  flushSync(() => root.render(<ExtensionManager ctx={ctx} />)); await new Promise((resolve) => setTimeout(resolve, 0));
  const textarea = host.querySelector("textarea")!; const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  flushSync(() => { setValue?.call(textarea, "Draft text."); textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Preview prompt hooks")?.click()); await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual([["scene-1", "Draft text."]]); expect(host.textContent).toContain(preview.label); expect(host.textContent).toContain("Hook candidate.");
  flushSync(() => root.unmount()); host.remove();
});
