/**
 * The ChatStore contract suite's request half: the take's latest
 * committed reply's request text, written by `commitTurn` in the same transaction as the commit
 * itself, read back by `lastRequest`. Modeled on chat-store.contract-turns.ts's checkpoint and commit
 * tests. chatStoreContract runs it, so every implementation gets it.
 */
import { describe, expect, test } from "bun:test";
import { StudioConflictError, StudioValidationError } from "../../studio/errors";

import type { ChatStore } from "./chat-store";
import { chatRig } from "./chat-store.contract-rig";

export function chatStoreRequestContract(make: (clock: () => number) => ChatStore): void {
  const { seeded } = chatRig(make);

  describe("the take's latest request text (rule 22)", () => {
    test("a new take has none; a reply's commit saves it, naming that reply's own message and swipe", async () => {
      const { store, main } = await seeded(1);
      expect(await store.lastRequest(main)).toBeNull();
      const turn = await store.beginTurn(main, { kind: "reply" });
      const files = [{ message: 1, name: "brief.pdf", kind: "pdf" as const, owner: "Reference" }];
      const m = await store.commitTurn(turn!.id, { content: "r", request: { texts: ["block one", "block two"], files } });
      expect(await store.lastRequest(main)).toEqual({ messageId: m!.id, swipeId: m!.swipes[0]!.id, texts: ["block one", "block two"], files });
    });

    test("a swipe's commit names its own new swipe, not the message's first one", async () => {
      const { store, main, ids } = await seeded(2);
      const turn = await store.beginTurn(main, { kind: "swipe", messageId: ids[1]! });
      const m = await store.commitTurn(turn!.id, { content: "take two", request: { texts: ["x"] } });
      expect(m!.swipes[1]!.id).not.toBe(m!.swipes[0]!.id);
      expect(await store.lastRequest(main)).toEqual({ messageId: ids[1]!, swipeId: m!.swipes[1]!.id, texts: ["x"] });
    });

    test("the next commit with a request replaces it whole; one without leaves the previous as it is", async () => {
      const { store, main } = await seeded(1);
      const first = await store.beginTurn(main, { kind: "reply" });
      const m1 = await store.commitTurn(first!.id, { content: "one", request: { texts: ["a"] } });
      const second = await store.beginTurn(main, { kind: "reply" });
      await store.commitTurn(second!.id, { content: "two" });
      // The second commit named no request, so the branch still shows the first reply's.
      expect(await store.lastRequest(main)).toEqual({ messageId: m1!.id, swipeId: m1!.swipes[0]!.id, texts: ["a"] });
      const third = await store.beginTurn(main, { kind: "reply" });
      const m3 = await store.commitTurn(third!.id, { content: "three", request: { texts: ["c"] } });
      expect(await store.lastRequest(main)).toEqual({ messageId: m3!.id, swipeId: m3!.swipes[0]!.id, texts: ["c"] });
    });

    test("a stale commit changes nothing; an unguarded commit afterwards lands the request", async () => {
      const { store, main } = await seeded(1);
      const turn = await store.beginTurn(main, { kind: "reply" });
      const before = (await store.readMessages(main, { limit: 1 })).branchVersion!;
      await store.appendMessage(main, { role: "user", content: "edit race" });
      await expect(
        store.commitTurn(turn!.id, { content: "x", request: { texts: ["x"] } }, { expectedVersion: before }),
      ).rejects.toBeInstanceOf(StudioConflictError);
      expect(await store.lastRequest(main)).toBeNull();
      const m = await store.commitTurn(turn!.id, { content: "x", request: { texts: ["x"] } });
      expect(await store.lastRequest(main)).toEqual({ messageId: m!.id, swipeId: m!.swipes[0]!.id, texts: ["x"] });
    });

    test("a fork, or a cut restored as a new take, starts on a branch with none", async () => {
      const { store, main, ids } = await seeded(2);
      const turn = await store.beginTurn(main, { kind: "reply" });
      const m = await store.commitTurn(turn!.id, { content: "r", request: { texts: ["a"] } });
      const branch = await store.fork(main, m!.id);
      expect(await store.lastRequest(branch!.id)).toBeNull();
      expect(await store.lastRequest(main)).not.toBeNull();

      const cut = await store.cutMessages(main, ids[1]!, "from");
      await store.appendMessage(main, { role: "user", content: "after" });
      const back = await store.restoreCut(main, cut!.cutId);
      expect(back!.branchId).not.toBe(main);
      expect(await store.lastRequest(back!.branchId)).toBeNull();
    });

    test("absent or deleted branches answer null", async () => {
      const { store, main, chat, ids } = await seeded(2);
      const take = await store.fork(main, ids[1]!);
      await store.deleteBranch(take!.id);
      expect(await store.lastRequest("nope")).toBeNull();
      expect(await store.lastRequest(take!.id)).toBeNull();
      await store.deleteChat(chat.id);
      expect(await store.lastRequest(main)).toBeNull();
    });

    test("an empty texts list is stored as given", async () => {
      const { store, main } = await seeded(1);
      const turn = await store.beginTurn(main, { kind: "reply" });
      const m = await store.commitTurn(turn!.id, { content: "r", request: { texts: [] } });
      expect(await store.lastRequest(main)).toEqual({ messageId: m!.id, swipeId: m!.swipes[0]!.id, texts: [] });
    });

    test("anything but texts as an array of text is refused and changes nothing", async () => {
      const { store, main } = await seeded(1);
      const turn = await store.beginTurn(main, { kind: "reply" });
      const bads: unknown[] = [{ texts: "not an array" }, { texts: [1] }, { texts: null }, { texts: [null] }, { texts: [], extra: 1 }, { texts: ["x"], files: [{ message: 1, name: "x.pdf", kind: "pdf" }] }, { texts: ["x"], files: [{ message: 0, name: "../x.pdf", kind: "pdf" }] }, { texts: ["x"], files: [{ message: 0, name: "x.pdf", kind: "pdf", extra: true }] }, {}, "a", []];
      for (const bad of bads) {
        await expect(store.commitTurn(turn!.id, { content: "x", request: bad as never })).rejects.toBeInstanceOf(StudioValidationError);
      }
      expect(await store.lastRequest(main)).toBeNull();
      expect((await store.resumeIncomplete())[0]!.content).toBe("");
    });
  });
}
