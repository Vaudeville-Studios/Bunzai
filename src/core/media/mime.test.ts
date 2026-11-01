/** MIME and extension helpers share one stable mapping across core and format adapters. */
import { describe, expect, test } from "bun:test";
import { extOf, extensionOf, extFromMime, IMAGE_EXTENSIONS, MIME_BY_EXT, mimeFromDataUri, mimeFromExt, mimeFromPath, mimeFromRef, rasterImageMimeFromBytes } from "./mime";

describe("extOf", () => {
  test("lowercases the extension and ignores a query string", () => {
    expect(extOf("portrait.PNG")).toBe("png");
    expect(extOf("https://x/y/pic.jpg?v=2")).toBe("jpg");
  });

  test("falls back when there is no dot - unlike a bare split('.').pop()", () => {
    expect(extOf("avatar")).toBe("");
    expect(extOf("avatar", "bin")).toBe("bin");
    // the bug this guards against: pop() on an un-split string returns the WHOLE string
    expect("avatar".split(".").pop()).toBe("avatar");
    expect(extOf("avatar")).not.toBe("avatar");
  });
});

describe("extensionOf (a file name) and extOf (a ref)", () => {
  test("only the last path segment can carry an extension", () => {
    expect(extensionOf("a.v2/file")).toBe("");
    expect(extensionOf("C:\\packs.d\\cover")).toBe("");
    expect(extensionOf("dir.png/readme")).toBe("");
    expect(extensionOf("dir.d/cover.PNG")).toBe("png");
  });

  test("a trailing dot is no extension, and neither is a hidden name (node's extname)", () => {
    expect(extensionOf("file.")).toBe("");
    expect(extensionOf(".png")).toBe("");
    expect(extensionOf("dir/.png")).toBe("");
    expect(extensionOf(".config.json")).toBe("json");
    expect(extensionOf("")).toBe("");
  });

  test("a URL whose host has dots but whose last segment has none takes the fallback", () => {
    expect(extOf("https://cdn.example.com/avatar", "bin")).toBe("bin");
    expect(extOf("https://cdn.example.com/avatar")).toBe("");
    expect(extOf("https://cdn.example.com/a.b/avatar", "bin")).toBe("bin");
    expect(extOf("https://cdn.example.com/a.b/avatar.webp?v=3", "bin")).toBe("webp");
  });
});

describe("mimeFromExt", () => {
  test("known extensions, case-insensitive", () => {
    expect(mimeFromExt("png")).toBe("image/png");
    expect(mimeFromExt("JPG")).toBe("image/jpeg");
    expect(mimeFromExt("webm")).toBe("video/webm");
    expect(mimeFromExt("avif")).toBe("image/avif");
    expect(mimeFromExt("bmp")).toBe("image/bmp");
  });

  test("the shared image catalog is derived from known image MIME mappings", () => {
    expect([...IMAGE_EXTENSIONS]).toEqual(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
  });

  test("unknown or non-string input is undefined, never a guess", () => {
    expect(mimeFromExt("bin")).toBeUndefined();
    expect(mimeFromExt(undefined)).toBeUndefined();
    expect(mimeFromExt(42)).toBeUndefined();
  });
});

describe("extFromMime", () => {
  test("uses explicit preferred extensions for known MIME types and aliases", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("audio/mpeg")).toBe("mp3");
    expect(extFromMime("application/octet-stream")).toBeUndefined();
  });
});

describe("mimeFromDataUri", () => {
  test("reads the stated type before the first ; or ,", () => {
    expect(mimeFromDataUri("data:image/png;base64,AAAA")).toBe("image/png");
    expect(mimeFromDataUri("data:text/plain,hello")).toBe("text/plain");
  });

  test("not a data URI -> undefined", () => {
    expect(mimeFromDataUri("https://x/y.png")).toBeUndefined();
  });
});

describe("mimeFromRef", () => {
  test("a data URI wins over any extension-looking suffix", () => {
    expect(mimeFromRef("data:image/webp;base64,AAAA")).toBe("image/webp");
  });

  test("otherwise falls back to the extension", () => {
    expect(mimeFromRef("https://x/sprite.gif?cache=1")).toBe("image/gif");
  });

  test("undefined when neither resolves", () => {
    expect(mimeFromRef("opaque-id-no-ext")).toBeUndefined();
  });
});

describe("mimeFromPath", () => {
  test("resolves the same as mimeFromRef when it can", () => {
    expect(mimeFromPath("sprite.png")).toBe("image/png");
  });

  test("falls back to the generic binary type instead of undefined", () => {
    expect(mimeFromPath("opaque-id-no-ext")).toBe("application/octet-stream");
  });
});

describe("the one media table covers everything a picture, clip, sound or font upload can be", () => {
  test("raster signature detection rejects MIME spoofing", () => {
    expect(rasterImageMimeFromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(rasterImageMimeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(rasterImageMimeFromBytes(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(rasterImageMimeFromBytes(new TextEncoder().encode("RIFF1234WEBP"))).toBe("image/webp");
    expect(rasterImageMimeFromBytes(new TextEncoder().encode("<svg/>"))).toBeUndefined();
  });

  test.each([
    ["m4a", "audio/mp4"], ["aac", "audio/aac"], ["flac", "audio/flac"], ["mov", "video/quicktime"], ["mkv", "video/x-matroska"],
    ["ttf", "font/ttf"], ["otf", "font/otf"], ["woff", "font/woff"], ["woff2", "font/woff2"], ["css", "text/css"],
  ])("%s is %s, both ways", (ext, mime) => {
    expect(mimeFromExt(ext)).toBe(mime);
    expect(extFromMime(mime)).toBe(ext);
    expect(MIME_BY_EXT[ext]).toBe(mime);
  });

  test("fonts, video, audio and css are not images, so the image set and the image size limit do not widen", () => {
    expect([...IMAGE_EXTENSIONS].sort()).toEqual(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
  });
});
