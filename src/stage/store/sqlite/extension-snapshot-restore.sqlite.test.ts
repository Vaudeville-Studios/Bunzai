/** Real restore coverage for extension-owned rows and sealed checkpoint ownership. */
import { afterEach, expect, test } from "bun:test";
import type { StoredExtensionControl } from "../../contracts/extension-store";
import { sha256HexBytes } from "../../../core/sha256";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { makeRig, type Rig } from "../fake-snapshot-rig";
import { sqliteExtensionStore } from "./extension-store";

const rigs: Rig[] = [];
afterEach(() => { for (const rig of rigs.splice(0)) rig.close(); });

test("snapshot restore recovers extension control, data, and encrypted checkpoint owner", async () => {
  let now = 20_000;
  const rig = await makeRig(); rigs.push(rig);
  const store = sqliteExtensionStore(rig.d, rig.cipher, () => now);
  const lease = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000020", now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const packageBytes = new TextEncoder().encode("snapshot extension fixture");
  const packageDigest = sha256HexBytes(packageBytes);
  await store.savePackage({ digest: packageDigest, bytes: packageBytes }, lease);
  const chat = await rig.chats.createChat({ title: "Checkpoint owner", cast: CAST, snapshot: SNAP });
  const branch = (await rig.chats.listBranches(chat.id))[0]!;
  const control: StoredExtensionControl = {
    id: "fixture.snapshot", revision: 0, packageDigest, policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [
      { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:connection"], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
      { operation: "state.write.apply", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
      { operation: "logs.write", resources: [], fields: ["logs"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
    ],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete",
  };
  expect(await store.compareAndSaveControl(control, -1, lease)).toBe("saved");
  expect(await store.compareAndSaveData(control.id, "prefs", { marker: "before" }, -1, lease)).toBe("saved");
  const logCommit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "logs.write", access: { resources: [], fields: ["logs"], methods: [], destinations: [] }, now: () => now };
  await store.appendLog(control.id, { id: "snapshot-log-before", createdAt: now, level: "info", message: "before snapshot" }, logCommit);

  const turnCommit = {
    owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "connection" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:connection"] }, now: () => now,
  };
  const checkpoint = await rig.chats.beginTurn(branch.id, { kind: "reply" }, { expectedVersion: branch.version }, turnCommit);
  if (!checkpoint) throw new Error("fixture checkpoint could not open");
  const stateCommit = { ...turnCommit, operation: "state.write.apply", access: {
    resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [],
  } };
  expect(await rig.chats.appendPendingExtensionDeltas(checkpoint.id, control.id, branch.version,
    [{ slot: "ext:fixture.snapshot:memory", path: ["saved"], value: true, at: now }], stateCommit)).toBe(true);
  const snapshot = await rig.snapshots.take();
  expect((await rig.chats.resumeIncomplete())[0]?.extensionOwner?.packageId).toBe(control.id);

  expect(await rig.chats.dropTurn(checkpoint.id, turnCommit)).toBe(true);
  expect(await store.compareAndSaveData(control.id, "prefs", { marker: "after" }, 0, lease)).toBe("saved");
  await store.appendLog(control.id, { id: "snapshot-log-after", createdAt: now + 1, level: "info", message: "after snapshot" }, { ...logCommit, now: () => now + 1 });
  expect(await store.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await rig.snapshots.restore(snapshot.id);

  expect(await store.readControl(control.id)).toMatchObject({ enabled: true, revision: 0, packageDigest });
  expect(await store.readPackage(packageDigest)).toEqual({ digest: packageDigest, bytes: packageBytes });
  expect(await store.readData(control.id, "prefs")).toEqual({ value: { marker: "before" }, revision: 0 });
  expect((await store.listLogs(control.id, null, 10)).records).toEqual([
    { id: "snapshot-log-before", createdAt: now, level: "info", message: "before snapshot" },
  ]);
  expect((await rig.chats.resumeIncomplete())[0]).toMatchObject({
    id: checkpoint.id, extensionOwner: { packageId: control.id, packageDigest, grantRevision: 1 },
    deltas: [{ slot: "ext:fixture.snapshot:memory", path: ["saved"], value: true }],
  });
});
