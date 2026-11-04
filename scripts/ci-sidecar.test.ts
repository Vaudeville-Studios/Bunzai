/**
 * Regression coverage that the required CI status runs the sidecar security wall, and that the RELEASE
 * actually includes the matching helper inside its public app downloads.
 */
import { expect, test } from "bun:test";
import { SIDECAR_TARGETS } from "../sidecar/build-targets";
import { SIDECAR_PINS } from "../src/ui/remote/sidecar-pins";
import { APP_ASSET_NAMES } from "../src/packaged-app";

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

test("scale evidence builds the matching helper before compiling the app", async () => {
  const body = jobBlock(await Bun.file(workflowUrl).text(), "scale-evidence");
  expect(body).toContain("go-version-file: sidecar/go.mod");
  expect(body).toContain("cache-dependency-path: sidecar/go.sum");
  const helper = body.indexOf("bun sidecar/build.ts --target=windows-x64");
  expect(helper).toBeGreaterThanOrEqual(0);
  expect(helper).toBeLessThan(body.indexOf("bun run scripts/build-desktop.ts"));
});

test("the release builds helpers for its Windows and Linux targets", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const flag of ["windows-x64", "linux-x64"]) {
    expect(release).toContain(`bun sidecar/build.ts --target=${flag}`);
  }
  expect(release).not.toContain("--target=darwin-");
});

test("the normal release publishes one Windows app, one Linux app and their checksums", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  const publish = jobBlock(release, "publish");
  const assets = [...publish.matchAll(/dist\/([^\s\\]+)/g)].map((match) => match[1]);
  expect(assets).toEqual([APP_ASSET_NAMES.windows, APP_ASSET_NAMES.linux, "SHA256SUMS"]);
  expect(jobBlock(release, "build-windows")).not.toContain("scale:timed");
  expect(jobBlock(release, "build-linux")).toContain(`cp dist/bunzai-cli-linux-x64 dist/${APP_ASSET_NAMES.linux}`);
  expect(release).not.toContain("build-macos:");
  expect(publish).not.toContain("darwin-");
});

test("every job that builds a helper has the Go toolchain to build it with", async () => {
  const release = (await Bun.file(releaseUrl).text()).replace(/\r\n/g, "\n");
  for (const job of ["build-windows", "build-linux"]) {
    const body = jobBlock(release, job);
    expect(body).toContain("bun sidecar/build.ts --target=");
    expect(body).toMatch(/actions\/setup-go@v\d+/);
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

test("standalone app builds carry their matching helper and prepare it before serving", async () => {
  const build = await Bun.file(new URL("./build-desktop.ts", import.meta.url)).text();
  expect(build).toContain("bakeSidecar");
  for (const entry of ["desktop.ts", "cli.ts"]) {
    const code = await Bun.file(new URL(`../src/${entry}`, import.meta.url)).text();
    expect(code).toContain("prepareAppSidecar");
  }
});
