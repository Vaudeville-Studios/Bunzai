/** Extension follow-on reads resolve only lorebooks named by the broker access snapshot. */
import { expect, test } from "bun:test";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { compendiumRig } from "./fake-compendium-rig";
import { sceneBooks } from "./compendium-deps";
import type { BookStore } from "./world-book-writer";

test("a follow-on with one approved book reads no other lorebook", async () => {
  const fixture = await compendiumRig();
  const reads: string[] = [];
  const store: BookStore = {
    read: async (kind, id) => { reads.push(`${kind}:${id}`); return fixture.library.read(kind, id); },
    comparePatch: (...args) => fixture.library.comparePatch(...args),
  };
  const context: ExtensionCommitContext = {
    owner: "00000000-0000-4000-8000-000000000021", epoch: 1, packageId: "fixture.extension", packageDigest: "a".repeat(64),
    policyFingerprint: "b".repeat(64), grantRevision: 1, operation: "turns.start",
    access: { resources: [{ kind: "scene", id: fixture.chat.id }, { kind: "lorebook", id: "bk2" }], fields: ["compendium.receipts.write", "lorebook.entries.write"], methods: [], destinations: [] },
    now: () => 1_000,
  };
  const result = await sceneBooks({ ...fixture.deps, store, extensionCommit: context }, fixture.chat.id);
  expect(result?.books.map((book) => book.id)).toEqual(["bk2"]);
  expect(reads).toEqual(["lorebook:bk2"]);
});
