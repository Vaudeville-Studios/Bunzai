/** Scene composition tests for light Promptbook reads and phase-local media hydration. */
import { expect, test } from "bun:test";
import { bookRecipe, newBookPhase, replyPhase } from "../core/promptbook";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryStateStore } from "../stage/store/memory/state-store";
import type { Provider, ProviderRequest } from "../stage/contracts/provider";
import type { StudioStoreLike } from "../studio/contracts";
import type { Connected } from "../studio/scene-turn";
import { createContentExtensionPromptPreviewer } from "../studio/scene-forecast";
import { createSceneCore } from "./server-scene-composition";

test("scene turns read Promptbooks lightly and hydrate only the active phase's files", async () => {
  const book = bookRecipe("Casebook", "think");
  book.phases.push({ ...newBookPhase("after", "After", "after"), enabled: false });
  const refs = book.phases.map((phase, index) => {
    const sha = String(index + 1).repeat(64);
    phase.preset.prompts[0]!.attachments = [{ name: `${phase.id}.txt`, ref: `\u0000b:u:text/plain:${sha}` }];
    return sha;
  });
  const loadedRefs: string[] = [], readsAtSend: string[][] = [], lightKinds: string[] = [];
  let fullReads = 0;
  const provider: Provider = {
    id: "fixture",
    send: async (request: ProviderRequest) => {
      readsAtSend.push([...loadedRefs]);
      return { content: "phase complete", finish_reason: "stop", model: request.model, raw: {} };
    },
  };
  const studio = {
    read: async () => { fullReads++; throw new Error("scene turn must not materialize a full library entity"); },
    readLight: async (kind: string, id: string) => {
      lightKinds.push(`${kind}:${id}`);
      return { entity: { schemaVersion: "1", kind, id, body: book }, revision: "rev", version: 1, writeId: 1, assets: {} };
    },
    readAsset: async (sha: string) => {
      loadedRefs.push(sha);
      return { status: "ok" as const, bytes: new TextEncoder().encode(`phase ${sha[0]}`) };
    },
  } as unknown as Pick<StudioStoreLike, "read" | "readLight" | "readAsset">;
  const chats = memoryChatStore();
  const character = { kind: "character", id: "fixture", body: { identity: { name: "Fixture" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Light scene", cast: { character: { id: "fixture", version: 1 } }, snapshot: { character } });
  await chats.setConnection(chat.id, { id: "fixture", model: "fixture-model" });
  await chats.setPreset(chat.id, { kind: "promptbook", id: "book", toggles: {}, samplers: {} });
  await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Hello." }, { role: "user", content: "Continue." }]);
  const connect = async (): Promise<Connected> => ({ kind: "fixture", context: 32_000, provider });
  const core = createSceneCore(chats, memoryStateStore(), async () => replyPhase(book).preset, async () => null, studio, undefined, null, undefined, undefined, connect);
  try {
    await core.runTurn({ chatId: chat.id, kind: "reply", expectedVersion: (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion! }, () => undefined);
    expect(fullReads).toBe(0);
    expect(lightKinds).toContain("promptbook:book");
    expect(readsAtSend).toEqual([[refs[0]!], [refs[0]!, refs[1]!]]);
    expect(loadedRefs).toEqual(refs.slice(0, 2));
  } finally { await core.close(); }
});

test("extension Promptbook previews use the canonical light envelope, never the full read", async () => {
  const book = bookRecipe("Preview", "blank");
  const chats = memoryChatStore();
  const character = { kind: "character", id: "fixture", body: { identity: { name: "Fixture" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Light preview", cast: { character: { id: "fixture", version: 1 } }, snapshot: { character } });
  await chats.setPreset(chat.id, { kind: "promptbook", id: "book", toggles: {}, samplers: {} });
  let fullReads = 0, lightReads = 0;
  const content = {
    read: async () => { fullReads++; throw new Error("preview must not materialize the full entity"); },
    readLight: async (kind: string, id: string) => {
      lightReads++;
      return { entity: { schemaVersion: "1", kind, id, body: book }, revision: "rev", version: 1, writeId: 1, assets: {} };
    },
  };
  const preview = createContentExtensionPromptPreviewer(chats, memoryStateStore(), content as never);
  const result = await preview(chat.id, "A local draft.");
  expect(result.messages.some((message) => message.content.includes("A local draft."))).toBe(true);
  expect(lightReads).toBeGreaterThan(0);
  expect(fullReads).toBe(0);
});
