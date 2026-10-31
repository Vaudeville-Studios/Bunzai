/**
 * The ContentStore contract suite. Every backend runs it through
 * createContentStore: the memory backend in phase 0, SQLite in phase 1, with this file unchanged.
 * Numbers in test names point at the spec's behavior list and edge cases.
 */
import { describe, expect, test } from "bun:test";
import { entityRevision } from "../../entities/canonical-revision";
import { parseCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError, StudioNotFoundError, StudioReadError, StudioValidationError } from "../../studio/errors";

import { createContentStore } from "../store/content-store";
import { buildPartText } from "../store/content-store-write";
import type { DocumentBackend, PartChange } from "./content-store";
import { contentStoreBlobsContract } from "./content-store-blobs.contract";
import { contentStoreConcurrencyContract } from "./content-store-concurrency.contract";
import { contentStorePartsContract } from "./content-store-parts.contract";
import { contentStorePatchContract } from "./content-store-patch.contract";
import { contentStorePatchLorebookContract } from "./content-store-patch-lorebook.contract";
import { character, plantLive, rigFor } from "./content-store.contract-fixtures";

/** Most of this suite is about row/version mechanics, never part content: an empty change is enough
 * wherever a test writes straight to the backend without caring what the piece assembles to. */
const noParts: PartChange = { put: [], drop: [] };

export function contentStoreContract(label: string, makeBackend: () => DocumentBackend): void {
  const rig = rigFor(makeBackend);

  describe(`ContentStore contract: ${label}`, () => {
    describe("carried over from StudioStore", () => {
      test("1. unparseable input throws and writes nothing, not even a version", async () => {
        const { store } = rig();
        await expect(store.create({ kind: "character" })).rejects.toBeInstanceOf(StudioValidationError);
        await expect(store.save("nonsense")).rejects.toBeInstanceOf(StudioValidationError);
        await expect(store.saveIfUnchanged(42, "x")).rejects.toBeInstanceOf(StudioValidationError);
        expect(await store.list()).toEqual([]);
      });

      test("2. an unsafe id or unknown kind is rejected, not rewritten", async () => {
        const { store } = rig();
        await expect(store.save(character("../escape"))).rejects.toBeInstanceOf(StudioValidationError);
        await expect(store.save({ ...character("ok"), kind: "spaceship" })).rejects.toBeInstanceOf(
          StudioValidationError,
        );
        expect(await store.list()).toEqual([]);
      });

      test("3. save keeps both on a taken id, and never replaces without overwrite", async () => {
        const { store } = rig();
        expect((await store.save(character("vera", "First"))).id).toBe("vera");
        expect((await store.save(character("vera", "Second"))).id).toBe("vera-2");
        expect((await store.save(character("vera", "Third"))).id).toBe("vera-3");
        expect((await store.read("character", "vera"))?.entity.body).toMatchObject({ identity: { name: "First" } });
        expect((await store.list("character")).map((s) => s.id).sort()).toEqual(["vera", "vera-2", "vera-3"]);
      });

      test("3. overwrite replaces in place and keeps the creation time", async () => {
        const { store, setNow } = rig();
        await store.save(character("vera", "First"));
        setNow(5_000);
        const after = await store.save(character("vera", "Renamed"), { overwrite: true });
        expect(after).toMatchObject({ id: "vera", name: "Renamed", version: 2, createdAt: 1_000, updatedAt: 5_000 });
      });

      test("4. create writes only when absent", async () => {
        const { store } = rig();
        expect((await store.create(character("vera"))).status).toBe("saved");
        expect(await store.create(character("vera", "Intruder"))).toEqual({ status: "exists" });
        expect((await store.read("character", "vera"))?.entity.body).toMatchObject({ identity: { name: "vera" } });
        expect((await store.versions("character", "vera")).versions).toHaveLength(1);
      });

      test("5. saveIfUnchanged writes on a matching revision and refuses a stale one", async () => {
        const { store } = rig();
        await store.save(character("vera"));
        const base = await store.read("character", "vera");
        const first = await store.saveIfUnchanged(character("vera", "Edit A"), base!.revision);
        expect(first.status).toBe("saved");
        expect(await store.saveIfUnchanged(character("vera", "Edit B"), base!.revision)).toEqual({ status: "stale" });
        expect((await store.read("character", "vera"))?.entity.body).toMatchObject({ identity: { name: "Edit A" } });
        expect(await store.saveIfUnchanged(character("ghost"), "anything")).toEqual({ status: "missing" });
      });

      test("6. damaged rows are reported by inventory, skipped by list, and raise their reason on read", async () => {
        const { store, backend } = rig();
        await store.save(character("fine"));
        // A single malformed "h" part: `character`-kind entities split no items, so "h" alone is the
        // whole stored body, the same way a whole `bodyJson` once was.
        const plant = (id: string, json: string, kind = "character") =>
          backend.write(
            { kind, id, revision: "r", version: 1, writeId: 1, autosaveStartedAt: null, createdAt: 1, updatedAt: 1 },
            { kind, id, version: 1, revision: "r", savedAt: 1, reason: "create", autosaveStartedAt: null },
            { when: "always" },
            null,
            { put: [buildPartText({ name: "h", json, blobs: [] })], drop: [] },
          );
        await plant("truncated", "{ not json");
        await plant("shapeless", JSON.stringify({ hello: "world" }));
        await plant("wrong-kind", JSON.stringify(character("wrong-kind")), "lorebook");
        await plant("wrong-id", JSON.stringify(character("someone-else")));

        const { entities, damaged } = await store.inventory();
        expect(entities.map((e) => e.id)).toEqual(["fine"]);
        const reasons = Object.fromEntries(damaged.map((d) => [d.id, d.reason]));
        expect(reasons).toEqual({
          truncated: "unreadable-json",
          shapeless: "schema-mismatch",
          "wrong-kind": "kind-mismatch",
          "wrong-id": "id-mismatch",
        });
        expect((await store.list()).map((e) => e.id)).toEqual(["fine"]);
        // The same reason the listing gives, never a quiet miss (spec edge case 8).
        const error = await store.read("character", "truncated").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(StudioReadError);
        expect((error as StudioReadError).reason).toBe("unreadable-json");
      });

      test("7. the revision is the studio's own content hash", async () => {
        const { store } = rig();
        const saved = await store.save(character("vera"));
        const expected = entityRevision(parseCanonicalEntity(character("vera")));
        expect(saved.revision).toBe(expected);
        expect((await store.read("character", "vera"))?.revision).toBe(expected);
      });
    });

    describe("version retention (edge case 9)", () => {
      const renamed = (n: number) => character("vera", `Vera ${n}`);

      test("keeps the last 25 versions by default", async () => {
        const { store } = rig();
        for (let n = 1; n <= 30; n++) await store.save(renamed(n), { overwrite: true });
        const kept = (await store.versions("character", "vera")).versions.map((v) => v.version);
        expect(kept).toEqual(Array.from({ length: 25 }, (_, i) => i + 6));
      });

      test("keeps a configured number, and a dropped version reads as absent", async () => {
        let now = 1_000;
        const store = createContentStore(makeBackend(), () => now++, { keepVersions: 3 });
        for (let n = 1; n <= 5; n++) await store.save(renamed(n), { overwrite: true });
        expect((await store.versions("character", "vera")).versions.map((v) => v.version)).toEqual([3, 4, 5]);
        expect(await store.readVersion("character", "vera", 1)).toBeNull();
        expect(await store.restoreVersion("character", "vera", 1)).toBeNull();
        expect((await store.read("character", "vera"))?.version).toBe(5);
      });

      test("a setting that is not a whole number of at least 1 is refused", () => {
        for (const keepVersions of [0, -1, 1.5, Number.NaN, 2 ** 63, "25" as never]) {
          expect(() => createContentStore(makeBackend(), () => 1, { keepVersions })).toThrow(StudioValidationError);
        }
      });

      test("the backend never drops the version the live row is at, whatever it keeps", async () => {
        const backend = makeBackend();
        await plantLive(backend, "vera");
        for (const version of [2, 3]) {
          await backend.write(
            { kind: "character", id: "vera", revision: "planted", version: 1, writeId: 1, autosaveStartedAt: null, createdAt: 1, updatedAt: 1 },
            { kind: "character", id: "vera", version, revision: `v${version}`, savedAt: version, reason: "save", autosaveStartedAt: null },
            { when: "always" },
            null,
            noParts,
          );
        }
        expect(await backend.pruneVersions("character", "vera", 1)).toBe(1);
        expect((await backend.versions("character", "vera")).rows.map((v) => v.version)).toEqual([1, 3]);
        expect(await backend.pruneVersions("character", "nobody", 1)).toBe(0);
      });
    });

    describe("added by D23", () => {
      test("8. each change appends a version; an unchanged write appends nothing and is reported", async () => {
        const reported: string[] = [];
        let now = 1_000;
        const store = createContentStore(makeBackend(), () => now++, {
          onUnchangedSave: (kind, id) => reported.push(`${kind}/${id}`),
        });
        await store.create(character("vera", "One"));
        await store.save(character("vera", "Two"), { overwrite: true });
        await store.save(character("vera", "Two"), { overwrite: true });
        const unchanged = await store.read("character", "vera");
        await store.saveIfUnchanged(character("vera", "Two"), unchanged!.revision);
        const { versions } = await store.versions("character", "vera");
        expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, "create"], [2, "save"]]);
        expect(reported).toEqual(["character/vera", "character/vera"]);
      });

      test("9. delete buries: gone from list and read, kept in the graveyard with its history", async () => {
        const { store, setNow } = rig();
        await store.save(character("vera"));
        await store.save(character("vera", "Later"), { overwrite: true });
        setNow(7_000);
        expect(await store.delete("character", "vera")).toBe(true);
        expect(await store.read("character", "vera")).toBeNull();
        expect(await store.list()).toEqual([]);
        const graves = await store.graveyard();
        expect(graves.map(({ id, kind, name, deletedAt }) => ({ id, kind, name, deletedAt }))).toEqual([
          { id: "vera", kind: "character", name: "Later", deletedAt: 7_000 },
        ]);
        expect(await store.delete("character", "vera")).toBe(false); // nothing live left to bury

        const back = await store.restore(graves[0]!.graveId);
        expect(back).toMatchObject({ id: "vera", name: "Later", version: 2 });
        expect(await store.graveyard()).toEqual([]);
        expect((await store.versions("character", "vera")).versions.map((v) => v.reason)).toEqual(["create", "save"]);
      });

      test("10. a deleted id is retired: nothing new takes it, and its grave always comes home", async () => {
        const { store } = rig();
        await store.save(character("vera", "Original"));
        await store.save(character("vera", "Edited"), { overwrite: true });
        await store.delete("character", "vera");
        expect(await store.create(character("vera", "Newcomer"))).toEqual({ status: "exists" });
        // The name is free, the id is not: a newcomer called the same saves beside it.
        expect(await store.save(character("vera", "Original"))).toMatchObject({ id: "vera-2", name: "Original" });
        const [grave] = await store.graveyard();
        expect(await store.restore(grave!.graveId)).toMatchObject({ id: "vera", name: "Edited", version: 2 });
        expect((await store.versions("character", "vera")).versions.map((v) => v.reason)).toEqual(["create", "save"]);
        expect(await store.graveyard()).toEqual([]);
      });

      test("10. an id stays retired after its grave is purged, so a reference to it never finds another piece", async () => {
        const { store, setNow } = rig();
        await store.save(character("vera"));
        setNow(100);
        await store.delete("character", "vera");
        expect(await store.purge(200)).toBe(1);
        expect(await store.create(character("vera"))).toEqual({ status: "exists" });
        expect(await store.save(character("VERA", "Newcomer"))).toMatchObject({ id: "VERA-2" });
        expect(await store.read("character", "vera")).toBeNull();
      });

      test("10. freeId never offers a live id or a retired one, in any spelling", async () => {
        const { store } = rig();
        expect(await store.freeId("character", "vera")).toBe("vera");
        await store.save(character("vera"));
        expect(await store.freeId("character", "VERA")).toBe("VERA-2");
        await store.save(character("vera-2"));
        await store.delete("character", "vera-2");
        expect(await store.freeId("character", "vera")).toBe("vera-3");
        await store.purge(Number.MAX_SAFE_INTEGER);
        expect(await store.freeId("character", "vera")).toBe("vera-3");
      });

      test("10. an id has one grave at a time: deleted, restored, and deleted again", async () => {
        const { store, setNow } = rig();
        await store.save(character("vera", "First"));
        setNow(2_000);
        await store.delete("character", "vera");
        const [first] = await store.graveyard();
        await store.restore(first!.graveId);
        await store.save(character("vera", "Second"), { overwrite: true });
        setNow(3_000);
        await store.delete("character", "vera");
        const graves = await store.graveyard();
        expect(graves.map((g) => g.name)).toEqual(["Second"]);
        expect(await store.restore(graves[0]!.graveId)).toMatchObject({ id: "vera", name: "Second", version: 2 });
      });

      test("11. purge removes only graves older than the cutoff, with their versions", async () => {
        const { store, setNow } = rig();
        await store.save(character("old"));
        await store.save(character("recent"));
        await store.save(character("alive"));
        setNow(100);
        await store.delete("character", "old");
        setNow(300);
        await store.delete("character", "recent");

        expect(await store.purge(200)).toBe(1);
        const [recentGrave] = await store.graveyard();
        expect(recentGrave?.id).toBe("recent");
        expect(await store.purge(200)).toBe(0);
        expect(await store.restore("no-such-grave")).toBeNull();

        expect(await store.purge(Number.MAX_SAFE_INTEGER)).toBe(1);
        expect((await store.list()).map((s) => s.id)).toEqual(["alive"]);
      });

      test("11. a malformed cutoff throws and purges nothing, since purge cannot be undone", async () => {
        const { store, setNow } = rig();
        await store.save(character("doomed"));
        setNow(100);
        await store.delete("character", "doomed");
        for (const before of [Number.NaN, undefined as never, Number.POSITIVE_INFINITY, "500" as never]) {
          await expect(store.purge(before)).rejects.toBeInstanceOf(StudioValidationError);
        }
        expect((await store.graveyard()).map((g) => g.id)).toEqual(["doomed"]);
      });

      test("12. restoreVersion writes an old body as a new version and rewrites nothing", async () => {
        const { store } = rig();
        await store.save(character("vera", "Original"));
        await store.save(character("vera", "Mistake"), { overwrite: true });
        const restored = await store.restoreVersion("character", "vera", 1);
        expect(restored).toMatchObject({ name: "Original", version: 3 });
        const { versions } = await store.versions("character", "vera");
        expect(versions.map((v) => [v.version, v.reason])).toEqual([[1, "create"], [2, "save"], [3, "restore"]]);
        expect((await store.readVersion("character", "vera", 2))?.body).toMatchObject({ identity: { name: "Mistake" } });
        expect((await store.readVersionHeld("character", "vera", 2))?.body).toMatchObject({ identity: { name: "Mistake" } });
      });

      test("12. restoring a version equal to the current body writes nothing", async () => {
        const { store } = rig();
        await store.save(character("vera", "Original"));
        await store.save(character("vera", "Mistake"), { overwrite: true });
        await store.restoreVersion("character", "vera", 1);
        const again = await store.restoreVersion("character", "vera", 1);
        expect(again).toMatchObject({ name: "Original", version: 3 });
        expect((await store.versions("character", "vera")).versions).toHaveLength(3);
      });
    });

    describe("edge cases", () => {
      test("e2. keep-both reaches exactly <id>-999, then gives up instead of looping", async () => {
        const { store, backend } = rig();
        await store.save(character("crowd"));
        for (let n = 2; n <= 998; n++) await plantLive(backend, `crowd-${n}`);
        expect((await store.save(character("crowd", "Last seat"))).id).toBe("crowd-999");
        await expect(store.save(character("crowd", "One too many"))).rejects.toBeInstanceOf(StudioValidationError);
      });

      test("e3. a keep-both id over the length limit fails the save instead of truncating", async () => {
        const { store } = rig();
        const long = "a".repeat(119);
        await store.save(character(long));
        await expect(store.save(character(long, "Second"))).rejects.toBeInstanceOf(StudioValidationError);
        expect(await store.list()).toHaveLength(1);
      });

      test("e4. a buried entity cannot be edited until restored", async () => {
        const { store } = rig();
        const saved = await store.save(character("vera"));
        await store.delete("character", "vera");
        expect(await store.saveIfUnchanged(character("vera", "Edit"), saved.revision)).toEqual({ status: "missing" });
      });

      test("e4. overwriting a deleted id is refused as not found, writes nothing, and leaves the grave untouched", async () => {
        const { store } = rig();
        await store.save(character("vera"));
        await store.delete("character", "vera");
        await expect(store.save(character("vera", "New"), { overwrite: true })).rejects.toBeInstanceOf(StudioNotFoundError);
        expect(await store.list()).toEqual([]);
        const graves = await store.graveyard();
        expect(graves.map((g) => g.name)).toEqual(["vera"]);
        expect(await store.restore(graves[0]!.graveId)).toMatchObject({ id: "vera", name: "vera" });
      });

      test("e5. absence is a value, never an exception", async () => {
        const { store } = rig();
        expect(await store.delete("character", "nobody")).toBe(false);
        expect(await store.restore("nobody")).toBeNull();
        expect((await store.versions("character", "nobody")).versions).toEqual([]);
        expect(await store.readVersion("character", "nobody", 1)).toBeNull();
        expect(await store.restoreVersion("character", "nobody", 1)).toBeNull();
      });

      test("e5. an invalid address is not absence: reads and deletes check it like writes do", async () => {
        const { store } = rig();
        await expect(store.read("character", "../escape")).rejects.toBeInstanceOf(StudioValidationError);
        await expect(store.versions("character", "../escape")).rejects.toBeInstanceOf(StudioValidationError);
        await expect(store.delete("spaceship" as never, "vera")).rejects.toBeInstanceOf(StudioValidationError);
      });

      test("e5. an id is found by the same normalised form it was saved under", async () => {
        const { store } = rig();
        await store.save(character("ｖｅｒａ")); // fullwidth "vera", NFKC-normalises to "vera"
        expect((await store.read("character", "ｖｅｒａ"))?.entity.id).toBe("vera");
        expect(await store.delete("character", "ｖｅｒａ")).toBe(true);
      });

      test("e5. an id is one spelling-insensitive name: Vera and vera are the same id", async () => {
        const { store } = rig();
        expect((await store.save(character("Vera"))).id).toBe("Vera");
        expect((await store.save(character("vera", "Twin"))).id).toBe("vera-2");
        expect((await store.read("character", "VERA"))?.entity.id).toBe("Vera");
        expect((await store.create(character("vERA"))).status).toBe("exists");
        expect(await store.delete("character", "vera")).toBe(true);
        expect(await store.read("character", "Vera")).toBeNull();
      });

      test("e6. restore needs a grave, and restoreVersion needs a live entity and a real version", async () => {
        const { store } = rig();
        await store.save(character("vera"));
        expect(await store.restore("vera")).toBeNull();
        expect(await store.restoreVersion("character", "vera", 9)).toBeNull();
        await store.delete("character", "vera");
        expect(await store.restoreVersion("character", "vera", 1)).toBeNull();
      });

      test("e12. an overwrite that loses five races in a row throws StudioConflictError and writes nothing", async () => {
        const inner = makeBackend();
        const seed = createContentStore(inner, () => 1_000);
        await seed.save(character("vera"));
        let lostWrites = 0;
        const alwaysLosing = new Proxy(inner, {
          get(target, prop, receiver) {
            const value: unknown = Reflect.get(target, prop, receiver);
            if (typeof value !== "function") return value;
            const fn = value as (...a: unknown[]) => Promise<unknown>;
            if (prop !== "write") return fn.bind(target);
            return (...args: unknown[]) => {
              const condition = args[2] as { when: string };
              if (condition.when === "absent" || condition.when === "always") return fn.apply(target, args);
              lostWrites += 1;
              return Promise.resolve(false);
            };
          },
        });
        const store = createContentStore(alwaysLosing, () => 2_000);
        await expect(store.save(character("vera", "Edit"), { overwrite: true })).rejects.toBeInstanceOf(
          StudioConflictError,
        );
        expect(lostWrites).toBe(5);
        expect((await seed.read("character", "vera"))?.entity.body).toMatchObject({ identity: { name: "vera" } });
        expect((await seed.versions("character", "vera")).versions).toHaveLength(1);
      });
    });

    contentStorePartsContract(rig, makeBackend);
    contentStoreConcurrencyContract(rig);
    contentStoreBlobsContract(rig);
    contentStorePatchContract(rig);
    contentStorePatchLorebookContract(rig);
  });
}
