/**
 * Bunzai's own story systems on a Core scene: the Director, trackers, summaries, the Dramaturg, tools, attachments and the
 * connection's message format, each proven over HTTP by what reaches the model and what the scene keeps.
 */
import { expect, setDefaultTimeout, test } from "bun:test";
import { bookRecipe, newBookPhase } from "../core/promptbook";
import { emptyAgentBody } from "../entities/agent/schema";
import { emptyPresetBody } from "../entities/preset/schema";
import { readVault, saveProvider } from "../kit/providers/vault";
import { libraryFor } from "../studio/library-content";
import { asked, coreScene, journal, model, sendAndAnswer, UNLOCK, installCoreModel, type Opened, type Rig } from "./fake-core-wiring-rig";
import { chatRouteRig as rig, vera } from "./fake-server-chats-rig";

setDefaultTimeout(30_000);
installCoreModel();

const narrated = () => asked.filter((request) => !request.messages[0]?.content.startsWith("You are")).at(-1)!;

test("on a Core scene, the Story Director plans before the reply: its constraints reach the model, and its story is saved on the version the reply landed as", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  expect((await r.post("/api/chats/props", { chatId, props: { on: ["story-director"] } })).status).toBe(200);
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(asked.some((request) => request.messages[0]?.content.startsWith("You are the Story Director"))).toBe(true);
  const sent = narrated().messages;
  const at = sent.findLastIndex((message) => message.content.includes("[DIRECTOR CONSTRAINTS"));
  expect(sent.findIndex((message) => message.content.includes("Story Director Authority"))).toBeLessThan(at);
  if (at < 0) throw new Error(JSON.stringify(sent).slice(0, 1500));
  expect(sent[at]!.content).toContain("Let Vera slip once.");
  expect(sent.map((message) => message.content).join()).toContain("Story Director Authority");
  // A model that takes no system message mid-chat reads the constraints folded into the message they sit above.
  expect((sent.slice(at).find((message) => message.role === "user") ?? sent[at]!).content).toContain("Will it rain?");
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  expect((await chats.getDirector(chatId, tip.id))?.state.arcs.map((arc) => arc.title)).toEqual(["The Lamp"]);
});

test("on a Core scene with the Director off, nothing plans and no contract is sent", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const was = asked.length;
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(asked.length).toBe(was + 1);
  expect(JSON.stringify(asked.at(-1))).not.toContain("Story Director");
});

test("on a Core scene, a tracker that is on reaches the model in the block an old scene sends, in front of the conversation, and a macro in it is not read again", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  expect((await r.post("/api/chats/props", { chatId, props: { on: ["tracker-inventory"] } })).status).toBe(200);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const first = await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(JSON.stringify(first.messages)).not.toContain("Current Game State");
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  const wrote = await r.post("/api/chats/tracker-state", { chatId, branchId: take, messageId: tip.id, expectedVersion: (await open()).branchVersion, writes: [{ module: "inventory", data: { items: [{ id: "i1", name: "A {{char}} key", description: "", category: "key", rarity: "common", quantity: 1, obtainedAt: 1 }], equipment: {}, currency: 0 } }] });
  if (wrote.status !== 200) throw new Error(`${wrote.status}: ${await wrote.text()}`);
  const sent = (await sendAndAnswer(r, chatId, (await open()).branchVersion, "And now?")).messages;
  const at = sent.findIndex((message) => message.content.includes("Current Game State"));
  if (at < 0) throw new Error(JSON.stringify(sent).slice(0, 1500));
  expect(sent[at]!.content).toContain("A {{char}} key");
  expect(at).toBeLessThan(sent.findIndex((message) => message.content.includes("Will it rain?")));
});

test("on a Core scene, the saved summary fills the summary slot and stands in for the messages it covers, which stay on the page and in the journal", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "First question.");
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "Second question.");
  const saved = await r.post("/api/chats/summary", { chatId, text: "SUMMARY {{char}}: they asked twice." });
  if (saved.status !== 200) throw new Error(`${saved.status}: ${await saved.text()}`);
  const settings = await r.post("/api/chats/summary-settings", { chatId, patch: { include: true, hideOld: true, keepRecent: 1 } });
  if (settings.status !== 200) throw new Error(`${settings.status}: ${await settings.text()}`);
  const seq = await journal(r, chatId);
  const sent = JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "Third question.")).messages);
  expect(sent).toContain("SUMMARY {{char}}: they asked twice.");
  expect(sent).not.toContain("First question.");
  expect(sent).toContain("Third question.");
  expect(await journal(r, chatId)).toBeGreaterThan(seq);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  expect(JSON.stringify((await chats.readMessages(take, { fromSeq: 1, limit: 200 })).messages)).toContain("First question.");
});

test("on a Core scene with Tool Access on, the model calls a library tool and reads its answer before it replies", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "tool", id: "weather", body: { name: "check_weather", description: "Says the weather.", fields: [], action: { kind: "record" } } } as never);
  const set = await r.post("/api/chats/prompting", { chatId, prompting: { toolAccess: true, tools: ["weather"], toolRounds: 2 } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  model.toolCallNext = { name: "check_weather", args: "{}" };
  model.reply = "Rain, then.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  const withTools = asked.filter((request) => (request as { tools?: unknown[] }).tools?.length);
  if (withTools.length === 0) throw new Error(JSON.stringify(asked.at(-1)).slice(0, 800));
  expect(JSON.stringify(asked.at(-1)!.messages)).toContain("check_weather");
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  expect((await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!.swipes.at(-1)!.content).toBe("Rain, then.");
});

test("on a Core scene, a tool's tracker write lands with the version it was made on: another version of the reply does not carry it", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "tracker", id: "gold", body: { name: "Gold", description: "", layout: "record", note: "", fields: [{ name: "coins", description: "", type: "number", default: 0 }] } } as never);
  const set = await r.post("/api/chats/prompting", { chatId, prompting: { toolAccess: true, trackers: ["gold"] } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  model.toolCallNext = { name: "update_trackers", args: JSON.stringify({ updates: [{ tracker: "Gold", set: { coins: 7 } }] }) };
  model.reply = "You find seven coins.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const state = () => chats.sceneState(take).then((s) => JSON.stringify(s));
  expect(await state()).toContain("coins");
  model.reply = "No coins this time.";
  const swiped = await r.post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: (await open()).branchVersion });
  if (swiped.status !== 200) throw new Error(`${swiped.status}: ${await swiped.text()}`);
  await swiped.text();
  expect(await state()).not.toContain("coins");
});

test("on a Core scene, the Dramaturg answers from the scene and leaves the journal and the take's version alone", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect((await r.post("/api/chats/props", { chatId, props: { on: ["dramaturg"] } })).status).toBe(200);
  const before = { version: (await open()).branchVersion, journal: await journal(r, chatId) };
  model.reply = "The rain is a stated fact.";
  const turn = await r.post("/api/chats/dramaturg-turn", { chatId, question: "Why did it rain?", revision: 0 });
  if (turn.status !== 200) throw new Error(`${turn.status}: ${await turn.text()}`);
  const stream = await turn.text();
  expect(stream).toContain("done");
  expect(JSON.stringify(asked.at(-1)!.messages)).toContain("Why did it rain?");
  expect(JSON.stringify(asked.at(-1)!.messages)).toContain("Will it rain?");
  expect((await open()).branchVersion).toBe(before.version);
  expect(await journal(r, chatId)).toBe(before.journal);
});

test("on a Core scene, the automatic summary runs after a reply and its text reaches the next request", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const settings = await r.post("/api/chats/summary-settings", { chatId, patch: { auto: true, interval: 1, include: true } });
  if (settings.status !== 200) throw new Error(`${settings.status}: ${await settings.text()}`);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  model.reply = "AUTO SUMMARY TEXT";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  for (let waited = 0; waited < 3000 && !JSON.stringify(await chats.sceneState(take)).includes("AUTO SUMMARY TEXT"); waited += 20) await new Promise((done) => setTimeout(done, 20));
  expect(JSON.stringify(await chats.sceneState(take))).toContain("AUTO SUMMARY TEXT");
  model.reply = "Next.";
  const sent = await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?");
  expect(JSON.stringify(sent.messages)).toContain("AUTO SUMMARY TEXT");
});

test("on a Core scene, a preset block's attachments reach the model: a text file as its words, an image as an image part", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/cP3YdQAAAABJRU5ErkJggg==", "base64").toString("base64");
  const text = Buffer.from("THE TIDE TABLE").toString("base64");
  const prompt = (id: string, content: string, over: Record<string, unknown> = {}) => ({ id, name: id, content, role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false, ...over });
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "preset", id: "files", body: { ...emptyPresetBody("Files"), prompts: [
    prompt("main", "Be brief.", { attachments: [{ name: "tides.txt", ref: `data:text/plain;base64,${text}` }, { name: "map.png", ref: `data:image/png;base64,${png}` }] }),
    prompt("chatHistory", "{{message_history}}"),
  ] } } as never);
  const set = await r.post("/api/chats/preset", { chatId, preset: { id: "files", kind: "preset", toggles: {}, samplers: {} } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  model.attachmentsSeen = [];
  try {
    await sendAndAnswer(r, chatId, (await open()).branchVersion);
    const sent = model.attachmentsSeen.at(-1) ?? "";
    expect(sent).toContain("THE TIDE TABLE");
    expect(sent).toContain("image_url");
    expect(sent).toContain(`data:image/png;base64,${png}`);
  } finally { model.attachmentsSeen = null; }
});

test("a connection's message format decides whether the scene's system text stays a system message", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const noted = await r.post("/api/chats/prompting", { chatId, prompting: { note: { text: "SCENE NOTE", position: "in_chat", depth: 1, frequency: 1 } } });
  if (noted.status !== 200) throw new Error(`${noted.status}: ${await noted.text()}`);
  const roleOfNote = (messages: { role: string; content: string }[]) => messages.find((message) => message.content.includes("SCENE NOTE"))?.role;
  expect(roleOfNote((await sendAndAnswer(r, chatId, (await open()).branchVersion)).messages)).toBe("system");
  const saved = (await readVault(UNLOCK)).providers.find((provider) => provider.id === model.localId)!;
  await saveProvider({ ...saved, messageFormat: { preset: "strict" } }, UNLOCK);
  try {
    expect(roleOfNote((await sendAndAnswer(r, chatId, (await open()).branchVersion, "Again?")).messages)).toBe("user");
  } finally { await saveProvider(saved, UNLOCK); }
});

async function goldScene(r: Rig) {
  const scene = await coreScene(r);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "tracker", id: "gold", body: { name: "Gold", description: "", layout: "record", note: "", fields: [{ name: "coins", description: "", type: "number", default: 0 }, { name: "gems", description: "", type: "number", default: 0 }] } } as never);
  const set = await r.post("/api/chats/prompting", { chatId: scene.chatId, prompting: { toolAccess: true, trackers: ["gold"] } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  const chats = libraryFor(r.store.studioPath())!.chats;
  return { ...scene, chats, state: async () => JSON.stringify(await chats.sceneState((await chats.getChat(scene.chatId))!.activeBranchId)) };
}

test("on a Core scene, two tool writes in one round both land", async () => {
  const r = await rig({ core: true });
  const { chatId, open, state } = await goldScene(r);
  model.toolCalls.push({ name: "update_trackers", args: JSON.stringify({ updates: [{ tracker: "Gold", set: { coins: 7 } }] }) }, { name: "update_trackers", args: JSON.stringify({ updates: [{ tracker: "Gold", set: { gems: 2 } }] }) });
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(await state()).toContain("coins");
  expect(await state()).toContain("gems");
});

test("on a Core scene, a reply stopped partway keeps what it has and what its tools wrote", async () => {
  const r = await rig({ core: true });
  const { chatId, open, chats, state } = await goldScene(r);
  const sent = await r.post("/api/chats/send", { chatId, content: "Any gold?", greetingIndex: 0, expectedVersion: (await open()).branchVersion });
  const version = ((await sent.json()) as Opened).branchVersion;
  model.toolCallNext = { name: "update_trackers", args: JSON.stringify({ updates: [{ tracker: "Gold", set: { coins: 7 } }] }) };
  model.holdNext = true;
  const turn = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  for (let waited = 0; waited < 5000 && model.holdNext; waited += 10) await new Promise((done) => setTimeout(done, 10));
  await new Promise((done) => setTimeout(done, 200));
  expect(await (await r.post("/api/chats/stop", { chatId })).json()).toEqual({ stopped: true });
  const stream = await turn.text();
  if (!stream.includes("event: stopped")) throw new Error(stream.slice(-500));
  const take = (await chats.getChat(chatId))!.activeBranchId;
  expect((await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!.swipes.at(-1)!.content).toContain("Half a");
  expect(await state()).toContain("coins");
});

test("on a Core scene, a Promptbook runs its private phase first, hands its notes to the reply, and runs its after phase on the reply", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const book = bookRecipe("Casebook", "think");
  book.phases.push({ ...newBookPhase("tidy", "Tidy up", "after"), reads: ["write"] });
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "promptbook", id: "casebook", body: book } as never);
  const set = await r.post("/api/chats/preset", { chatId, preset: { kind: "promptbook", id: "casebook", toggles: {}, samplers: {} } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  const was = asked.length;
  model.reply = "PHASE ANSWER";
  const sent = await r.post("/api/chats/send", { chatId, content: "I open the door.", greetingIndex: 0, expectedVersion: (await open()).branchVersion });
  if (sent.status !== 200) throw new Error(`${sent.status}: ${await sent.text()}`);
  const turn = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: ((await sent.json()) as Opened).branchVersion });
  if (turn.status !== 200) throw new Error(`${turn.status}: ${await turn.text()}`);
  const stream = await turn.text();
  if (!stream.includes("event: done")) throw new Error(stream.slice(-800));
  const requests = asked.slice(was).map((request) => JSON.stringify(request.messages));
  expect(requests.length).toBe(3);
  expect(requests[1]).toContain("Notes from");
  expect(requests[1]).toContain("PHASE ANSWER");
  expect(requests[2]).toContain("Notes from");
  expect(stream.indexOf("event: phase")).toBeGreaterThan(-1);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  const trace = await chats.swipeTrace(tip.id, tip.swipes[tip.current]!.id);
  expect((trace?.["book"] as { status: string; phases: { id: string; status: string }[] }).phases.map((run) => [run.id, run.status])).toEqual(book.phases.map((phase) => [phase.id, "ran"]));
});

test("on a Core scene, a Promptbook whose private phase fails says so and writes no reply", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const book = bookRecipe("Casebook", "think");
  book.phases[0] = { ...book.phases[0]!, connection: { id: "gone", model: "gone" } };
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "promptbook", id: "casebook", body: book } as never);
  await r.post("/api/chats/preset", { chatId, preset: { kind: "promptbook", id: "casebook", toggles: {}, samplers: {} } });
  const sent = await r.post("/api/chats/send", { chatId, content: "I open the door.", greetingIndex: 0, expectedVersion: (await open()).branchVersion });
  const turn = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: ((await sent.json()) as Opened).branchVersion });
  const stream = await turn.text();
  expect(stream).toContain("event: failed");
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  expect((await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!.role).toBe("user");
});

test("on a Core scene, a reply's tool calls are kept in its version's trace", async () => {
  const r = await rig({ core: true });
  const { chatId, open, chats } = await goldScene(r);
  model.toolCallNext = { name: "update_trackers", args: JSON.stringify({ updates: [{ tracker: "Gold", set: { coins: 7 } }] }) };
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  const take = (await chats.getChat(chatId))!.activeBranchId;
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  const trace = await chats.swipeTrace(tip.id, tip.swipes[tip.current]!.id);
  expect((trace?.["tools"] as { calls: { name: string; ok: boolean }[] }).calls.map((call) => [call.name, call.ok])).toEqual([["update_trackers", true]]);
});

test("on a Core scene, a Promptbook reply's agent reading no history leaves the older messages out, and its after phase still reads them", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "An old question.");
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "agent", id: "brief", body: { ...emptyAgentBody("Brief"), contextMessages: 0 } } as never);
  const book = bookRecipe("Casebook", "blank");
  const reply = book.phases.findIndex((phase) => phase.role === "reply");
  book.phases[reply] = { ...book.phases[reply]!, agentId: "brief" };
  book.phases.push({ ...newBookPhase("tidy", "Tidy up", "after"), reads: [] });
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "promptbook", id: "casebook", body: book } as never);
  const set = await r.post("/api/chats/preset", { chatId, preset: { kind: "promptbook", id: "casebook", toggles: {}, samplers: {} } });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  const was = asked.length;
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "A new question.");
  const requests = asked.slice(was).map((request) => JSON.stringify(request.messages));
  expect(requests.length).toBe(2);
  expect(requests[0]).toContain("A new question.");
  expect(requests[0]).not.toContain("An old question.");
  expect(requests[1]).toContain("An old question.");
});

test("on a Core scene, a second Promptbook turn while one runs tells the page plainly, rather than losing the stream", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "promptbook", id: "casebook", body: bookRecipe("Casebook", "blank") } as never);
  await r.post("/api/chats/preset", { chatId, preset: { kind: "promptbook", id: "casebook", toggles: {}, samplers: {} } });
  const sent = await r.post("/api/chats/send", { chatId, content: "Hello.", greetingIndex: 0, expectedVersion: (await open()).branchVersion });
  const version = ((await sent.json()) as Opened).branchVersion;
  model.holdNext = true;
  const first = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  for (let waited = 0; waited < 5000 && model.holdNext; waited += 10) await new Promise((done) => setTimeout(done, 10));
  const second = await (await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version })).text();
  expect(second).toContain("event: failed");
  expect(second).toContain("a turn already owns this scene");
  expect(await (await r.post("/api/chats/stop", { chatId })).json()).toEqual({ stopped: true });
  await first.text();
});
