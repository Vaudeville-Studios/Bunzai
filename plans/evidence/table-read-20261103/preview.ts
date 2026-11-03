/** Isolated Table Read UI proof: a real encrypted library and local scripted OpenAI-compatible wire, no user credentials. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLibrary } from "../../../src/ui/library-root";
import { startUi } from "../../../src/ui/server";
import { SettingsStore } from "../../../src/studio/settings";
import { saveProvider } from "../../../src/kit/providers/vault";
import type { DeviceVault } from "../../../src/stage/crypto/keyring";
import type { TableReadField } from "../../../src/core/table-read/fields";

const fixtureRoot = process.env.BUNZAI_HOME;
if (!fixtureRoot || !fixtureRoot.includes("codex-table-read-20261103")) throw new Error("This fixture must use its isolated Table Read profile.");
await mkdir(fixtureRoot, { recursive: true });
const keys = new Map<string, string>();
const vault: DeviceVault = {
  async seal(text) { const key = crypto.randomUUID(); keys.set(key, text); return key; },
  async open(key) { const text = keys.get(key); if (text === undefined) throw new Error("fixture key unavailable"); return text; },
  async computerId() { return "table-read-fixture"; }, async computerIdForNewCopy() { return "table-read-fixture"; },
  async computerLabel() { return "Isolated preview"; }, lockOf: () => ({ lock: "test-memory", weak: false }), async strongerThan() { return false; },
};
let failNext = false;
let delayMs = 0;
let calls = 0;
const questions = [
  { field: "personality", text: "Which debt would make Vesper quietly break her own rules?", chips: ["Her brother's, though she resents it", "A stranger who reminds her of herself", "None. The ledger comes first."] },
  { field: "scenario", text: "Who walks into the Lumen Room carrying the one debt she cannot ignore?", chips: ["A rival with her brother's signature", "Someone she already paid to disappear", "An old friend asking for a final favor"] },
  { field: "firstMessage", text: "How does she greet someone who insists they owe her nothing?", chips: ["She lets the silence name the price", "She offers a drink and opens the ledger", "She smiles as if they have already agreed"] },
  { field: "exampleMessages", text: "When they thank her for a kindness, how does her voice change?", chips: ["Don't. Thank me and I'll charge interest.", "This wasn't kindness. We're settling accounts.", "She changes the subject before they can finish."] },
] as const;
const provider = Bun.serve({
  port: 18732, hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/control" && request.method === "POST") {
      const body = await request.json() as { failNext?: boolean; delayMs?: number };
      failNext = body.failNext === true;
      delayMs = Math.min(10_000, Math.max(0, body.delayMs ?? 0));
      return Response.json({ calls, failNext, delayMs });
    }
    if (path === "/control") return Response.json({ calls, failNext, delayMs });
    if (path === "/v1/models") return Response.json({ object: "list", data: [{ id: "table-read-scripted", object: "model", owned_by: "Isolated preview", context_length: 32_000 }] });
    if (path !== "/v1/chat/completions") return new Response("not found", { status: 404 });
    calls++;
    if (failNext) { failNext = false; return Response.json({ error: { message: "Scripted preview failure", type: "server_error" } }, { status: 503 }); }
    const body = await request.json() as { messages: { role: string; content: string }[] };
    const prompt = body.messages.find((message) => message.role === "system")!.content;
    const context = JSON.parse(body.messages.find((message) => message.role === "user")!.content) as { manuallyKept: TableReadField[]; card: Record<TableReadField, string>; answers: { field: TableReadField; answer: string }[] };
    const card = { ...context.card };
    card.name ||= "Vesper";
    card.tagline ||= "Every favor has a price. Mercy is hers to pay.";
    card.description ||= "Vesper runs the Lumen Room, a midnight bar where drinks buy secrets. She keeps a ledger of favors and quietly pays debts she should be collecting.";
    for (const answer of context.answers) {
      if (context.manuallyKept.includes(answer.field)) continue;
      card[answer.field] = answer.field === "personality" ? `She treats every favor as a transaction, until ${answer.answer.toLowerCase()}. She hides those exceptions as carefully as her accounts.` : answer.field === "firstMessage" ? `Vesper closes the ledger with one finger marking the page. "Whose name are we dancing around?" A glass waits between you. "Sit. Honesty gets a chair."` : answer.answer;
    }
    const patches = Object.entries(card).filter(([field, value]) => value && !context.manuallyKept.includes(field as TableReadField)).map(([field, value]) => ({ field, value }));
    const rapid = prompt.includes("Prepare 8 to 12 short chip questions");
    const finish = prompt.includes("The creator is finishing now.");
    if (finish) {
      if (!card.personality) patches.push({ field: "personality", value: "A precise keeper of accounts, privately troubled by the kindness she cannot stop offering." });
      if (!card.scenario) patches.push({ field: "scenario", value: "The Lumen Room after midnight. A debt has come due, and Vesper is deciding who pays it." });
      if (!card.firstMessage) patches.push({ field: "firstMessage", value: "Vesper shuts the ledger. \"Tell me whose name belongs on this page.\"" });
    }
    const answered = new Set([...context.answers.map((answer) => answer.field), ...context.manuallyKept]);
    const next = finish ? null : questions.find((question) => !answered.has(question.field)) ?? null;
    const result = rapid ? { patches, questions: [...questions, { field: "personality", text: "What does she do when the numbers do not add up?", chips: ["Blames herself first", "Finds who changed the ledger", "Makes the difference disappear"] }, { field: "scenario", text: "What must the bar never become?", chips: ["A place she cannot leave", "A refuge with no price", "Another person's property"] }] } : { patches, covered: Object.keys(card).filter((field) => !!card[field as TableReadField]), question: next, note: finish ? "Review these suggestions against the answers you kept. Your manual edits stay yours." : "We already know her name and her bar. Let's find the exception that makes her playable.", followUp: null, deflection: false };
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const content = JSON.stringify(result);
    const frame = (choices: unknown) => `data: ${JSON.stringify({ id: `preview-${calls}`, object: "chat.completion.chunk", model: "table-read-scripted", choices })}\n\n`;
    return new Response(frame([{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]) + frame([{ index: 0, delta: {}, finish_reason: "stop" }]) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  },
});
const saved = await saveProvider({ kind: "local", model: "table-read-scripted", name: "Isolated Table Read preview", baseURL: `http://127.0.0.1:${provider.port}/v1`, context: 32_000 }, { passphrase: "table-read-preview-only" });
const libraryDir = join(fixtureRoot, `library-${crypto.randomUUID()}`);
const library = createLibrary(libraryDir, { vault, sessionsDir: join(fixtureRoot, "empty-sessions") });
await library.open();
await new SettingsStore(libraryDir).save({ setupComplete: true, prefs: { "ui.stageLights": "off" } });
const app = startUi(18731, libraryDir, undefined, library);
const ready = { pid: process.pid, url: `${app.url}/#table-read`, providerUrl: `http://127.0.0.1:${provider.port}`, providerId: saved.id, libraryDir, fixtureRoot };
await writeFile(join(process.env.TEMP!, "table-read-ready.json"), JSON.stringify(ready, null, 2));
console.log(JSON.stringify({ ready: true, pid: process.pid, url: ready.url, providerUrl: ready.providerUrl }));
let stopping = false;
async function close() { if (stopping) return; stopping = true; await app.close(); provider.stop(true); await library.close(); process.exit(0); }
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
