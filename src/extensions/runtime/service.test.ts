/** Fenced lifecycle tests use isolated in-memory fixtures and explicit approval digests. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { z } from "zod";
import { createExtensionService } from "./service";
import type { ExtensionOperationDescriptor } from "../contracts/operation";
import { digestJson } from "../contracts/value";
import { handleExtensionRoutes } from "../../ui/server-extension-runtime";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { readLegacyThemeMigrations } from "../legacy-theme-migrations";
import { fixtureThemePackage } from "../theme-test-fixture";
import { inspectThemePackage } from "../theme-contract";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperations as createApiOperations } from "../operations/api/describe";
import { EXTENSION_BUDGET_PRESETS } from "../contracts/operation";
import { decodeJsonValue } from "../contracts/value";
import type { PendingExtensionFileAction } from "../contracts/file-actions";
import { extensionOperationMetadata } from "../../generated/extension-operation-metadata";
import { createOperations as createPromptOperations, promptOperations } from "../operations/prompts/operations";
import { adaptBundledThemePackage } from "../contracts/package-validation";
import { bindExtensionOperation } from "../contracts/operation";
import { settingsWriteOperations } from "../operations/settings/update";
import { extensionSettingsServices } from "./settings-services";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { extensionContentServices } from "./content-services";
import { createHostActionPort } from "./host-action-port";
import { createOperations as createUiOperations } from "../operations/ui/operations";
import { createOperations as createCommandOperations } from "../operations/commands/register";
import { extensionCommandServices } from "./command-services";
import { createExtensionConfirmations } from "./confirmation";

const pkg = (required = false) => ({ manifest: { schemaVersion: 1 as const, id: "example.extension", version: "1.0.0", name: "Example", description: "fixture", author: "tests", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
  requirements: required ? [{ operation: "content.read", resources: ["character"], fields: ["identity"], methods: [], destinations: [], purpose: "fixture read", required: true }] : [], contributions: [] }, files: { "main.js": "bunzai.extension.define({commands:{run:()=>null}});" } });
const readOperation: ExtensionOperationDescriptor<{ id: string }, { name: string }> = {
  id: "content.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read", description: "Read fixture data.",
  input: z.strictObject({ id: z.string() }), output: z.strictObject({ name: z.string() }), effect: "read", sensitivity: "private", hosts: ["terminal"],
  policy: { resources: ["character"], fields: ["identity"], methods: [], destinationMode: "none", destinations: [], budget: "read-small", confirmation: "none" },
  estimateBudget: () => ({ bytes: 1, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ id }) => ({ resources: [{ kind: "character", id }], fields: ["identity"], methods: [], destinations: [] }), project: (value) => value,
  execute: async ({ id }) => ({ name: id }),
};

test("install requires a reviewed digest and every write follows the runtime fence", async () => {
  let time = 1;
  const store = memoryExtensionStore(() => time);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "fixture", host: "terminal", operations: [], now: () => time, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  const lease = await service.start();
  expect(lease.recoveryRequired).toBe(false);
  const preview = await service.preview(pkg());
  const installed = await service.install(preview.challenge, [], [], preview.expectedRevision);
  expect(installed.enabled).toBe(false);
  await expect(service.install(preview.challenge, [], [], preview.expectedRevision)).rejects.toThrow("inspect it again");
  const enabled = await service.enable(installed.id, installed.revision);
  expect(enabled.enabled).toBe(true);
  const revoked = await service.revoke(installed.id, enabled.revision);
  expect(revoked.enabled).toBe(false);
  await expect(service.enable(installed.id, revoked.revision)).rejects.toThrow("grant review");
  const review = await service.previewInstalled(installed.id);
  const reviewed = await service.setGrants(installed.id, review.challenge, [], [], review.expectedRevision);
  expect((await service.enable(installed.id, reviewed.revision)).enabled).toBe(true);
  expect((await store.readControl(installed.id))?.grants).toEqual([]);
  await service.close();
  time++;
});

test("the public preview/install routes accept the exact packed artifact envelope", async () => {
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "fixture", host: "terminal", operations: [], now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  const packageInput = pkg();
  const artifact = { schemaVersion: 1, digest: await digestJson(packageInput), package: packageInput };
  const post = async (path: string, body: unknown): Promise<Response> => {
    const url = new URL(`http://127.0.0.1/api/extensions/${path}`);
    const request = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await handleExtensionRoutes(request, url, service))!;
  };
  const reviewResponse = await post("preview", { input: artifact });
  expect(reviewResponse.status).toBe(200);
  const review = await reviewResponse.json() as { challenge: string; digest: string; expectedRevision: number };
  expect(review.digest).toBe(artifact.digest);
  const installResponse = await post("install", { challenge: review.challenge, grants: [], themeScopes: [], expectedRevision: review.expectedRevision });
  expect(installResponse.status).toBe(200);
  const installed = await installResponse.json() as { packageDigest: string };
  expect(installed.packageDigest).toBe(artifact.digest);
  expect(await store.readPackage(artifact.digest)).not.toBeNull();
  await service.close();
});

test("packed inspector command activates through the real Bun worker and public route", async () => {
  const source = join(import.meta.dir, "../examples/bunzai.extension.inspector");
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as unknown;
  const sdkPath = join(import.meta.dir, "../sdk/index.ts");
  const built = await Bun.build({ entrypoints: [join(source, "main.js")], target: "browser", packages: "bundle", minify: true,
    plugins: [{ name: "bunzai-sdk", setup(build) { build.onResolve({ filter: /^bunzai-extension-sdk$/ }, () => ({ path: sdkPath })); } }] });
  expect(built.success).toBe(true);
  const entry = await built.outputs[0]!.text();
  const packageInput = { manifest, files: { "main.js": entry } };
  const artifact = { schemaVersion: 1, digest: await digestJson(packageInput), package: packageInput };
  const operation = createApiOperations({ content: {} as never })[0]!;
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "worker-fixture", host: "desktop", operations: [operation],
    operationMetadata: extensionOperationMetadata.filter((item) => item.id === "api.describe").map((item) => decodeJsonValue(item)), now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  const review = await service.preview(artifact);
  const grant = { operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata };
  const installed = await service.install(review.challenge, [grant], [], review.expectedRevision);
  await service.enable(installed.id, installed.revision);
  const url = new URL("http://127.0.0.1/api/extensions/activate");
  const request = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: installed.id, kind: "command", contributionId: "inspect", input: null }) });
  const response = (await handleExtensionRoutes(request, url, service))!;
  if (response.status !== 200) throw new Error(JSON.stringify(await response.json()));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "completed", output: { availableOperations: [expect.objectContaining({ id: "api.describe", granted: true })] } });
  expect(await store.listReceipts(installed.id, null, 10)).toContainEqual(expect.objectContaining({ operation: "api.describe", status: "completed" }));
  await service.close();
});

test("packed command returns a host-rendered descriptor through the public activation route", async () => {
  const source = `bunzai.extension.define({commands:{render:()=>({type:"bunzai.ui",descriptor:{version:1,root:{type:"text",text:"Safe panel"}}})}});`;
  const built = await Bun.build({ entrypoints: ["fixture.js"], target: "browser", packages: "bundle", minify: true,
    plugins: [{ name: "panel-fixture", setup(build) {
      build.onResolve({ filter: /^fixture\.js$/u }, () => ({ path: "fixture.js", namespace: "panel-fixture" }));
      build.onLoad({ filter: /.*/u, namespace: "panel-fixture" }, () => ({ contents: source, loader: "js" }));
    } }] });
  expect(built.success).toBe(true);
  const packageInput = { manifest: { schemaVersion: 1 as const, id: "example.panel", version: "1.0.0", name: "Panel", description: "fixture", author: "tests",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
    requirements: [{ operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], purpose: "Exercise a bounded renderer result", required: true }],
    contributions: [{ type: "command" as const, id: "render", label: "Render", operation: "api.describe" }] }, files: { "main.js": await built.outputs[0]!.text() } };
  const artifact = { schemaVersion: 1, digest: await digestJson(packageInput), package: packageInput };
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const operation = createApiOperations({ content: {} as never })[0]!;
  const service = createExtensionService({ store, storeId: "ui-worker-fixture", host: "desktop", operations: [operation],
    operationMetadata: extensionOperationMetadata.filter((item) => item.id === "api.describe").map((item) => decodeJsonValue(item)), now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    const preview = await service.preview(artifact);
    const installed = await service.install(preview.challenge, [{ operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.metadata }], [], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const url = new URL("http://127.0.0.1/api/extensions/activate");
    const request = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: installed.id, kind: "command", contributionId: "render", input: null }) });
    const response = (await handleExtensionRoutes(request, url, service))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "completed", output: null, descriptor: { version: 1, root: { type: "text", text: "Safe panel" } } });
  } finally { await service.close(); }
});

test("brokered command registration updates the host-visible command subset", async () => {
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const operations = createCommandOperations({ content: {} as never, commands: extensionCommandServices(store) });
  const service = createExtensionService({ store, storeId: "command-registration-fixture", host: "desktop", operations,
    operationMetadata: extensionOperationMetadata.filter((item) => item.id === "commands.register").map((item) => decodeJsonValue(item)),
    now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, confirmEffect: async () => true });
  await service.start();
  try {
    const input = { manifest: { schemaVersion: 1 as const, id: "example.command-menu", version: "1.0.0", name: "Menu", description: "", author: "test",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
      requirements: [{ operation: "commands.register", resources: [], fields: ["commands"], methods: [], destinations: [], purpose: "Choose visible package commands", required: true }],
      contributions: ["configure", "run", "hidden"].map((id) => ({ type: "command" as const, id, label: id, operation: "commands.register" })) },
      files: { "main.js": `bunzai.extension.define({commands:{configure:async()=>await bunzai.call("commands.register",{commandIds:["run"]}),run:()=>null,hidden:()=>null}});` } };
    const preview = await service.preview(input);
    const installed = await service.install(preview.challenge, [{ operation: "commands.register", resources: [], fields: ["commands"], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.write }], [], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    await service.activate(installed.id, "command", "configure", null);
    expect((await service.list())[0]).toMatchObject({ registeredCommands: ["run"] });
    expect(await service.activate(installed.id, "command", "run", null)).toMatchObject({ status: "completed", output: null });
    await expect(service.activate(installed.id, "command", "hidden", null)).rejects.toThrow("not registered");
  } finally { await service.close(); }
});

test("prompt hooks contribute and replace only their own scene-scoped candidate", async () => {
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const operations = createPromptOperations({ content: {} as never });
  const service = createExtensionService({ store, storeId: "prompt-fixture", host: "terminal", operations,
    operationMetadata: extensionOperationMetadata.filter((item) => item.id.startsWith("prompts.")).map((item) => decodeJsonValue(item)), now: () => 1,
    previewPrompts: async (sceneId, draft) => ({ sceneId, label: "Local prompt preview; no model called; unshaped and unbudgeted." as const, messages: [{ role: "system", content: "Base scene context." }, { role: "user", content: draft }] }),
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  const input = { manifest: { schemaVersion: 1, id: "example.prompt", version: "1.0.0", name: "Prompt", description: "fixture", author: "tests", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
    requirements: ["prompts.contribute", "prompts.transform"].map((operation) => ({ operation, resources: ["scene"], fields: ["system.append"], methods: [], destinations: [], purpose: "change this hook's named prompt candidate", required: false })),
    contributions: [{ type: "prompt", id: "inspect", label: "Inspect", stage: "system.append" }, { type: "prompt", id: "append", label: "Append", stage: "system.append", priority: 0 }] },
    files: { "main.js": `bunzai.extension.define({events:{inspect:async()=>{await bunzai.call("prompts.inspect",{sceneId:"scene-1"})},append:async()=>{await bunzai.call("prompts.contribute",{sceneId:"scene-1",stage:"system.append",text:"Draft candidate."});await bunzai.call("prompts.transform",{sceneId:"scene-1",stage:"system.append",text:"Keep the answer gentle."})}}});` } };
  const preview = await service.preview(input);
  const grants = ["prompts.contribute", "prompts.transform"].map((operation) => ({ operation, resources: [{ kind: "scene", id: "scene-1" }], fields: ["system.append"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata }));
  const installed = await service.install(preview.challenge, grants, [], preview.expectedRevision);
  await service.enable(installed.id, installed.revision);
  const messages = [{ role: "system" as const, content: "Speak as the guide." }];
  expect(await service.applyPromptContributions("scene-1", messages, new AbortController().signal)).toEqual(["Keep the answer gentle."]);
  expect(await store.listReceipts(installed.id, null, 10)).toContainEqual(expect.objectContaining({ operation: "prompts.contribute", status: "committed" }));
  expect(await store.listReceipts(installed.id, null, 10)).toContainEqual(expect.objectContaining({ operation: "prompts.transform", status: "committed" }));
  expect(await store.listReceipts(installed.id, null, 10)).toHaveLength(2);
  expect(await service.applyPromptContributions("scene-2", messages, new AbortController().signal)).toEqual([]);
  const localPreview = await service.previewPrompts("scene-1", "What happens next?");
  expect(localPreview.label).toBe("Local prompt preview; no model called; unshaped and unbudgeted.");
  expect(localPreview.messages.map(({ role, content }) => [role, content])).toEqual([
    ["system", "Base scene context."], ["system", "Keep the answer gentle."], ["user", "What happens next?"],
  ]);
  await service.close();
});

test("session grants expire on service close and do not revive after reopening the same store", async () => {
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const make = () => createExtensionService({ store, storeId: "fixture", host: "terminal", operations: [readOperation], now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  const first = make();
  await first.start();
  const preview = await first.preview(pkg(true));
  const grant = { operation: "content.read", resources: [{ kind: "character", id: "c1" }], fields: ["identity"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 2, bytes: 100, tokens: 0 } };
  const installed = await first.install(preview.challenge, [grant], [], preview.expectedRevision);
  const enabled = await first.enable(installed.id, installed.revision);
  expect(enabled.enabled).toBe(true);
  await first.close();
  const afterClose = await store.readControl(installed.id);
  expect(afterClose).toMatchObject({ enabled: false, recoveryRequired: true, grants: [] });
  const second = make();
  await second.start();
  expect(await store.readControl(installed.id)).toMatchObject({ grants: [], recoveryRequired: true });
  await second.close();
});

test("post-read refresh refuses a result after another owner disables the control", async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const paused: ExtensionOperationDescriptor<{ id: string }, { name: string }> = { ...readOperation,
    execute: async ({ id }) => { entered(); await waiting; return { name: id }; } };
  const input = { manifest: { schemaVersion: 1 as const, id: "example.extension", version: "1.0.0", name: "Example", description: "fixture", author: "tests",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
    requirements: [{ operation: "content.read", resources: ["character"], fields: ["identity"], methods: [], destinations: [], purpose: "fixture read", required: true }],
    contributions: [{ type: "command" as const, id: "run", label: "Run", operation: "content.read" }] },
    files: { "main.js": `bunzai.extension.define({commands:{run:()=>bunzai.call("content.read",{id:"Ada"}).catch(()=>null)}});` } };
  const store = memoryExtensionStore(() => 1_000);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "fixture", host: "terminal", operations: [paused], now: () => 1_000,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  const lease = await service.start();
  try {
    const preview = await service.preview(input);
    const grant = { operation: "content.read", resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [],
      duration: "persistent" as const, budget: { requests: 2, bytes: 100, tokens: 0 } };
    const installed = await service.install(preview.challenge, [grant], [], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const activation = service.activate(installed.id, "command", "run", null);
    await started;
    const live = await store.readControl(installed.id);
    if (!live) throw new Error("installed control missing");
    expect(await store.compareAndSaveControl({ ...live, enabled: false, revision: live.revision + 1 }, live.revision, lease)).toBe("saved");
    release();
    expect(await activation).toMatchObject({ status: "completed", output: null });
    expect(await store.listReceipts(installed.id, null, 10)).toContainEqual(expect.objectContaining({ operation: "content.read", status: "ambiguous" }));
  } finally {
    release();
    await service.close();
  }
});

test("legacy theme approvals migrate once into the extension store and remain idempotent", async () => {
  const legacyState = memoryStateStore();
  const theme = await fixtureThemePackage("bunzai.theme.legacy", "Legacy theme");
  const legacyReview = await inspectThemePackage(theme);
  const legacyDoc: { version: number; entries: Record<string, unknown> } = { version: 1, entries: { [legacyReview.id]: { input: theme, digest: legacyReview.digest, scopes: legacyReview.derivedScopes, enabled: true, host: false } } };
  legacyDoc.entries.broken = { host: false, enabled: true, scopes: ["bad"], digest: "bad", input: { manifest: { id: "broken" } } };
  await legacyState.write("themeExtensions", JSON.stringify(legacyDoc));
  const importIssues: unknown[] = [];
  const migrations = await readLegacyThemeMigrations(legacyState, (issue) => importIssues.push(issue));
  expect(migrations).toHaveLength(1);
  expect(importIssues).toEqual([{ id: "broken", code: "package-changed" }]);
  expect((await legacyState.read("themeExtensions"))!).toContain('"broken"');

  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const makeService = () => createExtensionService({ store, storeId: "fixture", host: "terminal", operations: [], legacyThemes: migrations, now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  const first = makeService();
  await first.start();
  const migrated = await store.readControl("bunzai.theme.legacy");
  expect(migrated).toMatchObject({ enabled: true, hostTrusted: false, legacyThemeImport: "complete" });
  await first.close();

  const second = makeService();
  await second.start();
  expect(await store.readControl("bunzai.theme.legacy")).toEqual(migrated);
  await second.close();
});

test("trusted built-ins can be re-enabled and freshly reviewed only from their host inventory", async () => {
  const store = memoryExtensionStore(() => 1); let sequence = 0;
  const sourceTheme = await fixtureThemePackage("bunzai.theme.fixture", "Trusted fixture");
  const builtin = await adaptBundledThemePackage(sourceTheme, "fixture");
  const service = createExtensionService({ store, storeId: "builtin-fixture", host: "desktop", operations: [], builtinPackages: [builtin], now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    const seeded = await store.readControl(builtin.manifest.id);
    expect(seeded).toMatchObject({ hostTrusted: true, enabled: true });
    const disabled = await service.disable(seeded!.id, seeded!.revision);
    expect((await service.enable(disabled.id, disabled.revision)).enabled).toBe(true);
    const current = await service.revoke(disabled.id, (await store.readControl(disabled.id))!.revision);
    expect(current).toMatchObject({ hostTrusted: true, enabled: false, recoveryRequired: true, themeScopes: [] });
    const review = await service.previewInstalled(current.id);
    const reviewed = await service.setGrants(current.id, review.challenge, [], review.package.manifest.theme?.requests ?? [], review.expectedRevision);
    expect(reviewed).toMatchObject({ hostTrusted: true, enabled: false, recoveryRequired: false });
    expect((await service.enable(reviewed.id, reviewed.revision)).enabled).toBe(true);
    await expect(service.preview(builtin)).rejects.toThrow("reserved by the host");
  } finally { await service.close(); }
});

test("host settings editor uses the installed schema and data revision CAS", async () => {
  const store = memoryExtensionStore(() => 1); let sequence = 0;
  const settings = extensionSettingsServices(store);
  const content = extensionContentServices(createContentStore(memoryDocumentBackend()));
  const operations = settingsWriteOperations.map((definition) => bindExtensionOperation(definition, { content, settings }));
  const service = createExtensionService({ store, storeId: "settings-fixture", host: "desktop", operations, now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    const base = pkg();
    const input = { manifest: { ...base.manifest,
      requirements: [{ operation: "settings.update", resources: [], fields: ["settings"], methods: [], destinations: [], purpose: "user-managed preferences", required: true }],
      settingsSchema: { type: "object" as const, properties: { enabled: { type: "boolean" as const } }, required: ["enabled"], additionalProperties: false as const }, settings: { enabled: false } }, files: base.files };
    const preview = await service.preview(input);
    const grant = { operation: "settings.update", resources: [], fields: ["settings"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write };
    const installed = await service.install(preview.challenge, [grant], [], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    expect(await service.readSettings(installed.id)).toMatchObject({ value: { enabled: false }, revision: -1 });
    expect(await service.writeSettings(installed.id, { enabled: true }, -1)).toEqual({ status: "saved", revision: 0 });
    expect(await service.readSettings(installed.id)).toMatchObject({ value: { enabled: true }, revision: 0 });
    await expect(service.writeSettings(installed.id, { enabled: false }, -1)).rejects.toThrow("Settings changed elsewhere");
    const current = await store.readControl(installed.id);
    await service.revoke(installed.id, current!.revision);
    await expect(service.writeSettings(installed.id, { enabled: false }, 0)).rejects.toThrow("Approve settings.update");
  } finally { await service.close(); }
});

test("uninstall removes only the expected user package and its private store data", async () => {
  const store = memoryExtensionStore(() => 1); let sequence = 0;
  const service = createExtensionService({ store, storeId: "uninstall-fixture", host: "desktop", operations: [], now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    const preview = await service.preview(pkg());
    const installed = await service.install(preview.challenge, [], [], preview.expectedRevision);
    expect(await service.uninstall(installed.id, installed.revision)).toBe(true);
    expect(await store.readControl(installed.id)).toBeNull();
    expect(await store.readPackage(installed.packageDigest)).toBeNull();
    await expect(service.uninstall(installed.id, installed.revision)).rejects.toThrow("no longer installed");
  } finally { await service.close(); }
});

test("a file write result, not a boolean, settles its linked effect review", async () => {
  const ticket: PendingExtensionFileAction = { id: "file-ticket", packageId: "bunzai.extension.writer", packageName: "Writer", principal: {
    storeId: "fixture", packageId: "bunzai.extension.writer", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 1,
  }, operation: "files.write.apply", action: "write", handleId: "opaque", fileName: "out.txt", mode: "create", current: { size: 0, lastModified: 0, digest: "b".repeat(64) }, proposedBytes: 3, proposedDigest: "c".repeat(64), expiresAt: 1000 };
  const effect = { id: "effect-ticket", packageId: ticket.packageId, packageName: ticket.packageName, operation: "files.write.apply", effect: "write", resources: [], fields: ["file.contents"], methods: [], destinations: [], review: { hostAction: { kind: "bunzai.file.write", ticketId: ticket.id } }, expiresAt: 1000 };
  let pending = true;
  let expectedAnswer = "written";
  let answeredEffect: boolean | undefined;
  const fileActions = { pending: () => pending ? [ticket] : [], answer: (id: string, answer: unknown) => { if (id !== ticket.id) return false; pending = false; return (answer as { status?: string }).status === expectedAnswer; },
    beginWrite: () => true, startedWritesForPackage: () => [], setStartedWriteExpiryHandler: () => undefined, invalidatePackage: () => 0, close: () => undefined } as never;
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "fixture", host: "desktop", operations: [], fileActions, now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    pendingEffects: () => pending ? [effect] : [], answerEffect: (_id, approved) => { answeredEffect = approved; return true; } });
  await service.start();
  expect(await service.answerEffect(effect.id, true)).toBe(false);
  expect(await service.answerFileAction(ticket.id, { status: "written", bytes: 3, digest: ticket.proposedDigest, consistency: "checked-before-write" })).toBe(true);
  expect(answeredEffect).toBe(true);
  pending = true;
  expectedAnswer = "ambiguous";
  expect(await service.answerFileAction(ticket.id, { status: "ambiguous", bytes: 3, digest: ticket.proposedDigest, consistency: "commit-unknown" })).toBe(true);
  expect(answeredEffect).toBe(true);
  await service.close();
});

test("begun native file writes settle ambiguous before revoke aborts their run", async () => {
  const store = memoryExtensionStore(() => 1), confirmations = createExtensionConfirmations({ now: () => 1, id: () => "effect-ticket" });
  let staged: PendingExtensionFileAction | null = null, settled: "written" | "ambiguous" | "cancelled" | null = null, protectedWrite = false;
  let finishWrite!: (status: "written" | "ambiguous" | "cancelled") => void;
  const fileActions = {
    pending: () => staged ? [staged] : [],
    reviewWrite: () => ({ fileName: "out.txt", mode: "create" as const, current: { size: 0, lastModified: 1, digest: "b".repeat(64) }, proposedBytes: 3, proposedDigest: "c".repeat(64) }),
    stageWrite: ({ packageName, principal }: { packageName: string; principal: import("../contracts/operation").OperationPrincipal; previewId: string }) => {
      staged = { id: "write-ticket", packageId: principal.packageId, packageName, principal: { storeId: principal.storeId, packageId: principal.packageId,
        packageDigest: principal.packageDigest, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch }, operation: "files.write.apply", action: "write",
        handleId: "opaque", fileName: "out.txt", mode: "create", current: { size: 0, lastModified: 1, digest: "b".repeat(64) }, proposedBytes: 3,
        proposedDigest: "c".repeat(64), expiresAt: 1000 };
      return staged;
    },
    beginWrite: (id: string) => { if (staged?.id !== id || protectedWrite) return false; protectedWrite = true; return true; },
    startedWritesForPackage: (id: string) => protectedWrite && staged?.packageId === id ? [staged.id] : [],
    setStartedWriteExpiryHandler: () => undefined,
    write: () => settled ? Promise.resolve(settled) : new Promise<"written" | "ambiguous" | "cancelled">((resolve) => { finishWrite = resolve; }),
    answer: (id: string, answer: unknown) => {
      if (staged?.id !== id) return false;
      const status = (answer as { status: "written" | "ambiguous" | "cancelled" }).status;
      settled = status; staged = null; finishWrite?.(status); return true;
    },
    invalidatePackage: () => 0,
    close: () => undefined,
  } as unknown as import("./file-action-port").HostFileActionPort;
  const write: ExtensionOperationDescriptor<{ previewId: string }, { written: boolean }> = {
    id: "files.write.apply", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Write", description: "fixture",
    input: z.strictObject({ previewId: z.string() }), output: z.strictObject({ written: z.boolean() }), effect: "write", sensitivity: "private", hosts: ["desktop"],
    policy: { resources: [], fields: ["file.contents"], methods: [], destinations: [], destinationMode: "none", budget: "write", confirmation: "effect" },
    estimateBudget: () => ({ bytes: 100, tokens: 0 }), measureTokens: () => 0, resolveAccess: () => ({ resources: [], fields: ["file.contents"], methods: [], destinations: [] }),
    project: (value) => value,
    review: async (_args, context) => { const ticket = fileActions.stageWrite({ packageName: context.principal.packageId, principal: context.principal, previewId: "p", signal: context.signal }); return { hostAction: { kind: "bunzai.file.write", ticketId: ticket.id } }; },
    execute: async () => { const result = settled ?? await new Promise<"written" | "ambiguous" | "cancelled">((resolve) => { finishWrite = resolve; }); if (result !== "written") throw new Error("write uncertain"); return { written: true }; },
  };
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "write-race", host: "desktop", operations: [write], fileActions,
    now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    confirmEffect: (packageId, packageName, effect, signal) => confirmations.request(packageId, packageName, effect, signal),
    pendingEffects: () => confirmations.list(), answerEffect: (id, approved) => confirmations.answer(id, approved) });
  await service.start();
  try {
    const packageInput = { ...pkg(), manifest: { ...pkg().manifest,
      requirements: [{ operation: "files.write.apply", resources: [], fields: ["file.contents"], methods: [], destinations: [], purpose: "write a reviewed file", required: true }],
      contributions: [{ type: "command" as const, id: "run", label: "Run", operation: "files.write.apply" }],
    }, files: { "main.js": `bunzai.extension.define({commands:{run:async()=>{try{await bunzai.call("files.write.apply",{previewId:"p"})}catch{}await new Promise(()=>{})}}});` } };
    const preview = await service.preview(packageInput);
    const grant = { operation: "files.write.apply", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write };
    const installed = await service.install(preview.challenge, [grant], [], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const activation = service.activate(installed.id, "command", "run", null).catch(() => null);
    for (let attempt = 0; attempt < 100 && fileActions.pending().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    const ticket = fileActions.pending().find((item) => item.action === "write");
    expect(ticket?.action).toBe("write");
    expect(await service.beginFileWrite(ticket!.id)).toBe(true);
    const current = (await service.list()).find((item) => item.id === installed.id)!;
    const disabled = service.disable(installed.id, current.revision).then(() => true);
    for (let attempt = 0; attempt < 100 && (await service.list()).find((item) => item.id === installed.id)?.enabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(service.activate(installed.id, "command", "run", null)).rejects.toThrow();
    expect(await Promise.race([disabled, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000))])).toBe(true);
    await activation;
    const receipts = await store.listReceipts(installed.id, null, 5);
    expect(receipts.map((receipt) => receipt.status)).toEqual(["ambiguous"]);
  } finally { await service.close(); }
});

test("a displayed host action cannot be claimed after its extension is disabled", async () => {
  const hostActions = createHostActionPort({ now: () => 1, id: () => "claim-ticket" });
  const operation = createUiOperations({ content: {} as never, hostActions }).find((item) => item.id === "ui.dialog.request")!;
  const packageInput = { ...pkg(), manifest: { ...pkg().manifest,
    requirements: [{ operation: "ui.dialog.request", resources: [], fields: ["dialog"], methods: [], destinations: [], purpose: "Ask the host a fixture question", required: true }],
    contributions: [{ type: "command" as const, id: "ask", label: "Ask", operation: "ui.dialog.request" }],
  }, files: { "main.js": `bunzai.extension.define({commands:{ask:async()=>bunzai.call("ui.dialog.request",{message:"Proceed?"})}});` } };
  const store = memoryExtensionStore(() => 1);
  let sequence = 0;
  const service = createExtensionService({ store, storeId: "claim-fixture", host: "desktop", operations: [operation], hostActions,
    operationMetadata: extensionOperationMetadata.filter((item) => item.id === "ui.dialog.request").map((item) => decodeJsonValue(item)), now: () => 1,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  try {
    const review = await service.preview(packageInput);
    const installed = await service.install(review.challenge, [{ operation: "ui.dialog.request", resources: [], fields: ["dialog"], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.metadata }], [], review.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const activation = service.activate(installed.id, "command", "ask", null).catch(() => null);
    for (let attempt = 0; attempt < 100 && hostActions.actions().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    const ticket = hostActions.actions()[0];
    expect(ticket?.action).toBe("ui.dialog.request");
    const before = (await service.list()).find((item) => item.id === installed.id)!;
    await service.disable(installed.id, before.revision);
    expect(await service.claimHostAction(ticket!.id)).toBeNull();
    await activation;
  } finally {
    await service.close();
  }
});
