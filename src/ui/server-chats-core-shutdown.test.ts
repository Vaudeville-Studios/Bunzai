/** Library shutdown cancels a core review gate and awaits the engine's journal work. */
import { afterEach, expect, test } from "bun:test";
import { saveProvider } from "../kit/providers/vault";
import { Engine } from "rp-core";
import { libraryFor } from "../studio/library-content";
import { chatRouteRig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { sceneRuntimeFor } from "./server-scene-runtime";
import { testCharacter } from "../studio/test-character";

afterEach(cleanupChatRouteRigs);
test("closing a library stops an external core review wait and drains its owned work", async () => {
  const provider = await saveProvider({ kind: "local", name: "Review fixture", model: "test", baseURL: "http://127.0.0.1:9/v1" }, { passphrase: "core-shutdown-test" });
  const rig = await chatRouteRig({ core: true });
  await rig.store.save(vera);
  const chat = await (await rig.post("/api/chats/start", { characterId: "vera" })).json() as { id: string };
  const sent = await rig.post("/api/chats/send", { chatId: chat.id, content: "Hello", greetingIndex: 1, expectedVersion: 1 });
  expect(sent.status).toBe(200);
  const chats = libraryFor(rig.store.studioPath())!.chats;
  await rig.post("/api/chats/connection", { chatId: chat.id, connection: { id: provider.id, model: "test" } });
  const initial = (await chats.readMessages((await chats.listBranches(chat.id))[0]!.id, { limit: 10 })).messages[0]!;
  expect(initial).toMatchObject({ role: "assistant", current: 1, swipes: [{ content: "Hello User." }, { content: "Evening." }] });
  const greeting = initial;
  const corrupted = await chats.editSwipe(greeting.id, greeting.swipes[0]!.id, "Wrong historical greeting.", { expectedVersion: (await chats.listBranches(chat.id))[0]!.version });
  if (!corrupted) throw new Error("could not create the historical-sibling mismatch fixture");
  const rejected = await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: (await chats.listBranches(chat.id))[0]!.version });
  expect(rejected.status).toBe(409);
  await chats.editSwipe(greeting.id, greeting.swipes[0]!.id, "Hello User.", { expectedVersion: (await chats.listBranches(chat.id))[0]!.version });
  const currentVersion = (await chats.listBranches(chat.id))[0]!.version;
  const response = await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: currentVersion, inspect: true });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let wire = "";
  while (!wire.includes("event: review")) {
    const frame = await reader.read();
    if (frame.done) throw new Error(`core never reached review: ${wire}`);
    wire += new TextDecoder().decode(frame.value);
  }
  const closing = rig.close();
  while (true) { const frame = await reader.read(); if (frame.done) break; wire += new TextDecoder().decode(frame.value); }
  await closing;
  expect(wire).toContain("event: stopped");
  expect(sceneRuntimeFor(chats).closed).toBe(true);
  expect(sceneRuntimeFor(chats).tasks.size).toBe(0);
});

test("published template greetings are repaired only from the exact frozen unmapped greeting set", async () => {
  const provider = await saveProvider({ kind: "local", name: "Repair fixture", model: "test", baseURL: "http://127.0.0.1:9/v1" }, { passphrase: "core-greeting-repair" });
  const rig = await chatRouteRig({ core: true });
  await rig.store.save(testCharacter("vera", [], { name: "Vera", firstMessage: "Hello {{user}}.", alternateGreetings: ["Evening {{user}}."] }));
  const chat = await (await rig.post("/api/chats/start", { characterId: "vera" })).json() as { id: string };
  await rig.post("/api/chats/connection", { chatId: chat.id, connection: { id: provider.id, model: "test" } });
  const stores = libraryFor(rig.store.studioPath())!;
  const link = await stores.core!.sceneFor(chat.id);
  if (!link) throw new Error("Core scene link is missing");
  const engine = await Engine.openWithRecordStore({ home: rig.store.studioPath(), recordStore: stores.core!, lane: "manual" });
  let coreSiblings: string[] = [];
  try {
    const session = await engine.session(link.sessionId);
    await session.send({ text: "Hello", expectedVersion: await session.version(), greetingIndex: 1 });
    coreSiblings = (await session.messageSiblings((await session.view()).path[0]!.id)).map((message) => message.id);
  } finally { await engine.close(); }
  const branch = (await stores.chats.listBranches(chat.id))[0]!;
  const frozenBeforeRepair = await stores.chats.castSnapshot(chat.id);
  const [greeting] = await stores.chats.appendMessages(branch.id, [{ role: "assistant", content: "Hello {{user}}." }, { role: "user", content: "Hello" }], { expectedVersion: branch.version }) ?? [];
  if (!greeting) throw new Error("could not construct the published greeting projection");
  const swiped = await stores.chats.addSwipe(greeting.id, { content: "Evening {{user}}." }, { expectedVersion: (await stores.chats.listBranches(chat.id))[0]!.version });
  if (!swiped || !await stores.chats.selectSwipe(greeting.id, 1, { expectedVersion: (await stores.chats.listBranches(chat.id))[0]!.version })) throw new Error("could not select the published alternate greeting");
  const version = (await stores.chats.listBranches(chat.id))[0]!.version;
  const editSwipe = stores.chats.editSwipe.bind(stores.chats);
  let editCount = 0;
  stores.chats.editSwipe = async (...args) => {
    if (++editCount === 2) throw new Error("simulated interruption between greeting repairs");
    return editSwipe(...args);
  };
  let response: Response;
  try { response = await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: version, inspect: true }); }
  finally { stores.chats.editSwipe = editSwipe; }
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const partial = (await stores.chats.readMessages(branch.id, { limit: 5 })).messages[0]!;
  expect(partial.swipes.map((swipe) => swipe.content)).toEqual(["Hello User.", "Evening {{user}}."]);
  const partialVersion = (await stores.chats.listBranches(chat.id))[0]!.version;
  response = await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: partialVersion, inspect: true });
  expect(response.status).toBe(409);
  const projected = (await stores.chats.readMessages(branch.id, { limit: 5 })).messages[0]!;
  expect(projected.swipes.map((swipe) => swipe.content)).toEqual(["Hello User.", "Evening User."]);
  expect(projected.current).toBe(1);
  expect((await stores.chats.listBranches(chat.id))[0]!.version).toBeGreaterThan(version);
  expect(await Promise.all(coreSiblings.map((id) => stores.core!.messageIdentityFor(link.sessionId, id, branch.id)))).toEqual([
    { messageId: greeting.id, swipeId: projected.swipes[0]!.id },
    { messageId: greeting.id, swipeId: projected.swipes[1]!.id },
  ]);
  expect(await stores.chats.castSnapshot(chat.id)).toEqual(frozenBeforeRepair);
});
