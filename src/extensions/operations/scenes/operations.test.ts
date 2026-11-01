/** Exercises exact scope denial and safe scene/transcript projections over ChatStore. */
import { expect, test } from "bun:test";
import { bindExtensionDefinitions, type ExtensionOperationContext, type ExtensionOperationDefinition, type OperationPrincipal, type ResourceRef } from "../../contracts/operation";
import { memoryChatStore } from "../../../stage/store/chat-store";
import { MAX_VALUE_BYTES } from "../../contracts/value";
import type { ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import { createExtensionBroker } from "../../broker/invoke";
import { extensionGrantSetSchema } from "../../contracts/grants";
import { createExtensionSceneServices } from "../../runtime/scene-services";
import { messagePageOutput, sceneOperations, versionOutput } from "./operations";
import { sceneSummarySchema, takeSummarySchema } from "./_schemas";
import { z } from "zod";

const principal: OperationPrincipal = {
  storeId: "store", packageId: "pkg", packageDigest: "a".repeat(64), apiMajor: 1,
  policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1,
};
function context(resources: readonly ResourceRef[], fields: readonly string[] = []): ExtensionOperationContext {
  return {
    principal, signal: new AbortController().signal, invocation: { resources: [] }, resources, grantedOperations: [], host: "desktop",
    availableOperations: [], availableGrants: [], operationReceipts: [], activationOrigin: "command",
    declaredCommands: [], declaredPanels: [], declaredAssets: [],
    access: { resources, fields, methods: [], destinations: [] },
    commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "pkg", packageDigest: principal.packageDigest,
      policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: "fixture", access: { resources, fields, methods: [], destinations: [] }, now: () => 1 },
    confirm: async () => false, assertCurrent: async () => {},
  };
}
function operation(id: string): ExtensionOperationDefinition {
  return sceneOperations.find((item) => item.metadata.id === id)! as ExtensionOperationDefinition;
}

test("message reads require the entire requested scene and take grant before touching ChatStore", async () => {
  const chats = memoryChatStore(() => 10, () => "scene-1");
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: {} } });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const appended = await chats.appendMessage(branch.id, { role: "assistant", content: "private fixture text" });
  await chats.addSwipe(appended!.id, { content: "active swipe" });
      const services = createExtensionSceneServices(chats, undefined, null);
  const read = operation("messages.read");
  const input = read.metadata.input.parse({ sceneId: chat.id, takeId: branch.id, seq: appended!.seq, fields: ["message.seq", "message.content"] });

  await expect(read.execute(input, context([{ kind: "scene", id: chat.id }]), services)).rejects.toThrow("outside the approved grant");
  const requestedFields = ["message.seq", "message.content"];
  await expect(read.execute(input, context([{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }]), services)).rejects.toThrow("fields are outside");
  const result = read.metadata.output.parse(await read.execute(input, context([{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], requestedFields), services));
  expect(result).toMatchObject({ seq: appended!.seq, content: "active swipe" });
  expect(result).not.toHaveProperty("role");
});

test("take listing returns only explicitly approved takes, and paged Unicode text stays under the wire cap", async () => {
  let id = 0;
  const chats = memoryChatStore(() => 10, () => `id-${++id}`);
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: {} } });
  const original = (await chats.listBranches(chat.id))[0]!;
  const seed = await chats.appendMessage(original.id, { role: "assistant", content: "seed" });
  const second = await chats.fork(original.id, seed!.id, { name: "second" });
  expect(second).not.toBeNull();
      const services = createExtensionSceneServices(chats, undefined, null);
  const takes = operation("takes.list");
  const takeInput = takes.metadata.input.parse({ sceneId: chat.id, scope: { type: "selected", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: original.id }] }, limit: 10 });
  const takeResult = z.array(takeSummarySchema).parse(await takes.execute(takeInput, context([{ kind: "scene", id: chat.id }, { kind: "take", id: original.id }]), services));
  expect(takeResult.map((item) => item.id)).toEqual([original.id]);

  const hostileText = "\n\"\\\b" + "\u0001".repeat(10_000);
  await chats.appendMessages(original.id, Array.from({ length: 50 }, () => ({ role: "assistant" as const, content: hostileText })));
  const messages = operation("messages.list");
  const fields = ["message.seq", "message.content"];
  const messageInput = messages.metadata.input.parse({ sceneId: chat.id, takeId: original.id, limit: 50, fields });
  const result = messagePageOutput.parse(await messages.execute(messageInput, context([{ kind: "scene", id: chat.id }, { kind: "take", id: original.id }], fields), services));
  expect(result.messages.length).toBeLessThan(50);
  expect(result.nextSeq).not.toBeNull();
  expect(result.messages[1]?.contentTruncated).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(MAX_VALUE_BYTES);

  for (let index = 0; index < 35; index++) await chats.addSwipe(seed!.id, { content: hostileText });
  expect((await chats.readMessageSwipe(original.id, seed!.id, 0)).swipeCount).toBe(36);
  const history = operation("messages.versions.list");
  const historyInput = (fromIndex: number) => history.metadata.input.parse({ sceneId: chat.id, takeId: original.id, seq: seed!.seq, fromIndex });
  const historyContext = context([{ kind: "scene", id: chat.id }, { kind: "take", id: original.id }], ["message.history"]);
  const historyPage = versionOutput.parse(await history.execute(historyInput(0), historyContext, services));
  expect(historyPage.versions.length).toBeLessThan(32);
  expect(historyPage.nextIndex).not.toBeNull();
  expect(historyPage.versions[1]?.contentTruncated).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(historyPage)).byteLength).toBeLessThanOrEqual(MAX_VALUE_BYTES);
  const nextIndex = historyPage.nextIndex;
  if (nextIndex === null) throw new Error("expected another history page");
  const historyNext = versionOutput.parse(await history.execute(historyInput(nextIndex), historyContext, services));
  expect(historyNext.versions[0]?.index).toBe(nextIndex);
});

test("scene list exposes only its safe projection and filters selected IDs before paging", async () => {
  const chats = memoryChatStore(() => 10, (() => { let id = 0; return () => `scene-${++id}`; })());
  const first = await chats.createChat({ title: "First", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: { private: "no" } } });
  await chats.createChat({ title: "Second", cast: { character: { id: "niko", version: 1 } }, snapshot: { character: {} } });
      const services = createExtensionSceneServices(chats, undefined, null);
  const list = operation("scenes.list");
  const input = list.metadata.input.parse({ scope: { type: "selected", resources: [{ kind: "scene", id: first.id }] }, limit: 1 });
  const result = z.array(sceneSummarySchema).parse(await list.execute(input, context([{ kind: "scene", id: first.id }]), services));
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: first.id, title: "First" });
  expect(result[0]).not.toHaveProperty("snapshot");
});

test("broker reserves the actual wire ceiling for escaped transcript pages and settles actual bytes", async () => {
  let nextId = 0; const chats = memoryChatStore(() => 10, () => `scene-budget-${++nextId}`);
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "mira", version: 1 } }, snapshot: { character: {} } });
  const branch = (await chats.listBranches(chat.id))[0]!;
  await chats.appendMessages(branch.id, Array.from({ length: 50 }, (_, index) => ({ role: "assistant" as const, content: `\n"\\\b${"\u0001".repeat(1_000)}-${index}` })));
  const operationSet = bindExtensionDefinitions(sceneOperations, createExtensionSceneServices(chats, undefined, null));
  const grants = extensionGrantSetSchema.parse({ packageId: "pkg", packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
    grants: [{ operation: "messages.list", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.seq", "message.content"], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: MAX_VALUE_BYTES, tokens: 0 } }] });
  let reservation: ExtensionBudgetReservation | undefined; let settled: { bytes: number; tokens: number } | undefined;
  const invoke = createExtensionBroker(operationSet, {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => false, reserveBudget: async (row) => { reservation = row; return true; },
    settleBudget: async (_packageId, _id, bytes, tokens) => { settled = { bytes, tokens }; return bytes <= reservation!.bytes; },
    record: async () => undefined, readReceipts: async () => [], now: () => 10, id: () => "receipt-1",
    commitContext: (_principal, operation, access) => ({ ...context([]).commit, operation, access }),
  });
  const output = await invoke({ v: 1, type: "request", id: 1, operation: "messages.list", args: { sceneId: chat.id, takeId: branch.id, limit: 50, fields: ["message.seq", "message.content"] } }) as { messages: unknown[]; nextSeq: number | null };
  expect(reservation?.bytes).toBe(MAX_VALUE_BYTES);
  expect(settled?.bytes).toBeGreaterThan(0);
  expect(settled!.bytes).toBeLessThanOrEqual(reservation!.bytes);
  expect(output.messages.length).toBeLessThan(50);
  expect(output.nextSeq).not.toBeNull();
});
