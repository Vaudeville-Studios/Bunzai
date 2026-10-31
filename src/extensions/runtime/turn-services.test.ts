/** Extension turn budgets wrap every existing RoleplayCore provider request. */
import { expect, test } from "bun:test";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import { bookRecipe, newBookPhase, replyPhase } from "../../core/promptbook";
import { memoryChatStore } from "../../stage/store/chat-store";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import type { Provider, ProviderRequest } from "../../stage/contracts/provider";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import { createRoleplayCore } from "../../rp-core";
import { createExtensionTurnServices } from "./turn-services";
import { createHostActionPort } from "./host-action-port";

async function fixture(firstPromptBytes: number, secondPromptBytes = 0, withRegex = false) {
  let id = 0, now = 1_000;
  const chats = memoryChatStore(() => now++, () => `id-${++id}`, { authorizeExtensionCommit: (context) => { if (context.operation !== "turns.start") throw new Error("unexpected commit operation"); } });
  const character = { kind: "character", id: "vera", body: { identity: { name: "Vera", description: "A detective" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Case", cast: { character: { id: "vera", version: 1 } }, snapshot: { character } });
  await chats.setConnection(chat.id, { id: "connection", model: "reviewed-model" });
  const regex = { name: "Redaction", rules: [{ id: "redact", label: "Redact", find: "door", flags: "g", replace: "window", phases: ["prompt"], enabled: true, sortOrder: 0 }] };
  if (withRegex) await chats.setRegex(chat.id, { sets: ["redaction"] });
  await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Evening." }, { role: "user", content: "I open the door." }]);
  const book = bookRecipe("Casebook", "think");
  book.phases[0]!.preset.prompts[0]!.content = "A".repeat(firstPromptBytes);
  if (secondPromptBytes) {
    const extra = newBookPhase("plan", "Plan", "private");
    extra.preset.prompts[0]!.content = "B".repeat(secondPromptBytes);
    book.phases.splice(1, 0, extra);
  }
  const sent: ProviderRequest[] = [];
  const provider: Provider = { id: "connection", async send(request) { sent.push(request); return { content: "A clue.", finish_reason: "stop", raw: {} }; } };
  const configState = { fingerprint: "a".repeat(64) };
  const resolvedState = { fingerprint: configState.fingerprint };
  const core = createRoleplayCore({ chats, state: memoryStateStore(), connect: async () => ({ provider, kind: "fake", context: 32_000, providerConfigFingerprint: resolvedState.fingerprint }),
    readPreset: async () => replyPhase(book).preset,
    readLibrary: async (kind, pieceId) => kind === "promptbook" && pieceId === "book" ? { schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id: pieceId, body: book } : null,
    readLorebook: async () => null, readRegex: async (id) => id === "redaction" ? regex : null, now: () => now++, randomSeed: () => 7 });
  let actionId = 0;
  const hostActions = createHostActionPort({ now: Date.now, id: () => `action-${++actionId}` });
  const service = createExtensionTurnServices(core, chats, hostActions, async () => ({ fingerprint: configState.fingerprint }));
  const page = await chats.readMessages(chat.activeBranchId, { limit: 1 });
  const commit: ExtensionCommitContext = { owner: "runtime", epoch: 1, packageId: "bunzai.extension.test", packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1, operation: "turns.start", access: { resources: [{ kind: "scene", id: "scene-placeholder" }, { kind: "host-connection", id: "connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:connection"] }, now: () => now };
  const principal = { storeId: "test-store", packageId: commit.packageId, packageDigest: commit.packageDigest, apiMajor: 1, policyFingerprint: commit.policyFingerprint, grantRevision: 1, runEpoch: 1 };
  return { chats, chat, book, core, service, sent, branchVersion: page.branchVersion!, commit, principal, hostActions, configState, resolvedState };
}

test("a saved provider config changed after review is rejected before the first send", async () => {
  const f = await fixture(0);
  const scope = [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }];
  const reviewed = await f.service.review(f.chat.id, "reply", f.branchVersion, scope, { summary: false, compendium: false, lorebookIds: [] });
  if (!reviewed) throw new Error("connection review unavailable");
  f.configState.fingerprint = "b".repeat(64);
  const result = await f.service.run(f.principal, f.chat.id, "connection", reviewed.model, reviewed.configFingerprint, "reply", f.branchVersion,
    scope, { ...f.commit, access: { ...f.commit.access, resources: scope } }, new AbortController().signal, async () => undefined);
  expect(result.status).toBe("conflict");
  expect(f.sent).toHaveLength(0);
  await f.core.close();
});

test("a scene-specific model may differ from the saved connection default", async () => {
  const f = await fixture(0);
  await f.chats.setConnection(f.chat.id, { id: "connection", model: "scene-specific-model" });
  const scope = [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }];
  const reviewed = await f.service.review(f.chat.id, "reply", f.branchVersion, scope, { summary: false, compendium: false, lorebookIds: [] });
  if (!reviewed) throw new Error("scene-specific model review unavailable");
  expect(reviewed.model).toBe("scene-specific-model");
  const result = await f.service.run(f.principal, f.chat.id, "connection", reviewed.model, reviewed.configFingerprint, "reply", f.branchVersion,
    scope, { ...f.commit, access: { ...f.commit.access, resources: scope } }, new AbortController().signal, async () => undefined);
  expect(result.status).toBe("completed");
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]?.model).toBe("scene-specific-model");
  await f.core.close();
});

test("a provider resolved from a changed endpoint is rejected even if the saved connection returns to the reviewed config", async () => {
  const f = await fixture(0);
  const scope = [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }];
  const reviewed = await f.service.review(f.chat.id, "reply", f.branchVersion, scope, { summary: false, compendium: false, lorebookIds: [] });
  if (!reviewed) throw new Error("provider review unavailable");
  f.resolvedState.fingerprint = "b".repeat(64);
  const result = await f.service.run(f.principal, f.chat.id, "connection", reviewed.model, reviewed.configFingerprint, "reply", f.branchVersion,
    scope, { ...f.commit, access: { ...f.commit.access, resources: scope } }, new AbortController().signal, async () => undefined);
  expect(result.status).not.toBe("completed");
  expect(f.sent).toHaveLength(0);
  await f.core.close();
});

test("a later Promptbook phase is blocked before send by the shared turn budget", async () => {
  const f = await fixture(24_000, 24_000);
  await f.chats.setPreset(f.chat.id, { kind: "promptbook", id: "book", toggles: {}, samplers: {} });
  const result = await f.service.run(f.principal, f.chat.id, "connection", "reviewed-model", "a".repeat(64), "reply", f.branchVersion,
    [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }], { ...f.commit, access: { ...f.commit.access, resources: [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }] } }, new AbortController().signal, async () => {});
  expect(result.status).toBe("failed");
  expect(f.sent).toHaveLength(1);
  await f.core.close();
});

test("an oversized first Promptbook prompt is refused before any provider send", async () => {
  const f = await fixture(45_000);
  await f.chats.setPreset(f.chat.id, { kind: "promptbook", id: "book", toggles: {}, samplers: {} });
  const result = await f.service.run(f.principal, f.chat.id, "connection", "reviewed-model", "a".repeat(64), "reply", f.branchVersion,
    [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }], { ...f.commit, access: { ...f.commit.access, resources: [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }] } }, new AbortController().signal, async () => {});
  expect(result.status).toBe("failed");
  expect(f.sent).toHaveLength(0);
  await f.core.close();
});

test("the existing scene regex gate waits for a typed host worker answer before provider send", async () => {
  const f = await fixture(0, 0, true);
  const run = f.service.run(f.principal, f.chat.id, "connection", "reviewed-model", "a".repeat(64), "reply", f.branchVersion,
    [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }], { ...f.commit, access: { ...f.commit.access, resources: [{ kind: "scene", id: f.chat.id }, { kind: "host-connection", id: "connection" }] } }, new AbortController().signal, async () => {});
  let ticket = f.hostActions.actions()[0];
  for (let count = 0; !ticket && count < 100; count++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    ticket = f.hostActions.actions()[0];
  }
  expect(ticket?.action).toBe("scene-turn.regex");
  if (!ticket || ticket.action !== "scene-turn.regex") throw new Error("scene regex ticket was not queued");
  expect(ticket.operation).toBe("turns.start");
  expect(f.sent).toHaveLength(0);
  expect(f.hostActions.answer(ticket.id, { status: "scene-regex-result", answer: { kind: "done", texts: {} } })).toBe(true);
  expect((await run).status).toBe("completed");
  expect(f.sent).toHaveLength(1);
  await f.core.close();
});
