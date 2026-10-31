/** Each limits/digest/reference rule needs a copy it catches, the home it allows, and look-alikes it leaves alone. */
import { describe, expect, test } from "bun:test";
import {
  byteLimitLiteralOutsideHome,
  charsOverFourOutsideHome,
  imageLimitAliasOutsideHome,
  sceneSearchLimitsOutsideHome,
  mimeTableOutsideHome,
  sha256PatternOutsideHome,
  uploadedRefPatternOutsideHome,
} from "./single-source-limits";

describe("sha256PatternOutsideHome", () => {
  test("flags a written-out 64-hex pattern in any case spelling", () => {
    expect(sha256PatternOutsideHome("src/ui/a.ts", "const r = /^[a-f0-9]{64}$/;")).toContain("isSha256Hex");
    expect(sha256PatternOutsideHome("src/stage/a.ts", "/^[0-9a-f]{64}$/.test(x)")).toContain("isSha256Hex");
    expect(sha256PatternOutsideHome("src/ui/a.ts", "const m = /\\/api\\/asset\\/([a-f0-9]{64})$/.exec(p);")).toContain("assetRouteSha");
  });
  test("allows the home, tests, scripts, comments and other lengths", () => {
    expect(sha256PatternOutsideHome("src/core/sha256.ts", "const R = /^[0-9a-f]{64}$/;")).toBeNull();
    expect(sha256PatternOutsideHome("src/ui/a.test.ts", "/^[a-f0-9]{64}$/")).toBeNull();
    expect(sha256PatternOutsideHome("scripts/a.ts", "/^[a-f0-9]{64}$/")).toBeNull();
    expect(sha256PatternOutsideHome("src/ui/a.ts", "// /^[a-f0-9]{64}$/")).toBeNull();
    expect(sha256PatternOutsideHome("src/ui/a.ts", "/^[a-f0-9]{32}$/.test(x)")).toBeNull();
  });
  test("recognizes only catalog metadata generated from checked source schemas", () => {
    const generated = "/** Generated host-safe operation metadata. */\n{\"pattern\":\"^[a-f0-9]{64}$\"}";
    expect(sha256PatternOutsideHome("src/generated/extension-operation-metadata.ts", generated)).toBeNull();
    expect(sha256PatternOutsideHome("src/generated/extension-operation-metadata.ts", generated.replace("Generated host-safe", "Edited"))).toContain("isSha256Hex");
  });
});

describe("uploadedRefPatternOutsideHome", () => {
  test("flags a regex literal or RegExp string that parses the reference", () => {
    expect(uploadedRefPatternOutsideHome("src/ui/a.ts", "const m = /^\\u0000b:u:([^:]+):(.+)$/.exec(r);")).toContain("parseUploadedRef");
    expect(uploadedRefPatternOutsideHome("src/ui/a.ts", "const U = new RegExp(`^${String.fromCharCode(0)}b:u:([^:]+):x`);")).toContain("parseUploadedRef");
  });
  test("leaves a writer, the home and tests alone", () => {
    expect(uploadedRefPatternOutsideHome("src/ui/a.ts", "const ref = `\\u0000b:u:${mime}:${sha}`;")).toBeNull();
    expect(uploadedRefPatternOutsideHome("src/entities/piece-parts-blob.ts", "/^\\u0000b:u:(.+)$/")).toBeNull();
    expect(uploadedRefPatternOutsideHome("src/ui/a.test.ts", "/^\\u0000b:u:(.+)$/")).toBeNull();
  });
});

describe("byteLimitLiteralOutsideHome", () => {
  test("flags a 10, 32 or 128 MiB literal outside the homes", () => {
    expect(byteLimitLiteralOutsideHome("src/ui/a.ts", "const MAX = 32 * 1024 * 1024;")).toContain("ASSET_MAX_BYTES");
    expect(byteLimitLiteralOutsideHome("src/pocket/a.ts", "const B = 128*1024*1024")).toContain("limits");
    expect(byteLimitLiteralOutsideHome("src/stage/a.ts", "const P = 10 * 1024 * 1024;")).toContain("IMAGE_MAX_BYTES");
    expect(byteLimitLiteralOutsideHome("src/core/a.ts", "const P = 33_554_432;")).toContain("limits");
  });
  test("allows the homes, the reasoned exceptions, tests, other sizes and kilobyte math", () => {
    expect(byteLimitLiteralOutsideHome("src/core/media/limits.ts", "x = 32 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/sandbox/javascript/limits.ts", "x = 128 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/core/media/image-limit.ts", "x = 10 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/core/preset/render/runner.ts", "x = 32 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/ui/a.test.ts", "x = 32 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/ui/a.ts", "x = 64 * 1024 * 1024; y = 32 * 1024; z = 132 * 1024 * 1024")).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/ui/a.ts", "// 32 * 1024 * 1024")).toBeNull();
  });
  test("recognizes only catalog byte limits generated from checked source schemas", () => {
    const generated = "/** Generated host-safe operation metadata. */\n{\"maximum\":33554432}";
    expect(byteLimitLiteralOutsideHome("src/generated/extension-operation-metadata.ts", generated)).toBeNull();
    expect(byteLimitLiteralOutsideHome("src/generated/extension-operation-metadata.ts", generated.replace("Generated host-safe", "Edited"))).toContain("byte limit");
    expect(byteLimitLiteralOutsideHome("src/generated/other.ts", generated)).toContain("byte limit");
  });
});

describe("imageLimitAliasOutsideHome", () => {
  test("flags a second name for the picture limit", () => {
    expect(imageLimitAliasOutsideHome("src/ui/a.ts", "const MAX_IMAGE_BYTES = IMAGE_MAX_BYTES;")).toContain("IMAGE_MAX_BYTES");
    expect(imageLimitAliasOutsideHome("src/ui/a.ts", "export const PACK_PICTURE_MAX_BYTES = 5;")).toContain("image-limit");
  });
  test("allows the home, uses of the real name and unrelated names", () => {
    expect(imageLimitAliasOutsideHome("src/core/media/image-limit.ts", "export const IMAGE_MAX_BYTES = 1;")).toBeNull();
    expect(imageLimitAliasOutsideHome("src/ui/a.ts", "if (n > IMAGE_MAX_BYTES) fail();")).toBeNull();
    expect(imageLimitAliasOutsideHome("src/ui/a.ts", "const MAX_IMAGES = 4;")).toBeNull();
  });
});

describe("mimeTableOutsideHome", () => {
  test("flags an extension table in either direction", () => {
    expect(mimeTableOutsideHome("src/ui/a.ts", 'const T = { png: "image/png", jpg: "image/jpeg" };')).toContain("MIME_BY_EXT");
    expect(mimeTableOutsideHome("src/ui/a.ts", 'const T = { "image/png": "png", "image/gif": "gif" };')).toContain("extFromMime");
  });
  test("allows the home, the reasoned subsets, tests and lone uses", () => {
    expect(mimeTableOutsideHome("src/core/media/mime.ts", 'png: "image/png"')).toBeNull();
    expect(mimeTableOutsideHome("src/formats/_shared/assets.ts", 'png: "image/png"')).toBeNull();
    expect(mimeTableOutsideHome("src/ui/a.test.ts", 'png: "image/png"')).toBeNull();
    expect(mimeTableOutsideHome("src/ui/a.ts", 'const one = { mime: "image/png" };')).toBeNull();
    expect(mimeTableOutsideHome("src/ui/a.ts", 'accept="image/png,image/jpeg"')).toBeNull();
  });
});

describe("sceneSearchLimitsOutsideHome", () => {
  test("flags a declared search limit, allows the home, imports and look-alikes", () => {
    expect(sceneSearchLimitsOutsideHome("src/studio/x.ts", "export const SCENE_SEARCH_LIMIT = 200;")).toContain("search/contracts");
    expect(sceneSearchLimitsOutsideHome("src/core/x.ts", "const MIN_WORD = 2;")).toContain("search/contracts");
    expect(sceneSearchLimitsOutsideHome("src/stage/store/x.ts", "export const MAX_SEARCH_HITS = 200;")).toContain("search/contracts");
    expect(sceneSearchLimitsOutsideHome("src/core/search/contracts.ts", "export const MIN_WORD = 2;")).toBeNull();
    expect(sceneSearchLimitsOutsideHome("src/stage/store/x.ts", 'import { MAX_SEARCH_HITS } from "../../core/search/contracts";')).toBeNull();
    expect(sceneSearchLimitsOutsideHome("src/ui/x.ts", "const MAX_WORDS_SHOWN_X = 3; // const MIN_WORD = 2;")).toBeNull();
  });
});

describe("charsOverFourOutsideHome", () => {
  test("flags a hand-written chars/4, allows the home, macros, budget-parity, base64 math and tests", () => {
    expect(charsOverFourOutsideHome("src/ui/a.ts", "const t = Math.ceil(xml.length / 4);")).toContain("roughTokenCount");
    expect(charsOverFourOutsideHome("src/core/b.ts", "Math.round(block.content.length/4)")).toContain("roughTokenCount");
    expect(charsOverFourOutsideHome("src/stage/c.ts", "tokens: Math.round(writtenChars(body) / 4),")).toContain("roughTokenCount");
    expect(charsOverFourOutsideHome("src/core/tokens/estimate.ts", "Math.ceil(text.length / 4)")).toBeNull();
    expect(charsOverFourOutsideHome("src/core/macros/handlers/scene.ts", "Math.ceil(text.length / 4)")).toBeNull();
    expect(charsOverFourOutsideHome("src/core/assembly/budget-parity.ts", "Math.ceil(text.length / 4)")).toBeNull();
    expect(charsOverFourOutsideHome("src/core/media/pack-health.ts", "return Math.floor((b64.length * 3) / 4);")).toBeNull();
    expect(charsOverFourOutsideHome("src/studio/portrait.ts", "return value.length / 4 * 3 - padding;")).toBeNull();
    expect(charsOverFourOutsideHome("src/ui/a.test.ts", "Math.ceil(xml.length / 4)")).toBeNull();
    expect(charsOverFourOutsideHome("src/ui/agent/compaction-core.ts", "Math.ceil(text.length / CHARS_PER_TOKEN)")).toBeNull();
  });
});
