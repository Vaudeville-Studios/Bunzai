/** Child process fixture for lease contention and stale-fence commit tests. */
import { cellCipher } from "../../crypto/cell-cipher";
import { subkeys } from "../../crypto/crypto";
import { attachRowFingerprints } from "./row-fingerprints";
import { openStageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";
import { sqliteExtensionStore } from "./extension-store";
import { sqliteDocumentBackend } from "./document-backend";
import { createContentStore } from "../content-store";
import { character } from "../../contracts/content-store.contract-fixtures";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { castSnapshotCodec } from "../cast-snapshot-codec";
import { sqliteChatStoreBackend } from "./chat-store";

const [path, owner, rawNow, mode, packageDigest] = Bun.argv.slice(2);
const keyText = process.env.BUNZAI_EXTENSION_TEST_KEY;
if (!path || !owner || !rawNow || !mode || !keyText) throw new Error("missing isolated lease fixture arguments");
const now = Number(rawNow); const database = openStageDatabase(path, MIGRATIONS);
const cipher = cellCipher(() => subkeys(Buffer.from(keyText, "base64")));
attachRowFingerprints(database, cipher);
const store = sqliteExtensionStore(database, cipher, () => now);
try {
  const fence = await store.acquireRuntimeFence(owner, now, 30_000);
  if (!fence || mode === "once") { process.stdout.write(JSON.stringify(fence)); process.exit(0); }
  const bytes = new TextEncoder().encode("two-process fixture package");
  if (!packageDigest) throw new Error("missing trusted fixture digest");
  await store.savePackage({ digest: packageDigest, bytes }, fence);
  await store.compareAndSaveControl({ id: "fixture.extension", revision: 0, packageDigest, policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "content.draft.apply", resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [], duration: "persistent", budget: { requests: 2, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" }, -1, fence);
  const content = createContentStore(sqliteDocumentBackend(database, cipher));
  const saved = await content.save(character("Ada"));
  const stored = await content.read("character", "Ada");
  if (stored?.entity.kind !== "character") throw new Error("fixture character did not persist");
  const next = structuredClone(stored.entity);
  next.body.identity.name = "changed by stale process";
  const commit = { owner: fence.owner, epoch: fence.epoch, packageId: "fixture.extension", packageDigest, policyFingerprint: "b".repeat(64),
    grantRevision: 1, operation: "content.draft.apply", access: { resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [] }, now: () => now };
  if (mode === "paused-turn") {
    const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now);
    const chat = await chats.createChat({ title: "Paused fixture", cast: CAST, snapshot: SNAP });
    const branch = (await chats.listBranches(chat.id))[0]!;
    await store.compareAndSaveControl({ id: "fixture.turn", revision: 0, packageDigest, policyFingerprint: "c".repeat(64), grantRevision: 1,
      grants: [
        { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "fixture-connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
        { operation: "state.write.apply", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
      ], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" }, -1, fence);
    const stateCommit = { owner: fence.owner, epoch: fence.epoch, packageId: "fixture.turn", packageDigest, policyFingerprint: "c".repeat(64), grantRevision: 1,
      operation: "state.write.apply", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [] }, now: () => now };
    const turnCommit = { ...stateCommit, operation: "turns.start", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "fixture-connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:fixture-connection"] } };
    const turn = await chats.beginTurn(branch.id, { kind: "reply" }, { expectedVersion: branch.version }, turnCommit);
    if (!turn) throw new Error("fixture turn could not start");
    const staged = await chats.appendPendingExtensionDeltas(turn.id, "fixture.turn", branch.version,
      [{ slot: "ext:fixture.turn:paused", path: ["value"], value: "must not commit after revoke", at: now }], stateCommit);
    if (!staged) throw new Error("fixture pending state could not be staged");
    process.stdout.write(`${JSON.stringify({ owner: fence.owner, epoch: fence.epoch, chatId: chat.id, branchId: branch.id, turnId: turn.id })}\n`);
    for await (const _ of Bun.stdin.stream()) {
      try { await chats.commitTurn(turn.id, { content: "resumed stale provider reply" }, { expectedVersion: branch.version }, turnCommit); process.stdout.write("UNEXPECTED_COMMIT\n"); }
      catch {
        try { await chats.commitTurn(turn.id, { content: "first-party recovery must not inherit extension state" }, { expectedVersion: branch.version }); process.stdout.write("UNEXPECTED_RECOVERY\n"); }
        catch { process.stdout.write("FENCED:FIRST_PARTY_BLOCKED\n"); }
      }
      break;
    }
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify(fence)}\n`);
  for await (const _ of Bun.stdin.stream()) {
    try { await content.saveIfUnchanged(next, saved.revision, commit); process.stdout.write("COMMITTED\n"); }
    catch { process.stdout.write("FENCED\n"); }
    break;
  }
} finally { database.close(); }
