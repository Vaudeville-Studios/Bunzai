/** A paused extension follow-on cannot persist its summary after the package grant is revoked. */
import { afterEach, expect, test } from "bun:test";
import type { ExtensionCommitContext, StoredExtensionControl } from "../stage/contracts/extension-store";
import type { Provider, ProviderCompletion } from "../stage/contracts/provider";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryExtensionStore } from "../stage/store/memory/extension-store";
import { castSnapshotCodec } from "../stage/store/cast-snapshot-codec";
import { sqliteChatStoreBackend } from "../stage/store/sqlite/chat-store";
import { sqliteExtensionStore } from "../stage/store/sqlite/extension-store";
import type { StageDatabase } from "../stage/store/sqlite/database";
import { freshDatabase, testCipher } from "../stage/store/sqlite/test-support";
import { enqueue } from "./compendium-queue";
import { summarizeAfter, type SummaryDeps } from "./scene-summary";
import type { Connected } from "./scene-turn";

const open: StageDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
const CAST = { character: { id: "vera", version: 1 } } as const;
const SNAP = { character: { kind: "character", id: "vera", body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } } } as const;

for (const kind of ["memory", "sqlite"] as const) for (const outcome of ["revoke", "cancel"] as const) test(`${kind} summary follow-on drops output after ${outcome} during the provider call`, async () => {
  let now = 10_000;
  const owner = `00000000-0000-4000-8000-${kind === "memory" ? "000000000011" : "000000000012"}`;
  const cipher = testCipher();
  const database = kind === "sqlite" ? freshDatabase(open) : null;
  const memoryExtensions = database ? null : memoryExtensionStore(() => now);
  const extensions = database ? sqliteExtensionStore(database, cipher, () => now) : memoryExtensions!;
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const fields = ["summary.automatic.write", "summary.error.write"];
  const chatStore = database
    ? sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now)
    : memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => memoryExtensions!.assertCommitContext(context) });
  const chat = await chatStore.createChat({ title: "Fence fixture", cast: CAST, snapshot: SNAP });
  await chatStore.setConnection(chat.id, { id: "reviewed", model: "reviewed-model" });
  await chatStore.setSummarySettings(chat.id, { auto: true, interval: 2 });
  const branch = (await chatStore.listBranches(chat.id))[0]!;
  await chatStore.appendMessages(branch.id, [{ role: "user", content: "one" }, { role: "assistant", content: "two" }, { role: "user", content: "three" }]);
  const landed = (await chatStore.appendMessage(branch.id, { role: "assistant", content: "four" }))!;
  const control: StoredExtensionControl = {
    id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "turns.start", resources: [{ kind: "scene", id: chat.id }], fields, methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 30_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete",
  };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const controller = new AbortController();
  const context: ExtensionCommitContext = {
    owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "turns.start", access: { resources: [{ kind: "scene", id: chat.id }], fields, methods: [], destinations: [] }, signal: controller.signal, now: () => now,
  };
  let entered!: () => void;
  let finish!: (value: ProviderCompletion) => void;
  const providerStarted = new Promise<void>((resolve) => { entered = resolve; });
  const answer = new Promise<ProviderCompletion>((resolve) => { finish = resolve; });
  const provider: Provider = { id: "reviewed-model", async send() { entered(); return answer; } };
  const deps: SummaryDeps = {
    chats: chatStore,
    connect: async (): Promise<Connected | null> => ({ provider, kind: "fixture" }),
  };
  const run = summarizeAfter(deps, chat.id, "reply", landed, context);
  await providerStarted;
  if (outcome === "revoke") expect(await extensions.compareAndSaveControl({ ...control, revision: 1, enabled: false }, 0, lease)).toBe("saved");
  else controller.abort();
  finish({ content: "must not persist", finish_reason: "stop", raw: {} });
  await run;
  await enqueue(chat.id, async () => undefined);
  expect(await chatStore.summaryOf(branch.id)).toBeNull();
});
