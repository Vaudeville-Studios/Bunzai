/** The draft bus: caret inserts, draft inserts, and mentions queued until a composer registers (Ping with no composer open). */
import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { installDom, type InstalledDom } from "../../../_shared/test-dom";
import { insertAtCaret, insertIntoDraft, queueForDraft, registerDraftReplacer, registerInserter, replaceComposerDraft } from "./draft-bus";

let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8324/", extraGlobals: ["CustomEvent"] }); });
afterAll(async () => installed.teardown());

describe("insertAtCaret", () => {
  it("fills an empty draft", () => expect(insertAtCaret("", "@Vera", 0, 0)).toEqual({ text: "@Vera", caret: 5 }));
  it("appends after existing text with a space", () => expect(insertAtCaret("hello", "@Vera", 5, 5).text).toBe("hello @Vera"));
  it("inserts mid-text at the caret without losing either side", () => {
    const r = insertAtCaret("hi there", "@Vera", 2, 2);
    expect(r.text).toBe("hi @Vera there");
    expect(r.caret).toBe(8);
  });
  it("adds no extra space next to whitespace", () => expect(insertAtCaret("hi ", "@Vera", 3, 3).text).toBe("hi @Vera"));
  it("replaces only a selection", () => expect(insertAtCaret("a XX b", "@V", 2, 4).text).toBe("a @V b"));
  it("clamps an out of range caret to the end", () => expect(insertAtCaret("abc", "@V", 99, 99).text).toBe("abc @V"));
});

describe("insertIntoDraft", () => {
  it("reports false with no composer and never throws", () => expect(insertIntoDraft("none", "x")).toBe(false));
  it("hands the piece to the registered composer for that scene only", () => {
    const got: string[] = [];
    const off = registerInserter("c1", (p) => { got.push(p); return true; });
    expect(insertIntoDraft("c1", "@Vera")).toBe(true);
    expect(insertIntoDraft("c2", "@Vera")).toBe(false);
    off();
    expect(insertIntoDraft("c1", "@Vera")).toBe(false);
    expect(got).toEqual(["@Vera"]);
  });
});

describe("queueForDraft", () => {
  it("holds a piece until the scene's composer opens, then hands it over once and in order", () => {
    queueForDraft("q1", "@Vera");
    queueForDraft("q1", "@Atlas");
    queueForDraft("q2", "@Other");
    const got: string[] = [];
    const off = registerInserter("q1", (p) => { got.push(p); return true; });
    expect(got).toEqual(["@Vera", "@Atlas"]);
    off();
    const again: string[] = [];
    registerInserter("q1", (p) => { again.push(p); return true; })();
    expect(again).toEqual([]);
    const other: string[] = [];
    registerInserter("q2", (p) => { other.push(p); return true; })();
    expect(other).toEqual(["@Other"]);
  });
  it("keeps a piece the composer declined (steering) for the next one", () => {
    queueForDraft("q3", "@Vera");
    const off = registerInserter("q3", () => false);
    off();
    const got: string[] = [];
    registerInserter("q3", (p) => { got.push(p); return true; })();
    expect(got).toEqual(["@Vera"]);
  });
});

describe("replaceComposerDraft", () => {
  it("invokes the registered draft replacement callback once", async () => {
    const applied: string[] = [];
    const off = registerDraftReplacer("replace-1", (text) => { applied.push(text); return true; });
    await expect(replaceComposerDraft("replace-1", "reviewed replacement", 50)).resolves.toBe(true);
    expect(applied).toEqual(["reviewed replacement"]);
    off();
  });
  it("returns stale when no composer accepts the replacement", async () => {
    expect(await replaceComposerDraft("replace-missing", "not applied", 1)).toBe(false);
  });
});
