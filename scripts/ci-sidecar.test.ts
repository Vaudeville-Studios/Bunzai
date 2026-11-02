/**
 * Regression coverage that the required CI status runs the sidecar security wall, and that the RELEASE
 * actually ships the sidecar.
 *
 * The second half exists because it did not. CI vetted and built the helper on every push, which read as
 * "the sidecar is covered", while the release workflow published Bunzai.exe and command-line binaries but
 * no helper at all - so packaged remote access could never start, for anyone, and the only person who
 * never saw it was the developer with an untracked build product sitting in their own working tree.
 */
import { expect, test } from "bun:test";
import { SIDECAR_TARGETS } from "../sidecar/build-targets";
import { SIDECAR_PINS } from "../src/ui/remote/sidecar-pins";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
const releaseUrl = new URL("../.github/workflows/release.yml", import.meta.url);

const jobBlock = (workflow: string, name: string): string => {
  const normalized = workflow.replace(/\r\n/g, "\n");
  const marker = `\n  ${name}:\n`;
  const start = normalized.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const nextJob = normalized.slice(bodyStart).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob < 0
    ? normalized.slice(bodyStart)
    : normalized.slice(bodyStart, bodyStart + nextJob);
};

test("required test job vets, tests, and builds the sidecar", async () => {
  const workflow = await Bun.file(workflowUrl).text();
  const requiredJob = jobBlock(workflow, "test");

  expect(requiredJob).toMatch(/uses: actions\/setup-go@v\d+/);
  expect(requiredJob).toContain("go-version-file: sidecar/go.mod");
  expect(requiredJob).toContain("cache-dependency-path: sidecar/go.sum");
  expect(requiredJob).toContain("run: go vet -mod=readonly ./...");
  expect(requiredJob).toContain("run: go test -mod=readonly ./... -count=1");
  expect(requiredJob).toContain("run: go build -mod=readonly ./...");
  expect(requiredJob.match(/working-directory: sidecar/g)).toHaveLength(3);
});

test("the release builds helpers for its Windows and Linux targets", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const flag of ["windows-x64", "linux-x64", "linux-arm64"]) {
    expect(release).toContain(`bun sidecar/build.ts --target=${flag}`);
  }
  expect(release).not.toContain("--target=darwin-");
});

test("the release uploads only the seven Windows/Linux binaries plus their checksums", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  const publish = jobBlock(release, "publish");
  for (const asset of [
    "Bunzai.exe",
    "bunzai-cli-windows-x64.exe",
    "bunzai-cli-linux-x64",
    "bunzai-cli-linux-arm64",
    "sidecar-windows-x64.exe",
    "sidecar-linux-x64",
    "sidecar-linux-arm64",
    "SHA256SUMS",
  ]) {
    expect(publish).toContain(`dist/${asset}`);
  }
  expect(release).not.toContain("build-macos:");
  expect(publish).not.toContain("darwin-");
});

test("the release UPLOADS every helper it builds, so a pin can never point at a missing asset", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const key of ["win32-x64", "linux-x64", "linux-arm64"] as const) {
    const spec = SIDECAR_TARGETS[key];
    // Once in an upload-artifact path, once in the gh release asset list, once in the checksum line.
    expect(release.match(new RegExp(spec.asset.replace(/\./g, "\\."), "g"))?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
  }
  expect(release).not.toContain("sidecar-darwin-");
});

test("every job that builds a helper has the Go toolchain to build it with", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const job of ["build-windows", "build-linux"]) {
    const body = jobBlock(release, job);
    expect(body).toContain("bun sidecar/build.ts --target=");
    expect(body).toMatch(/actions\/setup-go@v\d+/);
  }
});

test("every PINNED platform has a published asset to download", async () => {
  // The pins are committed, so they can outlive the release they name or be edited by hand. A pin whose
  // asset the release workflow does not upload is a download button that refuses for everyone on that
  // platform, and nothing else would notice: the app reads the pin, not the workflow.
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const [key, pin] of Object.entries(SIDECAR_PINS)) {
    expect(Object.keys(SIDECAR_TARGETS)).toContain(key);
    expect(release).toContain(pin.asset);
  }
});

test("the pins are a COMMITTED constant, so source and packaged builds answer identically", async () => {
  // The whole point of the rewrite. While the hash was computed during the release build, only a CI-built
  // binary carried one: the download button existed for packaged users and silently did not from source.
  // Anything build-time creeping back into this module re-splits the product, and the split is invisible
  // from inside either half.
  const pins = await Bun.file(new URL("../src/ui/remote/sidecar-pins.ts", import.meta.url)).text();
  expect(pins).not.toContain("process.env");
  expect(pins).not.toContain("generated");
  expect(pins).toContain("export const SIDECAR_PINS");

  // And the build no longer writes pins at all.
  const build = await Bun.file(new URL("./build-desktop.ts", import.meta.url)).text();
  expect(build).not.toContain("sidecar-pins.ts\"), sidecarPinsModule");
  expect(build).not.toContain("RELEASE_TAG");
});

test("a committed pin is a full SHA-256 and names a real target asset", async () => {
  for (const [key, pin] of Object.entries(SIDECAR_PINS)) {
    const spec = SIDECAR_TARGETS[key as keyof typeof SIDECAR_TARGETS];
    expect(spec).toBeDefined();
    // The asset name has to match the target table, or the pin points at a file the release never makes.
    expect(pin.asset).toBe(spec!.asset);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.tag).toMatch(/^[A-Za-z0-9._-]+$/);
  }
});
