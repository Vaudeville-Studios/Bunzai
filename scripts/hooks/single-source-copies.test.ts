/** Each value-helper copy rule needs a copy it catches, the home it allows, and look-alikes it leaves alone. */
import { describe, expect, test } from "bun:test";
import {
  boolOrCopyOutsideHome,
  cardArchiveBoundsOutsideHome,
  magicBytesOutsideHome,
  platformOwnsBodyOutsideHome,
  pluralCopyOutsideHome,
  recOrCopyOutsideHome,
  roleTableOutsideHome,
  slugCopyOutsideHome,
  strArrayCopyOutsideHome,
} from "./single-source-copies";
import { isRecordOutsideHome, sharedHomeDeclarationOutsideHome } from "./single-source-core";

describe("strArrayCopyOutsideHome", () => {
  const copy = 'const keys = Array.isArray(raw.keys) ? raw.keys.filter((k): k is string => typeof k === "string") : [];';
  test("flags the hand-written filter, with or without a [] / undefined tail", () => {
    expect(strArrayCopyOutsideHome("src/formats/a.ts", copy)).toContain("strArray");
    expect(strArrayCopyOutsideHome("src/formats/a.ts", copy.replace(": [];", ": undefined;"))).toContain("presentStrArray");
  });
  test("allows the home, other filters, and a comment", () => {
    expect(strArrayCopyOutsideHome("src/core/guards.ts", copy)).toBeNull();
    expect(strArrayCopyOutsideHome("src/formats/a.ts", "Array.isArray(a) ? b.filter((k): k is string => typeof k === \"string\") : []")).toBeNull();
    expect(strArrayCopyOutsideHome("src/formats/a.ts", 'Array.isArray(a) ? a.filter((k): k is string => typeof k === "string" && k !== "") : []')).toBeNull();
    expect(strArrayCopyOutsideHome("src/formats/a.ts", `// ${copy}`)).toBeNull();
  });
});

describe("recOrCopyOutsideHome", () => {
  test("flags the identifier ternary and nothing else", () => {
    expect(recOrCopyOutsideHome("src/ui/a.tsx", "const e = isRecord(entity) ? entity : {};")).toContain("recOr");
    expect(recOrCopyOutsideHome("src/core/guards.ts", "const e = isRecord(entity) ? entity : {};")).toBeNull();
    expect(recOrCopyOutsideHome("src/ui/a.tsx", "const e = isRecord(entity) ? entity : null;")).toBeNull();
    expect(recOrCopyOutsideHome("src/ui/a.tsx", "const e = isRecord(a) ? b : {};")).toBeNull();
  });
});

describe("boolOrCopyOutsideHome", () => {
  test("flags a (value, fallback) boolean reader under any name", () => {
    expect(boolOrCopyOutsideHome("src/formats/a.ts", 'const asBool = (v: unknown, fallback: boolean): boolean =>\n  typeof v === "boolean" ? v : fallback;')).toContain("boolOr");
    expect(boolOrCopyOutsideHome("src/formats/a.ts", 'export const parseBool = (value: unknown, d: boolean): boolean => (typeof value === "boolean" ? value : d);')).toContain("boolOr");
  });
  test("leaves the home and absent-stays-absent readers alone", () => {
    expect(boolOrCopyOutsideHome("src/core/guards.ts", 'const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);')).toBeNull();
    expect(boolOrCopyOutsideHome("src/formats/a.ts", 'const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);')).toBeNull();
  });
});

describe("isRecordOutsideHome: the truthiness-first spelling", () => {
  test("is now caught, including the multi-line form", () => {
    expect(isRecordOutsideHome("src/ui/a.tsx", 'const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});')).toContain("core/guards.ts");
    expect(isRecordOutsideHome("src/ui/a.tsx", '!!v &&\n    typeof v === "object" &&\n    !Array.isArray(v)')).toContain("core/guards.ts");
  });
  test("does not flag truthiness plus typeof without the array exclusion", () => {
    expect(isRecordOutsideHome("src/ui/a.tsx", 'if (json && typeof json === "object") return 1;')).toBeNull();
  });
  test("keeps the inline opaque-frame exact-key predicate distinct from isRecord", () => {
    const exactKeys = 'const exact=(object,keys)=>object&&typeof object===\'object\'&&!Array.isArray(object)&&Object.keys(object).sort().join(\',\')===keys;';
    expect(isRecordOutsideHome("src/sandbox/javascript/opaque-frame.ts", exactKeys)).toBeNull();
    expect(isRecordOutsideHome("src/sandbox/javascript/opaque-frame.ts", `${exactKeys} const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);`)).toContain("core/guards.ts");
  });
});

describe("magicBytesOutsideHome", () => {
  test("flags ZIP and PNG signatures in product code, hex or decimal", () => {
    expect(magicBytesOutsideHome("src/formats/a.ts", "b[0] === 0x50 && b[1] === 0x4b")).toContain("ZIP");
    expect(magicBytesOutsideHome("src/formats/a.ts", "const PK = [0x50, 0x4b, 0x03, 0x04];")).toContain("ZIP");
    expect(magicBytesOutsideHome("src/ui/a.ts", "startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])")).toContain("PNG");
    expect(magicBytesOutsideHome("src/ui/a.ts", "starts(bytes, 137, 80, 78, 71)")).toContain("PNG");
  });
  test("allows the home, tests, fixtures and unrelated bytes", () => {
    expect(magicBytesOutsideHome("src/core/bytes.ts", "[0x50, 0x4b]")).toBeNull();
    expect(magicBytesOutsideHome("src/core/bytes.test.ts", "[0x50, 0x4b]")).toBeNull();
    expect(magicBytesOutsideHome("src/formats/_fixtures/x/build.ts", "[0x89, 0x50, 0x4e, 0x47]")).toBeNull();
    expect(magicBytesOutsideHome("src/extensions/theme-mod-fixture.ts", "[137, 80, 78, 71]")).toBeNull();
    expect(magicBytesOutsideHome("scripts/make-icon.ts", "[137, 80, 78, 71]")).toBeNull();
    expect(magicBytesOutsideHome("src/kit/keystore/backends/identity-file.ts", "[0x89, 0x48, 0x4c, 0x4b]")).toBeNull();
    expect(magicBytesOutsideHome("src/ui/a.ts", "// 0x50 0x4b is PK")).toBeNull();
  });
});

describe("cardArchiveBoundsOutsideHome", () => {
  test("flags passing the card bounds to unzipBounded outside archive.ts", () => {
    const copy = "return unzipBounded(bytes, { bounds: CARD_ARCHIVE_BOUNDS, only });";
    expect(cardArchiveBoundsOutsideHome("src/formats/x/index.ts", copy)).toContain("unzipCard");
    expect(cardArchiveBoundsOutsideHome("src/core/archive.ts", copy)).toBeNull();
    expect(cardArchiveBoundsOutsideHome("src/core/archive.test.ts", copy)).toBeNull();
    expect(cardArchiveBoundsOutsideHome("src/formats/x/index.ts", "unzipBounded(bytes, { bounds: PACK_ARCHIVE_BOUNDS })")).toBeNull();
  });
});

describe("platformOwnsBodyOutsideHome", () => {
  const body = 'if (CORE.includes(key)) return true;\n  if (profile === "full") return true;\n  return (EXTRAS[profile] ?? []).includes(key);';
  test("flags a re-implemented ownership predicate", () => {
    expect(platformOwnsBodyOutsideHome("src/core/lore/platform-fields.ts", body)).toContain("makePlatformOwns");
    expect(platformOwnsBodyOutsideHome("src/core/write-for.ts", body)).toBeNull();
    expect(platformOwnsBodyOutsideHome("src/core/lore/platform-fields.ts", "export const platformOwnsField = makePlatformOwns(CORE, EXTRAS);")).toBeNull();
  });
});

describe("roleTableOutsideHome", () => {
  test("flags both the integer table and the by-name ternary", () => {
    expect(roleTableOutsideHome("src/formats/a.ts", 'const R = { 0: "system", 1: "user", 2: "assistant" };')).toContain("lore-enums");
    expect(roleTableOutsideHome("src/formats/a.ts", "const I = { system: 0, user: 1, assistant: 2 };")).toContain("lore-enums");
    expect(roleTableOutsideHome("src/formats/a.ts", 'v === "user" ? "user" : v === "assistant" ? "assistant" : "system"')).toContain("lore-enums");
    expect(roleTableOutsideHome("src/formats/_shared/lore-enums.ts", 'v === "user" ? "user" : v === "assistant" ? "assistant" : "system"')).toBeNull();
    expect(roleTableOutsideHome("src/core/assembly/conversation.ts", 'item.role === "assistant" ? "assistant" : "user"')).toBeNull();
  });
});

describe("single-home names added for this fold", () => {
  const home = (name: string): string => `export const ${name} = () => 1;`;
  test("a second declaration of any folded helper is flagged, the home is not", () => {
    for (const [name, where] of [
      ["strArray", "src/core/guards.ts"], ["presentStrArray", "src/core/guards.ts"], ["recOr", "src/core/guards.ts"],
      ["boolOr", "src/core/guards.ts"], ["isPlainObject", "src/core/guards.ts"], ["startsWith", "src/core/bytes.ts"],
      ["isZipBytes", "src/core/bytes.ts"], ["isPngBytes", "src/core/bytes.ts"], ["extensionOf", "src/core/media/mime.ts"],
      ["extOf", "src/core/media/mime.ts"], ["unzipCard", "src/core/archive.ts"], ["makePlatformOwns", "src/core/write-for.ts"],
    ] as const) {
      expect(sharedHomeDeclarationOutsideHome("src/ui/x.ts", home(name))).toContain(where);
      expect(sharedHomeDeclarationOutsideHome(where, home(name))).toBeNull();
    }
    expect(sharedHomeDeclarationOutsideHome("src/ui/x.ts", "const strArr = (v: unknown) => [];")).toContain("src/core/guards.ts");
    expect(sharedHomeDeclarationOutsideHome("src/ui/x.ts", "function safeUnzip(b: Uint8Array) {}")).toContain("src/core/archive.ts");
  });
});

describe("pluralCopyOutsideHome", () => {
  test("flags a function named plural or pluralize", () => {
    expect(pluralCopyOutsideHome("src/ui/a.ts", "const plural = (n: number, one: string): string => `${n} ${one}`;")).toContain("plural");
    expect(pluralCopyOutsideHome("src/ui/a.ts", "function pluralize(n: number, word: string): string { return word; }")).toContain("plural");
    expect(pluralCopyOutsideHome("src/ui/a.ts", "  const plural = function (n: number) { return ''; };")).toContain("plural");
  });
  test("leaves the home, plain variables named plural, and inline ternaries alone", () => {
    expect(pluralCopyOutsideHome("src/core/text.ts", "export const plural = (n: number, one: string) => one;")).toBeNull();
    expect(pluralCopyOutsideHome("src/ui/a.ts", "const plural = deckPlural.toLowerCase();")).toBeNull();
    expect(pluralCopyOutsideHome("src/ui/a.ts", 'const plural = ledger.sends === 1 ? "" : "s";')).toBeNull();
    expect(pluralCopyOutsideHome("src/ui/a.ts", "`${n} ${n === 1 ? 'message was' : 'messages were'}`")).toBeNull();
  });
});

describe("slugCopyOutsideHome", () => {
  test("flags the collapse-to-separator replace, for - and _", () => {
    expect(slugCopyOutsideHome("src/ui/a.ts", 'name.toLowerCase().replace(/[^a-z0-9]+/g, "-")')).toContain("asciiSlug");
    expect(slugCopyOutsideHome("src/ui/a.ts", "label.replace(/[^a-z0-9]+/g, '_')")).toContain("asciiSlug");
  });
  test("leaves the home and other alphabets alone", () => {
    expect(slugCopyOutsideHome("src/core/text.ts", 'text.replace(/[^a-z0-9]+/g, sep)')).toBeNull();
    expect(slugCopyOutsideHome("src/kit/mcp/external-tools.ts", 'raw.replace(/[^a-z0-9_]+/g, "_")')).toBeNull();
  });
});
