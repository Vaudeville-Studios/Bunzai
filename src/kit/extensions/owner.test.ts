/** Terminal composition proves the installed command runs through the real QuickJS Bun Worker. */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import { memoryChatStore } from "../../stage/store/chat-store";
import type { Provider } from "../../stage/contracts/provider";
import { providerConfigFingerprint } from "../providers/config-fingerprint";
import { createTerminalExtensionRuntime, readTerminalQuickJsWasm } from "./owner";

test("Terminal service activates only an enabled manifest command in the QuickJS worker", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal", version: "1.0.0", name: "Terminal fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [],
      contributions: [{ type: "command" as const, id: "run", label: "Run", operation: "test.run" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:()=>({fetch:typeof fetch,document:typeof document,value:"ok"})}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [], [], preview.expectedRevision);
    const installed = await runtime.list();
    await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision);
    now += 1;
    const result = await runtime.activate(pkg.manifest.id, "command", "run", null);
    expect(result).toEqual({ status: "completed", output: { fetch: "undefined", document: "undefined", value: "ok" } });
  } finally {
    await runtime.close();
  }
});

test("Terminal package uses the brokered tools.invoke port for real Kit docs discovery", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-tools-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal-tools", version: "1.0.0", name: "Terminal tools fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "tools.invoke", resources: ["kit-tool"], fields: ["tools.invoke"], methods: [], destinations: [], purpose: "search the reviewed local documentation corpus", required: true }],
      contributions: [{ type: "command" as const, id: "run", label: "Run", operation: "test.run" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:()=>bunzai.call("tools.invoke",{id:"docs_query",args:{action:"search",query:"extension",limit:1}})}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "tools.invoke", resources: [{ kind: "kit-tool", id: "docs_query" }], fields: ["tools.invoke"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 100_000, tokens: 0 } }], [], preview.expectedRevision);
    const installed = await runtime.list();
    await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision);
    now += 1;
    const result = await runtime.activate(pkg.manifest.id, "command", "run", null);
    expect(result.status).toBe("completed");
    expect(JSON.stringify(result.output)).toContain("docs search");
  } finally {
    await runtime.close();
  }
});

test("Terminal command registration persists only the manifest-declared subset", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-command-registration",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.commands", version: "1.0.0", name: "Command registration fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "commands.register", resources: [], fields: ["commands"], methods: [], destinations: [], purpose: "choose the package commands shown by the host", required: true }],
      contributions: ["run", "manage", "hidden"].map((id) => ({ type: "command" as const, id, label: id, operation: `test.${id}` })) },
      files: { "main.js": `bunzai.extension.define({commands:{run:()=>"visible",manage:()=>bunzai.call("commands.register",{commandIds:["run"]}),hidden:()=>"hidden"}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "commands.register", resources: [], fields: ["commands"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 4_000, tokens: 0 } }], [], preview.expectedRevision);
    const installed = await runtime.list();
    await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision);
    now += 1;
    const activation = runtime.activate(pkg.manifest.id, "command", "manage", null);
    let ticket: { id: string; operation: string } | undefined;
    for (let attempt = 0; attempt < 100 && !ticket; attempt++) {
      ticket = (await runtime.pendingEffects())[0];
      if (!ticket) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(ticket?.operation).toBe("commands.register");
    expect(await runtime.answerEffect(ticket!.id, true)).toBe(true);
    expect(await activation).toEqual({ status: "completed", output: { status: "saved", registered: ["run"], revision: expect.any(Number) } });
    expect((await runtime.list()).find((item) => item.id === pkg.manifest.id)?.registeredCommands).toEqual(["run"]);
    await expect(runtime.activate(pkg.manifest.id, "command", "hidden", null)).rejects.toThrow();
  } finally {
    await runtime.close();
  }
});

test("Terminal QuickJS selects a host path and reads through the opaque file-action relay", async () => {
  let now = 1_000, serial = 0;
  const dir = await mkdtemp(join(tmpdir(), "bunzai-terminal-extension-")), path = join(dir, "fixture.txt");
  await writeFile(path, "only the chosen file");
  const store = memoryExtensionStore(() => now);
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-file-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.file", version: "1.0.0", name: "Terminal file fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "files.pick", resources: [], fields: [], methods: [], destinations: [], purpose: "select one local file", required: true },
        { operation: "files.read", resources: [], fields: ["file.contents"], methods: [], destinations: [], purpose: "read the selected fixture", required: true },
      ],
      contributions: [{ type: "command" as const, id: "read", label: "Read selected file", operation: "test.read" }] },
      files: { "main.js": `bunzai.extension.define({commands:{read:async()=>{const file=await bunzai.call("files.pick",{mode:"read"});return bunzai.call("files.read",{handleId:file.id,maxBytes:100})}}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [
      { operation: "files.pick", resources: [], fields: [], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 190_000, tokens: 0 } },
      { operation: "files.read", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 1, bytes: 190_000, tokens: 0 } },
    ], [], preview.expectedRevision);
    const installed = await runtime.list(); await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision);
    now += 1;
    const activation = runtime.activate(pkg.manifest.id, "command", "read", null);
    const pick = await waitForFileAction(runtime, "pick");
    await runtime.processFileAction(pick.id, path);
    const read = await waitForFileAction(runtime, "read");
    await runtime.processFileAction(read.id);
    const result = await activation;
    const encoded = (result.output as { base64?: unknown } | null)?.base64;
    expect(typeof encoded).toBe("string");
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded as string), (char) => char.charCodeAt(0)))).toBe("only the chosen file");
    expect(JSON.stringify(result.output)).not.toContain(path);
  } finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Terminal macro preview requires fresh confirmation and returns the deterministic pure result", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const runtime = await createTerminalExtensionRuntime({
    store, content: createContentStore(memoryDocumentBackend()),
    stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }),
    chats: memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), storeId: "terminal-macro-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.macros", version: "1.0.0", name: "Terminal macro fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], purpose: "preview a fixed sample with explicitly supplied macro context", required: true }],
      contributions: [{ type: "command" as const, id: "preview", label: "Preview macros", operation: "test.preview" }] },
      files: { "main.js": `bunzai.extension.define({commands:{preview:()=>bunzai.call("macros.preview",{sample:"Hello {{char}}!",environment:{characterName:"Nova",randomSeed:7}})}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [{ operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 400_000, tokens: 0 } }], [], preview.expectedRevision);
    const item = (await runtime.list()).find((candidate) => candidate.id === pkg.manifest.id)!;
    await runtime.enable(item.id, item.revision); now += 1;
    const deniedRun = runtime.activate(pkg.manifest.id, "command", "preview", null);
    const deniedTicket = await waitForEffect(runtime);
    expect(deniedTicket.operation).toBe("macros.preview");
    expect(deniedTicket.review).toMatchObject({ sample: "Hello {{char}}!", environment: { characterName: "Nova", randomSeed: 7 } });
    await runtime.answerEffect(deniedTicket.id, false);
    await expect(deniedRun).rejects.toThrow();

    const approvedRun = runtime.activate(pkg.manifest.id, "command", "preview", null);
    const approvedTicket = await waitForEffect(runtime);
    expect(await runtime.answerEffect(approvedTicket.id, true)).toBe(true);
    const result = await approvedRun;
    expect(result).toMatchObject({ status: "completed", output: { text: "Hello Nova!", diagnostics: { errors: 0, sideEffects: 0 } } });
  } finally { await runtime.close(); }
});

test("Terminal QuickJS runs turns through the canonical scene core after host approval", async () => {
  let now = 1_000, serial = 0;
  const store = memoryExtensionStore(() => now);
  const content = createContentStore(memoryDocumentBackend());
  const chats = memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) });
  const character = { kind: "character", id: "fixture-character", body: { identity: { name: "Vera", description: "A detective" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Terminal turn", cast: { character: { id: "fixture-character", version: 1 } }, snapshot: { character } });
  await content.create({ schemaVersion: "1", kind: "regex", id: "terminal-redaction", body: { name: "Terminal redaction", rules: [{ id: "redact", label: "Redact", find: "hello", flags: "gi", replace: "greetings", phases: ["prompt"], enabled: true, sortOrder: 0 }] } });
  await chats.setRegex(chat.id, { sets: ["terminal-redaction"] });
  await chats.setConnection(chat.id, { id: "fixture-connection", model: "fixture-model" });
  await chats.appendMessages(chat.activeBranchId, [{ role: "user", content: "Say hello." }]);
  const page = await chats.readMessages(chat.activeBranchId, { limit: 1 });
  const requests: unknown[] = [];
  const fakeConfig = { id: "fixture-connection", kind: "fixture", model: "fixture-model" };
  const fingerprint = providerConfigFingerprint(fakeConfig, fakeConfig.model);
  const provider: Provider = { id: "fixture-connection", async send(request) { requests.push(request); return { content: "Hello from the fixture.", finish_reason: "stop", raw: {} }; } };
  const runtime = await createTerminalExtensionRuntime({
    store, content, stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), chats, storeId: "terminal-turn-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    isCoreScene: null,
    connectScene: async () => ({ provider, kind: "fixture", providerConfigFingerprint: fingerprint }),
    turnConnectionReader: async (_connectionId, model) => ({ fingerprint: providerConfigFingerprint(fakeConfig, model) }),
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.turn", version: "1.0.0", name: "Terminal turn fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "turns.start", resources: ["scene", "host-connection"], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"], purpose: "generate one scene reply with explicit host approval", required: true },
        { operation: "turns.status", resources: ["scene"], fields: ["turn.status"], methods: [], destinations: [], purpose: "check this extension's turn status", required: true },
        { operation: "turns.cancel", resources: ["scene"], fields: ["turn.cancel"], methods: [], destinations: [], purpose: "cancel this extension's in-flight scene turn", required: true },
      ],
      contributions: [{ type: "command" as const, id: "run", label: "Run approved turn", operation: "test.run" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:async()=>{const before=await bunzai.call("turns.status",{sceneId:${JSON.stringify(chat.id)}});const result=await bunzai.call("turns.start",{sceneId:${JSON.stringify(chat.id)},connectionId:"fixture-connection",expectedVersion:${page.branchVersion}});const after=await bunzai.call("turns.status",{sceneId:${JSON.stringify(chat.id)}});return {before,result,after}}}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [
      { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "fixture-connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"], duration: "session", budget: { requests: 10, bytes: 1_000_000, tokens: 50_000 } },
      { operation: "turns.status", resources: [{ kind: "scene", id: chat.id }], fields: ["turn.status"], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 4_000, tokens: 0 } },
      { operation: "turns.cancel", resources: [{ kind: "scene", id: chat.id }], fields: ["turn.cancel"], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 4_000, tokens: 0 } },
    ], [], preview.expectedRevision);
    const installed = await runtime.list(); await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision); now += 1;
    const activation = runtime.activate(pkg.manifest.id, "command", "run", null);
    const ticket = await waitForEffect(runtime);
    expect(ticket.operation).toBe("turns.start");
    expect(JSON.stringify(ticket.review)).toContain("no dollar cap is enforced");
    expect(await runtime.answerEffect(ticket.id, true)).toBe(true);
    const result = await activation;
    expect(result).toMatchObject({ status: "completed", output: { before: { status: "idle" }, result: { status: "completed", sceneId: chat.id }, after: { status: "idle" } } });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain("greetings");
    const messages = await chats.readMessages(chat.activeBranchId, { limit: 10 });
    expect(messages.messages.some((message) => message.role === "assistant" && message.swipes[message.current]?.content === "Hello from the fixture.")).toBe(true);
  } finally { await runtime.close(); }
});

test("Terminal turns.cancel stops only a turn owned by the invoking extension", async () => {
  let now = 2_000, serial = 0, markProviderStarted!: () => void;
  const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
  const store = memoryExtensionStore(() => now), content = createContentStore(memoryDocumentBackend());
  const chats = memoryChatStore(() => now, undefined, { authorizeExtensionCommit: (context) => store.assertCommitContext(context) });
  const character = { kind: "character", id: "fixture-character", body: { identity: { name: "Vera", description: "A detective" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Terminal cancel", cast: { character: { id: "fixture-character", version: 1 } }, snapshot: { character } });
  await chats.setConnection(chat.id, { id: "fixture-connection", model: "fixture-model" });
  await chats.appendMessages(chat.activeBranchId, [{ role: "user", content: "Wait for cancellation." }]);
  const branch = await chats.readMessages(chat.activeBranchId, { limit: 1 });
  const fakeConfig = { id: "fixture-connection", kind: "fixture", model: "fixture-model" };
  const fingerprint = providerConfigFingerprint(fakeConfig, fakeConfig.model);
  const provider: Provider = { id: "fixture-connection", async send(_request, io) {
    markProviderStarted();
    return await new Promise((_, reject) => io?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled by host.", "AbortError")), { once: true }));
  } };
  const runtime = await createTerminalExtensionRuntime({
    store, content, stateStore: memoryStateStore({ authorizeExtensionCommit: (context) => store.assertCommitContext(context) }), chats, storeId: "terminal-cancel-fixture",
    wasmBinary: await readTerminalQuickJsWasm(), now: () => now, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    isCoreScene: null,
    connectScene: async () => ({ provider, kind: "fixture", providerConfigFingerprint: fingerprint }),
    turnConnectionReader: async (_connectionId, model) => ({ fingerprint: providerConfigFingerprint(fakeConfig, model) }),
  });
  try {
    const pkg = { manifest: { schemaVersion: 1, id: "demo.terminal.cancel", version: "1.0.0", name: "Terminal cancel fixture", description: "", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [
        { operation: "turns.start", resources: ["scene", "host-connection"], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"], purpose: "start one approved turn", required: true },
        { operation: "turns.status", resources: ["scene"], fields: ["turn.status"], methods: [], destinations: [], purpose: "read own running turn status", required: true },
        { operation: "turns.cancel", resources: ["scene"], fields: ["turn.cancel"], methods: [], destinations: [], purpose: "cancel own running turn", required: true },
      ], contributions: ["run", "cancel"].map((id) => ({ type: "command" as const, id, label: id, operation: `test.${id}` })) },
      files: { "main.js": `bunzai.extension.define({commands:{run:()=>bunzai.call("turns.start",{sceneId:${JSON.stringify(chat.id)},connectionId:"fixture-connection",expectedVersion:${branch.branchVersion}}),cancel:async()=>{const status=await bunzai.call("turns.status",{sceneId:${JSON.stringify(chat.id)}});return {status,cancel:await bunzai.call("turns.cancel",{sceneId:${JSON.stringify(chat.id)},turnId:status.turnId})}}}});` } };
    const preview = await runtime.preview(pkg);
    await runtime.install(preview.challenge, [
      { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "fixture-connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"], duration: "session", budget: { requests: 10, bytes: 1_000_000, tokens: 50_000 } },
      { operation: "turns.status", resources: [{ kind: "scene", id: chat.id }], fields: ["turn.status"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 8_000, tokens: 0 } },
      { operation: "turns.cancel", resources: [{ kind: "scene", id: chat.id }], fields: ["turn.cancel"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 8_000, tokens: 0 } },
    ], [], preview.expectedRevision);
    const installed = await runtime.list(); await runtime.enable(pkg.manifest.id, installed.find((item) => item.id === pkg.manifest.id)!.revision); now += 1;
    const run = runtime.activate(pkg.manifest.id, "command", "run", null);
    const ticket = await waitForEffect(runtime); expect(ticket.operation).toBe("turns.start");
    await runtime.answerEffect(ticket.id, true);
    await providerStarted;
    const cancelled = await runtime.activate(pkg.manifest.id, "command", "cancel", null);
    expect(cancelled).toMatchObject({ status: "completed", output: { status: { status: "running", turnId: expect.any(String) }, cancel: { cancelled: true } } });
    expect(await run).toMatchObject({ status: "completed", output: { status: "stopped" } });
  } finally { await runtime.close(); }
});

async function waitForFileAction(runtime: Awaited<ReturnType<typeof createTerminalExtensionRuntime>>, action: "pick" | "read") {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ticket = (await runtime.pendingFileActions()).find((item) => item.action === action);
    if (ticket) return ticket;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no pending Terminal ${action} ticket`);
}

async function waitForEffect(runtime: Awaited<ReturnType<typeof createTerminalExtensionRuntime>>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ticket = (await runtime.pendingEffects())[0];
    if (ticket) return ticket;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("no pending Terminal macro review");
}
