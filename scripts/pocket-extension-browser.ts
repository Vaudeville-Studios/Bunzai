/** Real-browser regression for the generated static Pages artifact and opaque QuickJS host. */
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { resolvePagesPreviewPath } from "./pages-preview-path";
import { fileURLToPath } from "node:url";

interface ProbeWindow extends Window {
  __pocketActivation?: Promise<{ status: number; body: unknown }>;
  __pocketSceneCreation?: Promise<{ status: number; body: unknown }>;
}

const pagesRoot = resolve("dist/pages");
const regexProbeBuild = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./pocket-regex-browser-page.ts", import.meta.url))],
  target: "browser", format: "iife", minify: true, define: { "import.meta.url": '"https://bunzai.invalid/probe.js"' },
});
if (!regexProbeBuild.success || regexProbeBuild.outputs.length !== 1) throw new Error("static Pages regex probe bundle failed");
const regexProbeSource = await regexProbeBuild.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = resolvePagesPreviewPath(pagesRoot, new URL(request.url).pathname);
  if (!path) return new Response("not found", { status: 404 });
  const file = Bun.file(path);
  return await file.exists() ? new Response(file) : new Response("not found", { status: 404 });
} });
const executablePath = process.env["CHROME_PATH"] ?? chromium.executablePath();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.port}`;
  const fontResponse = await fetch(`${origin}/Bunzai/studio/fonts/cinzel-latin-normal.woff2`);
  if (!fontResponse.ok || (await fontResponse.arrayBuffer()).byteLength === 0) throw new Error("Static Pages artifact is missing its referenced Cinzel font asset");
  const outsideRequests: string[] = [];
  let blobWorkerRequests = 0;
  page.on("console", (message) => console.error(`Browser console: ${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => console.error(`Browser page error: ${error.message}`));
  page.on("requestfailed", (request) => console.error(`Browser request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/extensions/scene-opened") || response.url().includes("/api/chats/open")) void response.clone().text().then((body) => console.log(`Pocket scene route ${response.status()} ${response.url()}: ${body.slice(0, 220)}`));
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:") blobWorkerRequests++;
    else if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) outsideRequests.push(request.url());
  });
  const studioUrl = `${origin}/Bunzai/studio/#settings/extensions`;
  await page.goto(studioUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(async () => {
    try { return (await fetch("/api/extensions/revision")).ok; } catch { return false; }
  }, undefined, { timeout: 20_000 });
  await page.locator(".vsetup").waitFor({ timeout: 20_000 });
  await page.getByText(/Skip all.*change everything later/).click();
  await page.locator(".final-on").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Open Bunzai", exact: true }).click();
  await page.locator('[data-app-id="settings"]').waitFor({ timeout: 20_000 });
  const bootedUi = await page.evaluate(() => ({ url: location.href, tiles: [...document.querySelectorAll<HTMLElement>("[data-app-id]")].map((node) => ({ id: node.dataset.appId, text: node.innerText })), body: document.body.innerText.slice(0, 800) }));
  if (!bootedUi.tiles.some((tile) => tile.id === "settings")) throw new Error(`Settings dock tile is absent after first-run setup: ${JSON.stringify(bootedUi)}`);
  const browserBundleSizes = await page.evaluate(() => {
    const data = (globalThis as typeof globalThis & { __BUNZAI_POCKET_DATA__?: { browserSandbox?: { workerSource?: string; wasmBase64?: string } } }).__BUNZAI_POCKET_DATA__;
    return { workerSource: data?.browserSandbox?.workerSource?.length ?? 0, wasmBase64: data?.browserSandbox?.wasmBase64?.length ?? 0 };
  });
  const sessionMode = await page.locator('meta[name="vaude-session"]').getAttribute("content");
  if (sessionMode !== "browser-tab") throw new Error(`Browser API unexpectedly has a local session credential: ${String(sessionMode)}`);
  const promptCharacterVersion = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as unknown;
      if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(value)}`);
      return value as Record<string, unknown>;
    };
    await post("/api/studio/save-bundle", { entity: { schemaVersion: "1", kind: "character", id: "pocket-prompt-proof", body: {
      identity: { name: "Pocket prompt proof", description: "Stored canonical context marker." }, persona: {},
      prompts: { systemPrompt: "Canonical stored prompt marker." }, greetings: { firstMessage: "A stored greeting marker." },
      examples: {}, attribution: {}, discovery: {}, media: {},
    } } });
    const current = await fetch("/api/studio/summary?kind=character&id=pocket-prompt-proof");
    const stored = await current.json() as { version?: unknown };
    if (!current.ok || typeof stored.version !== "number") throw new Error(`canonical character version unavailable: ${JSON.stringify(stored)}`);
    return stored.version;
  });
  const sceneCreator = {
    manifest: { schemaVersion: 1, id: "bunzai.extension.pocket-scene-creator", version: "1.0.0", name: "Pocket scene fixture", description: "Creates one isolated preview scene", author: "Fixture", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "scenes.create", resources: ["character"], fields: ["scene.create"], methods: [], destinations: [], purpose: "Create an isolated scene for the prompt preview fixture", required: true }],
      contributions: [{ type: "command", id: "create", label: "Create fixture scene", operation: "scenes.create" }] },
    files: { "main.js": `bunzai.extension.define({commands:{create:async()=>bunzai.call('scenes.create',{characterId:'pocket-prompt-proof',characterVersion:${promptCharacterVersion},title:'Pocket prompt preview fixture'})}})` },
  };
  const creatorId = await page.evaluate(async ({ pkg, characterVersion }) => {
    const request = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as unknown;
      if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(value)}`);
      return value as Record<string, unknown>;
    };
    const review = await request("/api/extensions/preview", { input: pkg }) as unknown as { challenge: string; expectedRevision: number; unsupported: string[] };
    if (review.unsupported.length) throw new Error(`Browser scene creation operation is unavailable: ${JSON.stringify(review.unsupported)}`);
    const grants = [{ operation: "scenes.create", resources: [{ kind: "character", id: "pocket-prompt-proof" }], fields: ["scene.create"], methods: [], destinations: [], duration: "persistent", budget: { requests: 30, bytes: 5_000_000, tokens: 0 } }];
    const control = await request("/api/extensions/install", { challenge: review.challenge, grants, themeScopes: [], expectedRevision: review.expectedRevision }) as unknown as { id: string; revision: number };
    await request("/api/extensions/enable", { id: control.id, expectedRevision: control.revision });
    (window as ProbeWindow).__pocketSceneCreation = fetch("/api/extensions/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: control.id, kind: "command", contributionId: "create", input: {} }) })
      .then(async (response) => ({ status: response.status, body: await response.json() as unknown }));
    return control.id;
  }, { pkg: sceneCreator, characterVersion: promptCharacterVersion });
  let sceneEffects: { id: string; operation: string }[] = [];
  for (let attempt = 0; attempt < 150 && sceneEffects.length === 0; attempt++) {
    sceneEffects = await page.evaluate(async () => await (await fetch("/api/extensions/pending-effects")).json() as { id: string; operation: string }[]);
    sceneEffects = sceneEffects.filter((ticket) => ticket.operation === "scenes.create");
    if (sceneEffects.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const sceneEffect = sceneEffects[0];
  if (!sceneEffect) {
    const sceneDebug = await page.evaluate(async () => await Promise.race([
      (window as ProbeWindow).__pocketSceneCreation!, new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 50)),
    ]));
    throw new Error(`Browser scene fixture did not request the expected host confirmation: ${JSON.stringify({ sceneDebug, sceneEffects })}`);
  }
  await page.evaluate(async (id) => {
    const response = await fetch("/api/extensions/answer-effect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approved: true }) });
    if (!response.ok) throw new Error(`fixture scene confirmation failed: ${response.status}`);
  }, sceneEffect.id);
  const sceneCreation = await page.evaluate(async () => await (window as ProbeWindow).__pocketSceneCreation!);
  const sceneOutput = sceneCreation.body !== null && typeof sceneCreation.body === "object" && "output" in sceneCreation.body ? (sceneCreation.body as { output?: { id?: unknown } }).output : undefined;
  if (sceneCreation.status !== 200 || typeof sceneOutput?.id !== "string") throw new Error(`Browser canonical scene creation failed: ${JSON.stringify(sceneCreation)}`);
  const promptSceneId = sceneOutput.id;
  const openedScene = await page.evaluate(async (id) => {
    const response = await fetch(`/api/chats/open?id=${encodeURIComponent(id)}`);
    const body = await response.json() as { chat?: { id?: string }; messages?: unknown[] };
    if (!response.ok || body.chat?.id !== id || !Array.isArray(body.messages)) throw new Error(`Pocket canonical scene open failed ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }, promptSceneId);
  await page.addScriptTag({ content: regexProbeSource });
  const regexProbe = await page.evaluate(async () => {
    let sawOpaqueFrame = false;
    let sourceAndOriginVerified = false, parentReadBlocked = false;
    let regexFrame: HTMLIFrameElement | null = null;
    const observer = new MutationObserver(() => {
      regexFrame = document.querySelector<HTMLIFrameElement>('iframe[title="Regex preview worker"]');
      if (regexFrame) {
        sawOpaqueFrame = regexFrame.getAttribute("sandbox") === "allow-scripts";
        try { void regexFrame.contentWindow?.document; } catch { parentReadBlocked = true; }
      }
    });
    const handshake = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === "ready") sourceAndOriginVerified = event.origin === "null" && event.source === regexFrame?.contentWindow;
    };
    window.addEventListener("message", handshake);
    observer.observe(document.body, { childList: true });
    try { const result = await window.runPocketRegexProbe(); return { result, sawOpaqueFrame, sourceAndOriginVerified, parentReadBlocked }; }
    finally { observer.disconnect(); window.removeEventListener("message", handshake); }
  });
  if (!regexProbe.sawOpaqueFrame || !regexProbe.sourceAndOriginVerified || !regexProbe.parentReadBlocked || regexProbe.result.ok !== true || regexProbe.result.result.text !== "opaque-frame-regex"
    || await page.locator('iframe[title="Regex preview worker"]').count() !== 0) {
    throw new Error(`Production Browser regex adapter failed: ${JSON.stringify(regexProbe)}`);
  }
  const packageInput = {
    manifest: {
      schemaVersion: 1, id: "bunzai.extension.pocket-proof", version: "1.0.0", name: "Pocket boundary proof",
      description: "Browser fixture", author: "Fixture", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [
        { operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], purpose: "Check Browser host metadata", required: true },
        { operation: "content.list", resources: ["character"], fields: ["id", "kind", "name"], methods: [], destinations: [], purpose: "List only the focused fixture character", required: true },
        { operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], purpose: "Wait for explicit host approval", required: true },
        { operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], purpose: "Review a bounded deterministic macro sample", required: true },
      ],
      contributions: [
        { type: "command", id: "inspect", label: "Run browser proof", operation: "api.describe" },
        { type: "command", id: "macro", label: "Preview macros", operation: "macros.preview" },
      ],
    },
    files: { "main.js": "bunzai.extension.define({commands:{inspect:async input=>{let page=await bunzai.call('api.describe',{offset:0,limit:20}),operationIds=[];do{operationIds.push(...page.operations.map(item=>item.id));if(page.nextOffset===null)break;page=await bunzai.call('api.describe',{offset:page.nextOffset,limit:20})}while(true);const selected=await bunzai.call('content.list',{scope:{type:'invocation'},fields:['id','kind','name']});await bunzai.call('storage.set',{key:'browser-proof-'+(input.run||'first'),value:'committed',expectedRevision:-1});return {operationIds,selected,invocationResources:bunzai.context.invocation.resources,invocationContextFrozen:Object.isFrozen(bunzai.context.invocation.resources),fetch:typeof fetch,document:typeof document,window:typeof window,parent:typeof parent,localStorage:typeof localStorage,process:typeof process}},macro:async()=>{try{return await bunzai.call('macros.preview',{sample:'Hello {{char}}!',environment:{characterName:'Nova',randomSeed:7}})}catch{return {denied:true}}}}})" },
  };
  const installed = await page.evaluate(async (pkg) => {
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(value)}`);
      return value as unknown;
    };
    const review = await request("/api/extensions/preview", { input: pkg }) as { unsupported: string[]; challenge: string; expectedRevision: number };
    if (review.unsupported.length) throw new Error(`Browser catalog advertised unsupported operations: ${review.unsupported.join(",")}`);
    const grants = [
      { operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "persistent", budget: { requests: 100, bytes: 25_600_000, tokens: 0 } },
      { operation: "content.list", resources: [{ kind: "character", id: "pocket-prompt-proof" }], fields: ["id", "kind", "name"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 1_000_000, tokens: 0 } },
      { operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 10_000, tokens: 0 } },
      { operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], duration: "persistent", budget: { requests: 3, bytes: 600_000, tokens: 0 } },
    ];
    const control = await request("/api/extensions/install", { challenge: review.challenge, grants, themeScopes: [], expectedRevision: review.expectedRevision }) as { id: string; revision: number };
    await request("/api/extensions/enable", { id: control.id, expectedRevision: control.revision });
    localStorage.setItem("pocket-proof-parent-sentinel", "parent-only");
    (window as ProbeWindow).__pocketActivation = fetch("/api/extensions/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: control.id, kind: "command", contributionId: "inspect", input: { run: "initial" }, hostContext: { resources: [{ kind: "character", id: "pocket-prompt-proof" }] } }) })
      .then(async (response) => ({ status: response.status, body: await response.json() as unknown }));
    return control.id as string;
  }, packageInput);
  let effects: { id: string }[] = [];
  for (let attempt = 0; attempt < 150 && effects.length === 0; attempt++) {
    effects = await page.evaluate(async () => await (await fetch("/api/extensions/pending-effects")).json() as { id: string }[]);
    if (effects.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const effectId = effects[0]?.id;
  if (!effectId) {
    const activationState = await page.evaluate(() => (window as ProbeWindow).__pocketActivation);
    throw new Error(`Browser effect ticket did not appear: ${JSON.stringify({ effects, activationState, browserBundleSizes })}`);
  }
  const parentFrame = await page.locator('iframe[title="Extension worker host"]').evaluate((frame) => {
    const iframe = frame as HTMLIFrameElement;
    let canReadDocument = false;
    try { canReadDocument = !!iframe.contentWindow?.document; } catch { /* opaque origin blocks parent access */ }
    return { sandbox: iframe.getAttribute("sandbox"), canReadDocument };
  });
  if (parentFrame.sandbox !== "allow-scripts" || parentFrame.canReadDocument) throw new Error(`opaque frame boundary failed: ${JSON.stringify(parentFrame)}`);
  const opaqueFrame = page.frames().find((frame) => frame.parentFrame() !== null);
  if (!opaqueFrame) throw new Error(`opaque bootstrap frame was not present during host confirmation: ${JSON.stringify({ urls: page.frames().map((frame) => frame.url()), parentFrame })}`);
  const isolation = await opaqueFrame.evaluate(() => {
    const blocked = (read: () => unknown): boolean => { try { read(); return false; } catch (error) { return error instanceof DOMException && error.name === "SecurityError"; } };
    return {
      origin: location.origin,
      storageBlocked: blocked(() => localStorage.length),
      parentDocumentBlocked: blocked(() => (parent as Window).document.title),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "",
    };
  });
  if (isolation.origin !== "null" || !isolation.storageBlocked || !isolation.parentDocumentBlocked || !isolation.csp.includes("connect-src 'none'")) throw new Error(`opaque bootstrap isolation failed: ${JSON.stringify(isolation)}`);
  await page.evaluate(async (id) => {
    const response = await fetch("/api/extensions/answer-effect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approved: true }) });
    if (!response.ok) throw new Error(`host confirmation failed ${response.status} for ${JSON.stringify({ id, body: { id, approved: true } })}: ${await response.text()}`);
  }, effectId);
  const activation = await page.evaluate(async () => await (window as ProbeWindow).__pocketActivation!);
  const output = activation.body !== null && typeof activation.body === "object" && "output" in activation.body
    ? (activation.body as { output?: Record<string, unknown> }).output : undefined;
  if (activation.status !== 200 || output?.fetch !== "undefined" || output?.document !== "undefined"
    || output?.window !== "undefined" || output?.parent !== "undefined" || output?.localStorage !== "undefined" || output?.process !== "undefined"
    || output.invocationContextFrozen !== true || JSON.stringify(output.invocationResources) !== JSON.stringify([{ kind: "character", id: "pocket-prompt-proof" }])
    || JSON.stringify(output.selected) !== JSON.stringify([{ id: "pocket-prompt-proof", kind: "character", name: "Pocket prompt proof" }])) {
    throw new Error(`QuickJS Browser activation failed: ${JSON.stringify(activation)}`);
  }
  const ids = output.operationIds as string[];
  if (!ids.includes("content.read") || !ids.includes("macros.preview") || ids.includes("network.request") || ids.some((id) => id.startsWith("files."))) throw new Error(`Browser operation inventory is wrong: ${JSON.stringify(ids)}`);
  const startMacro = () => page.evaluate((id) => {
    (window as ProbeWindow).__pocketActivation = fetch("/api/extensions/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind: "command", contributionId: "macro", input: {} }) })
      .then(async (response) => ({ status: response.status, body: await response.json() as unknown }));
  }, installed);
  const macroTicket = async () => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const ticket = await page.evaluate(async () => (await fetch("/api/extensions/pending-effects")).json() as { id: string; operation: string; review: unknown }[])
        .then((tickets) => tickets.find((item) => item.operation === "macros.preview") ?? null);
      if (ticket) return ticket;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Browser macro preview did not request host review");
  };
  await startMacro();
  const deniedMacroTicket = await macroTicket();
  if (JSON.stringify(deniedMacroTicket.review).indexOf("Hello {{char}}!") < 0) throw new Error(`macro review omitted its exact sample: ${JSON.stringify(deniedMacroTicket.review)}`);
  await page.evaluate(async (id) => {
    const response = await fetch("/api/extensions/answer-effect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approved: false }) });
    if (!response.ok) throw new Error(`macro denial failed: ${response.status}`);
  }, deniedMacroTicket.id);
  const deniedMacro = await page.evaluate(async () => await (window as ProbeWindow).__pocketActivation!);
  const deniedOutput = deniedMacro.body !== null && typeof deniedMacro.body === "object" && "output" in deniedMacro.body ? (deniedMacro.body as { output?: unknown }).output : null;
  if (deniedMacro.status !== 200 || JSON.stringify(deniedOutput) !== JSON.stringify({ denied: true })) throw new Error(`denied macro preview produced an unexpected result: ${JSON.stringify(deniedMacro)}`);
  await startMacro();
  const approvedMacroTicket = await macroTicket();
  await page.evaluate(async (id) => {
    const response = await fetch("/api/extensions/answer-effect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approved: true }) });
    if (!response.ok) throw new Error(`macro approval failed: ${response.status}`);
  }, approvedMacroTicket.id);
  const approvedMacro = await page.evaluate(async () => await (window as ProbeWindow).__pocketActivation!);
  const macroOutput = approvedMacro.body !== null && typeof approvedMacro.body === "object" && "output" in approvedMacro.body ? (approvedMacro.body as { output?: { text?: unknown; diagnostics?: unknown } }).output : undefined;
  if (approvedMacro.status !== 200 || macroOutput?.text !== "Hello Nova!") throw new Error(`approved Browser macro preview failed: ${JSON.stringify(approvedMacro)}`);
  const promptPackage = {
    manifest: {
      schemaVersion: 1, id: "bunzai.extension.pocket-prompt-proof", version: "1.0.0", name: "Pocket prompt proof",
      description: "Fixture for stored-scene prompt assembly", author: "Fixture", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "prompts.contribute", resources: ["scene"], fields: ["system.append"], methods: [], destinations: [], purpose: "Append a deterministic fixture candidate to the active prompt", required: true }],
      contributions: [{ type: "prompt", id: "append", label: "Fixture prompt addition", stage: "system.append" }],
    },
    files: { "main.js": "bunzai.extension.define({events:{append:async(input)=>{await bunzai.call('prompts.contribute',{sceneId:input.sceneId,stage:input.stage,text:'Pocket QuickJS prompt candidate.'})}}})" },
  };
  const promptInstall = await page.evaluate(async ({ pkg, sceneId }) => {
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      const value = await response.json() as unknown;
      if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(value)}`);
      return value as Record<string, unknown>;
    };
    const scenes = await request("/api/extensions/prompt-scenes") as unknown as { id: string; title: string }[];
    if (!scenes.some((scene) => scene.id === sceneId)) throw new Error(`canonical scene is absent from prompt scene projection: ${JSON.stringify(scenes)}`);
    const review = await request("/api/extensions/preview", { input: pkg }) as unknown as { challenge: string; expectedRevision: number; unsupported: string[] };
    if (review.unsupported.length) throw new Error(`Browser prompt operation was not exposed: ${JSON.stringify(review.unsupported)}`);
    const grants = [{ operation: "prompts.contribute", resources: [{ kind: "scene", id: sceneId }], fields: ["system.append"], methods: [], destinations: [], duration: "persistent", budget: { requests: 100, bytes: 25_600_000, tokens: 0 } }];
    const control = await request("/api/extensions/install", { challenge: review.challenge, grants, themeScopes: [], expectedRevision: review.expectedRevision }) as unknown as { id: string; revision: number };
    const enabled = await request("/api/extensions/enable", { id: control.id, expectedRevision: control.revision }) as unknown as { revision: number };
    return { id: control.id, revision: enabled.revision };
  }, { pkg: promptPackage, sceneId: promptSceneId });
  const promptResult = await page.evaluate(async ({ sceneId, draft }) => {
    const response = await fetch("/api/extensions/prompt-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneId, draft }) });
    const body = await response.json() as { sceneId?: string; label?: string; messages?: { role: string; content: string }[] };
    if (!response.ok) throw new Error(`prompt preview failed ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }, { sceneId: promptSceneId, draft: "Pocket prompt draft marker." });
  const promptText = JSON.stringify(promptResult.messages);
  if (promptResult.sceneId !== promptSceneId || promptResult.label !== "Local prompt preview; no model called; unshaped and unbudgeted."
    || !promptText.includes("Pocket QuickJS prompt candidate.") || !promptText.includes("Pocket prompt draft marker.") || !promptText.includes("Stored canonical context marker.")) {
    throw new Error(`Browser prompt preview omitted canonical context, draft, or QuickJS hook output: ${JSON.stringify(promptResult)}`);
  }
  await page.evaluate(async ({ id, revision }) => {
    const response = await fetch("/api/extensions/disable", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, expectedRevision: revision }) });
    if (!response.ok) throw new Error(`prompt package disable failed ${response.status}: ${await response.text()}`);
  }, promptInstall);
  const afterDisable = await page.evaluate(async ({ sceneId, draft }) => {
    const response = await fetch("/api/extensions/prompt-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sceneId, draft }) });
    const body = await response.json() as { messages?: { role: string; content: string }[] };
    if (!response.ok) throw new Error(`prompt preview after disable failed ${response.status}: ${JSON.stringify(body)}`);
    return JSON.stringify(body.messages);
  }, { sceneId: promptSceneId, draft: "Pocket prompt draft marker." });
  if (afterDisable.includes("Pocket QuickJS prompt candidate.")) throw new Error("revoked Browser prompt hook remained in the assembled preview");
  await page.locator('[data-app-id="scenes"]').click();
  const sceneCard = page.locator('[data-part="scenes.hero.open"]').filter({ hasText: "Pocket prompt preview fixture" });
  await sceneCard.waitFor({ timeout: 20_000 });
  await sceneCard.click();
  const chooseFullChat = page.getByRole("button", { name: "Use Full Chat", exact: true });
  if (await chooseFullChat.count()) await chooseFullChat.click();
  await page.locator('textarea[aria-label="Message"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-app-id="settings"]').click();
  await page.getByRole("tab", { name: /Extensions/ }).click();
  const composerPackage = {
    manifest: { schemaVersion: 1, id: "bunzai.extension.pocket-composer-proof", version: "1.0.0", name: "Pocket composer proof", description: "Replace only a mounted scene draft after a host gesture", author: "Fixture",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
      requirements: [{ operation: "composer.draft.set", resources: ["scene"], fields: ["scene.draft"], methods: [], destinations: [], purpose: "Offer one exact unsent draft replacement for a stored scene", required: true }],
      contributions: [{ type: "command", id: "replace", label: "Offer reviewed draft", operation: "composer.draft.set" }] },
    files: { "main.js": `bunzai.extension.define({commands:{replace:()=>bunzai.call('composer.draft.set',{sceneId:${JSON.stringify(promptSceneId)},text:'Pocket Browser mounted composer replacement.'})}})` },
  };
  const composerInstall = await page.evaluate(async ({ pkg, sceneId }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(value)}`);
      return value;
    };
    const review = await post("/api/extensions/preview", { input: pkg }) as { challenge: string; expectedRevision: number; unsupported: string[] };
    if (review.unsupported.length) throw new Error(`Browser composer operation unavailable: ${JSON.stringify(review.unsupported)}`);
    const grants = [{ operation: "composer.draft.set", resources: [{ kind: "scene", id: sceneId }], fields: ["scene.draft"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 100_000, tokens: 0 } }];
    const control = await post("/api/extensions/install", { challenge: review.challenge, grants, themeScopes: [], expectedRevision: review.expectedRevision }) as { id: string; revision: number };
    const enabled = await post("/api/extensions/enable", { id: control.id, expectedRevision: control.revision }) as { revision: number };
    return { id: control.id, revision: enabled.revision };
  }, { pkg: composerPackage, sceneId: promptSceneId });
  await page.evaluate((id) => {
    (window as ProbeWindow).__pocketActivation = fetch("/api/extensions/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind: "command", contributionId: "replace", input: {} }) })
      .then(async (response) => ({ status: response.status, body: await response.json() as unknown }));
  }, composerInstall.id);
  let composerTicket: { id: string; action: string; sceneId?: string; text?: string } | undefined;
  for (let attempt = 0; attempt < 150 && !composerTicket; attempt++) {
    const snapshot = await page.evaluate(async () => await (await fetch("/api/extensions/host-actions")).json() as { actions?: { id: string; action: string; sceneId?: string; text?: string }[] });
    composerTicket = snapshot.actions?.find((item) => item.action === "composer.draft.set");
    if (!composerTicket) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!composerTicket || composerTicket.sceneId !== promptSceneId || composerTicket.text !== "Pocket Browser mounted composer replacement.") throw new Error(`Browser QuickJS composer ticket did not match the stored scene: ${JSON.stringify(composerTicket)}`);
  const settingsTile = page.locator('[data-app-id="settings"]');
  if (await settingsTile.count() === 0) throw new Error(`Settings dock tile is absent: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, tiles: [...document.querySelectorAll<HTMLElement>("[data-app-id]")].map((node) => ({ id: node.dataset.appId, text: node.innerText })), body: document.body.innerText.slice(0, 1200) })))}`);
  await settingsTile.click();
  await page.getByRole("tab", { name: /Extensions/ }).click();
  await page.getByRole("button", { name: "Apply to composer", exact: true }).waitFor({ timeout: 20_000 });
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      const response = await original(...args);
      if (url.includes("/api/chats/open") || url.includes("/api/extensions/scene-opened")) console.info(`fixture route ${response.status} ${url}`);
      return response;
    };
  });
  await page.getByRole("button", { name: "Apply to composer", exact: true }).click();
  try {
    await page.waitForFunction((text) => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.value === text, "Pocket Browser mounted composer replacement.", { timeout: 30_000 });
  } catch {
    const state = await page.evaluate(async () => ({ url: location.href, body: document.body.innerText.slice(0, 1800),
      apps: [...document.querySelectorAll<HTMLElement>("[data-app-id]")].map((node) => ({ id: node.dataset.appId, active: node.getAttribute("aria-current") })),
      textareas: [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].map((node) => ({ label: node.getAttribute("aria-label"), value: node.value, placeholder: node.placeholder })),
      hostActions: await (await fetch("/api/extensions/host-actions")).json(),
      handoff: { scene: sessionStorage.getItem("bunzai.scenes.open"), ticket: sessionStorage.getItem("bunzai.scenes.navigation-ticket"), load: sessionStorage.getItem("bunzai.scenes.load-id") },
      activation: await Promise.race([(window as ProbeWindow).__pocketActivation!, new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 1_000))]) }));
    throw new Error(`Mounted Browser composer did not apply the draft: ${JSON.stringify(state)}`);
  }
  const composerResult = await page.evaluate(async (id) => {
    const response = await fetch(`/api/chats/open?id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`scene reload after draft apply failed ${response.status}`);
    const scene = await response.json() as { messages?: unknown[] };
    return { messages: scene.messages?.length ?? -1 };
  }, promptSceneId);
  const composerActivation = await page.evaluate(async () => await (window as ProbeWindow).__pocketActivation!);
  if (composerResult.messages !== openedScene.messages?.length || composerActivation.status !== 200
    || JSON.stringify(composerActivation.body).indexOf('"status":"applied"') < 0) {
    throw new Error(`Browser mounted composer handoff failed or sent text: ${JSON.stringify({ composerResult, composerActivation })}`);
  }
  await page.evaluate((id) => {
    (window as ProbeWindow).__pocketActivation = fetch("/api/extensions/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind: "command", contributionId: "inspect", input: { run: "closing" }, hostContext: { resources: [{ kind: "character", id: "pocket-prompt-proof" }] } }) })
      .then(async (response) => ({ status: response.status, body: await response.json() as unknown }));
  }, installed);
  let closingEffects: { id: string }[] = [];
  for (let attempt = 0; attempt < 150 && closingEffects.length === 0; attempt++) {
    closingEffects = await page.evaluate(async () => await (await fetch("/api/extensions/pending-effects")).json() as { id: string }[]);
    if (closingEffects.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (closingEffects.length === 0 || await page.locator('iframe[title="Extension worker host"]').count() !== 1) throw new Error("Browser pending run did not create its opaque worker frame");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(async (id) => {
    try {
      const response = await fetch("/api/extensions/list");
      if (!response.ok) return false;
      const rows = await response.json() as { id: string }[];
      return !rows.some((row) => row.id === id);
    } catch { return false; }
  }, installed, { timeout: 20_000 });
  if (await page.locator('iframe[title="Extension worker host"]').count() !== 0) throw new Error("pagehide did not dispose the opaque worker frame");
  if (outsideRequests.length) throw new Error(`Browser worker made off-origin requests: ${JSON.stringify(outsideRequests)}`);
  console.log(`Static Pages Browser host passed in Chrome ${browser.version()}: ${JSON.stringify({ packageId: installed, frame: parentFrame, isolation, guest: output, regexProbe, apiMode: sessionMode, blobWorkers: blobWorkerRequests, networkRequests: outsideRequests.length, cancelledOnReload: true, volatileAfterReload: true })}`);
} finally {
  await browser?.close();
  server.stop(true);
}
