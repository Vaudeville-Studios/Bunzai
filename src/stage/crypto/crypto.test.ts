/**
 * The encryption core: the cell format, the data key and its wraps,
 * the password and the recovery words. Pure, so every rule is proven without a database.
 */
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  DamagedDataError,
  indexHash,
  makeWords,
  newDataKey,
  openCell,
  openWithPassword,
  openWithWords,
  sealCell,
  subkeys,
  WrongSecretError,
  wrapWithPassword,
  wrapWithWords,
  type PasswordWrap,
} from "./crypto";
import { fastPasswords } from "./fake-password-lock";

// Real Argon2id settings run here, about 2 s per password operation.
setDefaultTimeout(30_000);

const key = () => newDataKey();

describe("the cell format", () => {
  test("round-trips any text, including empty and non-Latin text", () => {
    const k = key();
    for (const text of ["", "hello", "Vera smiles. 雨の夜 \u{1F319}", "x".repeat(100_000)]) {
      expect(openCell(k, "swipes.content", sealCell(k, "swipes.content", text))).toBe(text);
    }
  });

  test("is versioned text, and the same text never encrypts the same way twice", () => {
    const k = key();
    const a = sealCell(k, "chats.title", "Night market");
    expect(a.startsWith("e1:")).toBe(true);
    expect(a).not.toContain("Night market");
    expect(sealCell(k, "chats.title", "Night market")).not.toBe(a);
  });

  test("a wrong key, a tampered byte, another column, or a foreign format all throw DamagedDataError naming the column", () => {
    const k = key();
    const cell = sealCell(k, "chats.title", "Night market");
    const raw = Buffer.from(cell.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    const cases: [Buffer, string, string][] = [
      [key(), "chats.title", cell],
      [k, "chats.title", `e1:${raw.toString("base64")}`],
      [k, "branches.name", cell],
      [k, "chats.title", "Night market"],
      [k, "chats.title", "e2:" + cell.slice(3)],
      [k, "chats.title", "e1:AAAA"],
    ];
    for (const [useKey, where, value] of cases) {
      try {
        openCell(useKey, where, value);
        throw new Error("expected DamagedDataError");
      } catch (error) {
        expect(error).toBeInstanceOf(DamagedDataError);
        expect((error as DamagedDataError).where).toBe(where);
      }
    }
  });
});

describe("the data key", () => {
  test("is 32 random bytes, and its subkeys are fixed per key and distinct", () => {
    const k = key();
    expect(k.length).toBe(32);
    expect(key().equals(k)).toBe(false);
    const a = subkeys(k);
    const b = subkeys(Buffer.from(k));
    expect(a.content.equals(b.content)).toBe(true);
    expect(a.content.equals(a.index)).toBe(false);
    expect(a.content.equals(k)).toBe(false);
  });

  test("index hashes find equal values without revealing them, and differ between libraries", () => {
    const k = subkeys(key()).index;
    expect(indexHash(k, "vera")).toBe(indexHash(k, "vera"));
    expect(indexHash(k, "vera")).not.toBe(indexHash(k, "mira"));
    expect(indexHash(k, "vera")).not.toContain("vera");
    expect(indexHash(subkeys(key()).index, "vera")).not.toBe(indexHash(k, "vera"));
  });
});

describe("the password wrap", () => {
  // One real wrap, made once: each costs about 2 s by design, and most tests only need a valid one.
  const k = key();
  let shared: PasswordWrap;
  beforeAll(async () => {
    shared = await wrapWithPassword(k, "correct horse");
  });

  test("the right password opens the data key; a wrong one throws WrongSecretError", async () => {
    expect((await openWithPassword(shared, "correct horse")).equals(k)).toBe(true);
    await expect(openWithPassword(shared, "correct hors")).rejects.toBeInstanceOf(WrongSecretError);
    expect(JSON.stringify(shared)).not.toContain(k.toString("base64"));
  });

  test("each wrap gets its own salt, so the same password never makes the same wrap", async () => {
    const again = await wrapWithPassword(k, "correct horse");
    expect(again.salt).not.toBe(shared.salt);
    expect(Buffer.from(again.salt, "base64")).toHaveLength(16);
  });

  test("uses Argon2id, and records its settings with the wrap", () => {
    expect(shared.kdf).toMatchObject({ name: "argon2id", m: 65536, t: 3, p: 1 });
  });

  test("any strength setting but the exact one Bunzai writes is damage, refused before any work", async () => {
    for (const kdf of [
      { ...shared.kdf, m: 2 ** 30 },
      { ...shared.kdf, m: 131_072 },
      { ...shared.kdf, t: 4 },
      { ...shared.kdf, m: 8 },
      { ...shared.kdf, name: "scrypt" },
      { ...shared.kdf, p: 2 },
    ]) {
      await expect(openWithPassword({ ...shared, kdf: kdf as never }, "correct horse")).rejects.toBeInstanceOf(DamagedDataError);
    }
  });

  test("a wrap made by the tests' fast stand-in is refused by the real lock, so it can never reach a library", async () => {
    const fast = await fastPasswords().wrap(k, "correct horse");
    await expect(openWithPassword(fast, "correct horse")).rejects.toBeInstanceOf(DamagedDataError);
  });

  test("the app is never frozen while a password is checked", async () => {
    let longest = 0;
    const began = performance.now();
    let last = began;
    const beat = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    await openWithPassword(shared, "correct horse");
    const checking = performance.now() - began;
    // Let one more beat land before stopping: a fully blocking check delays that beat, and the
    // delay is the freeze. Stopping at once would never measure it.
    await new Promise((r) => setTimeout(r, 30));
    clearInterval(beat);
    expect(longest).toBeLessThan(checking / 2);
  });

  test("an empty password is refused", async () => {
    await expect(wrapWithPassword(key(), "")).rejects.toThrow();
  });
});

describe("the recovery words", () => {
  test("are twelve standard words, new each time", () => {
    const words = makeWords();
    expect(words.split(" ")).toHaveLength(12);
    expect(makeWords()).not.toBe(words);
  });

  test("open the data key, forgiving case and spacing like RoleCall does", () => {
    const k = key();
    const words = makeWords();
    const wrap = wrapWithWords(k, words);
    expect(openWithWords(wrap, words).equals(k)).toBe(true);
    expect(openWithWords(wrap, `  ${words.toUpperCase().split(" ").join("   ")}\n`).equals(k)).toBe(true);
  });

  test("other valid words throw WrongSecretError; words that are not a valid phrase are refused", () => {
    const wrap = wrapWithWords(key(), makeWords());
    expect(() => openWithWords(wrap, makeWords())).toThrow(WrongSecretError);
    expect(() => openWithWords(wrap, "not a real recovery phrase at all okay")).toThrow(WrongSecretError);
    expect(() => wrapWithWords(key(), "too few words")).toThrow();
  });
});
