/** Playback is limited to audio referenced by an approved pack and host-owned action tickets. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { playbackOperations } from "./operations";

const principal = { storeId: "store", packageId: "demo.player", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (resources = [{ kind: "pack", id: "pack-1" }], fields = ["media"]): ExtensionOperationContext => ({ principal, signal: new AbortController().signal, resources, grantedOperations: [], availableGrants: [], operationReceipts: [], host: "desktop", availableOperations: [], access: { resources, fields, methods: [], destinations: [] }, commit: {}, confirm: async () => true } as unknown as ExtensionOperationContext);

test("playback play validates pack resource, audio mime and host action", async () => {
  const calls: unknown[] = [];
  const services = { assets: { list: async () => [{ sha: "b".repeat(64), mime: "audio/ogg", bytes: 8 }] }, hostActions: { request: async (ticket: unknown) => { calls.push(ticket); return { status: "completed" }; } } } as unknown as ExtensionOperationServices;
  const play = playbackOperations[1]!;
  await expect(play.execute({ packId: "pack-1", assetId: "b".repeat(64) }, context(), services)).resolves.toEqual({ completed: true });
  expect(calls).toMatchObject([{ action: "playback.play", packId: "pack-1", assetId: "b".repeat(64), principal: { packageId: principal.packageId } }]);
  await expect(play.execute({ packId: "other", assetId: "b".repeat(64) }, context(), services)).rejects.toThrow(/outside the approved/);
  const nonAudio = { ...services, assets: { list: async () => [{ sha: "b".repeat(64), mime: "image/png", bytes: 8 }] } } as unknown as ExtensionOperationServices;
  await expect(play.execute({ packId: "pack-1", assetId: "b".repeat(64) }, context(), nonAudio)).rejects.toThrow(/not referenced/);
});

test("playback status and controls use typed tickets; Browser remains unsupported", async () => {
  const calls: string[] = [];
  const services = { hostActions: { request: async (ticket: { action: string }) => { calls.push(ticket.action); return ticket.action === "playback.status" ? { status: "playback-state", playing: true, track: null } : { status: "completed" }; } } } as unknown as ExtensionOperationServices;
  await expect(playbackOperations[0]!.execute({}, context([], ["playback.status"]), services)).resolves.toEqual({ playing: true, track: null });
  await expect(playbackOperations[2]!.execute({}, context([], ["playback.control"]), services)).resolves.toEqual({ completed: true });
  await expect(playbackOperations[3]!.execute({}, context([], ["playback.control"]), services)).resolves.toEqual({ completed: true });
  expect(calls).toEqual(["playback.status", "playback.pause", "playback.stop"]);
  for (const operation of playbackOperations) expect(operation.metadata.hosts).toEqual(["desktop"]);
});

test("playback control receipts distinguish host completion from no effect", () => {
  const play = playbackOperations[1]!.metadata.receiptStatus;
  const pause = playbackOperations[2]!.metadata.receiptStatus;
  const stop = playbackOperations[3]!.metadata.receiptStatus;
  expect(play?.({ completed: true })).toBe("committed"); expect(play?.({ completed: false })).toBe("conflicted");
  expect(pause?.({ completed: true })).toBe("committed"); expect(pause?.({ completed: false })).toBe("conflicted");
  expect(stop?.({ completed: true })).toBe("committed"); expect(stop?.({ completed: false })).toBe("conflicted");
});
