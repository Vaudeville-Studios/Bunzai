/** Tests for the packaged-download guards: asset match to this binary, and the GitHub host allowlist. */
import { describe, expect, test } from "bun:test";
import { isAllowedDownloadHost, resolveAsset } from "./release-download";

const ASSETS = [
  "Bunzai.exe",
  "bunzai-cli-windows-x64.exe",
  "bunzai-cli-linux-x64",
  "bunzai-cli-darwin-arm64",
  "bunzai-cli-darwin-x64",
  "SHA256SUMS",
];

describe("resolveAsset", () => {
  test("Linux updates and rollback accept only the same-architecture old and new app names", () => {
    expect(resolveAsset(["Bunzai-Linux"], "bunzai-cli-linux-x64")).toBe("Bunzai-Linux");
    expect(resolveAsset(["bunzai-cli-linux-x64"], "Bunzai-Linux")).toBe("bunzai-cli-linux-x64");
    expect(resolveAsset(["Bunzai-Linux", "bunzai-cli-linux-x64"], "bunzai-cli-linux-x64")).toBe("bunzai-cli-linux-x64");
    expect(resolveAsset(["Bunzai-Linux"], "bunzai-cli-linux-arm64")).toBeNull();
    expect(resolveAsset(["Bunzai.exe"], "bunzai-cli-windows-x64.exe")).toBeNull();
  });
  test("matches the running binary exactly", () => {
    expect(resolveAsset(ASSETS, "Bunzai.exe")).toBe("Bunzai.exe");
    expect(resolveAsset(ASSETS, "bunzai-cli-linux-x64")).toBe("bunzai-cli-linux-x64");
  });
  test("fails closed when no asset matches (dev bun binary, or an arch with no build)", () => {
    expect(resolveAsset(ASSETS, "bun.exe")).toBeNull();
    expect(resolveAsset(ASSETS, "bunzai-windows-arm64.exe")).toBeNull();
    expect(resolveAsset([], "Bunzai.exe")).toBeNull();
  });
});

describe("isAllowedDownloadHost", () => {
  test("allows https GitHub release hosts (asset URL + redirect targets)", () => {
    expect(isAllowedDownloadHost("https://github.com/o/r/releases/download/v1/Bunzai.exe")).toBe(true);
    expect(isAllowedDownloadHost("https://objects.githubusercontent.com/x/y")).toBe(true);
    expect(isAllowedDownloadHost("https://release-assets.githubusercontent.com/z")).toBe(true);
  });
  test("denies non-https, non-GitHub, and garbage (SSRF + swap safety)", () => {
    expect(isAllowedDownloadHost("http://github.com/o/r")).toBe(false); // not https
    expect(isAllowedDownloadHost("https://evil.example/Bunzai.exe")).toBe(false);
    expect(isAllowedDownloadHost("https://github.com.evil.example/x")).toBe(false); // lookalike host
    expect(isAllowedDownloadHost("file:///etc/passwd")).toBe(false);
    expect(isAllowedDownloadHost("not a url")).toBe(false);
  });
});
