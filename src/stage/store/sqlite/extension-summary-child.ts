/** Paused real Core/summary fixture for cross-process extension revocation tests. */
import { cellCipher } from "../../crypto/cell-cipher";
import { subkeys } from "../../crypto/crypto";
import { createRoleplayCore, type ProviderRequestGuard } from "../../../rp-core";
import type { Provider, ProviderCompletion } from "../../contracts/provider";
import type { ChatConnection } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { summarizeAfter } from "../../../studio/scene-summary";
import { guardedProviderConnect } from "../../../studio/guarded-provider-connect";
import { castSnapshotCodec } from "../cast-snapshot-codec";
import { sqliteChatStoreBackend } from "./chat-store";
import { sqliteStateStore } from "./state-store";
import { openStageDatabase } from "./database";
import { attachRowFingerprints } from "./row-fingerprints";
import { sqliteExtensionStore } from "./extension-store";
import { requireExtensionCommit } from "./extension-commit-guard";
import { MIGRATIONS } from "./migrations";

const CAST = { character: { id: "vera", version: 1 } } as const;
const SNAP = { character: { kind: "character", id: "vera", body: {
  identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {},
} } } as const;

const [path, owner, rawNow, packageDigest] = Bun.argv.slice(2);
const keyText = process.env.BUNZAI_EXTENSION_TEST_KEY;
if (!path || !owner || !rawNow || !packageDigest || !keyText) throw new Error("missing isolated summary fixture arguments");
const now = Number(rawNow), database = openStageDatabase(path, MIGRATIONS);
const cipher = cellCipher(() => subkeys(Buffer.from(keyText, "base64")));
attachRowFingerprints(database, cipher);
const extensions = sqliteExtensionStore(database, cipher, () => now);

try {
  const fence = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!fence) throw new Error("summary fixture could not acquire its runtime fence");
  await extensions.savePackage({ digest: packageDigest, bytes: new TextEncoder().encode("two-process summary fixture") }, fence);
  const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now);
  const chat = await chats.createChat({ title: "Paused summary", cast: CAST, snapshot: SNAP });
  await chats.setConnection(chat.id, { id: "fixture-connection", model: "fixture-model" });
  await chats.setSummarySettings(chat.id, { auto: true, method: "pair" });
  const branch = (await chats.listBranches(chat.id))[0]!;
  await chats.appendMessages(branch.id, [
    { role: "user", content: "First question." },
    { role: "assistant", content: "First answer." },
    { role: "user", content: "Second question." },
  ]);
  const expectedVersion = (await chats.readMessages(branch.id, { limit: 1 })).branchVersion;
  if (expectedVersion === undefined || expectedVersion === null) throw new Error("summary fixture branch version is missing");
  const policyFingerprint = "d".repeat(64);
  const control = {
    id: "fixture.summary", revision: 0, packageDigest, policyFingerprint, grantRevision: 1,
    grants: [{ operation: "turns.start", resources: [{ kind: "scene" as const, id: chat.id }, { kind: "host-connection" as const, id: "fixture-connection" }],
      fields: ["turn.run", "model.prompt", "summary.automatic.write", "summary.error.write"], methods: [], destinations: ["connection:fixture-connection"], duration: "persistent" as const,
      budget: { requests: 4, bytes: 30_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true,
    recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const,
  };
  if (await extensions.compareAndSaveControl(control, -1, fence) !== "saved") throw new Error("summary fixture control did not save");
  const commit: ExtensionCommitContext = {
    owner: fence.owner, epoch: fence.epoch, packageId: control.id, packageDigest, policyFingerprint, grantRevision: 1, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "fixture-connection" }],
      fields: ["turn.run", "model.prompt", "summary.automatic.write", "summary.error.write"], methods: [], destinations: ["connection:fixture-connection"] }, now: () => now,
  };
  let sends = 0;
  const provider: Provider = { id: "fixture-connection", async send(): Promise<ProviderCompletion> {
    sends++;
    if (sends === 1) return { content: "Second answer.", finish_reason: "stop", raw: {} };
    if (sends !== 2) throw new Error("unexpected provider call in summary fixture");
    process.stdout.write("SUMMARY_WAITING\n");
    for await (const _ of Bun.stdin.stream()) break;
    return { content: "This summary must not persist.", finish_reason: "stop", raw: {} };
  } };
  const connect = async (_connection: ChatConnection) => ({ provider, kind: "openrouter" as const, context: 32_000 });
  const core = createRoleplayCore({
    chats, state: sqliteStateStore(database, cipher), connect, readPreset: async () => null, readLorebook: async () => null, now: () => now, randomSeed: () => 3,
    afterEvent: async (input, event, extensionCommit, providerGuard) => {
      if (event.type !== "done" || !extensionCommit) return;
      await summarizeAfter({ chats, connect: guardedProviderConnect(connect, providerGuard) }, input.chatId, input.kind, event.message, extensionCommit);
    },
  });
  const guard: ProviderRequestGuard = async (_connection, request, _io, send) => {
    requireExtensionCommit(database, cipher, commit);
    return send(request);
  };
  process.stdout.write(`${JSON.stringify({ owner: fence.owner, epoch: fence.epoch, chatId: chat.id, branchId: branch.id })}\n`);
  await core.runTurn({ chatId: chat.id, kind: "reply", expectedVersion }, () => undefined, commit, guard);
  process.stdout.write("SUMMARY_FINISHED\n");
  await core.close();
} finally { database.close(); }
