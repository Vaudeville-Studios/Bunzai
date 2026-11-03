/** A hook's inherited Git context cannot redirect throwaway test repositories into its caller. */
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the normal test launcher isolates inherited Git repository authority", () => {
  const root = mkdtempSync(join(tmpdir(), "git-preload-"));
  const sentinel = join(root, "sentinel");
  const fixture = join(root, "fixture");
  const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  try {
    mkdirSync(sentinel); mkdirSync(fixture);
    expect(git(sentinel, "init", "-q").exitCode).toBe(0);
    expect(git(sentinel, "config", "user.name", "sentinel").exitCode).toBe(0);
    expect(git(sentinel, "config", "user.email", "sentinel@example.test").exitCode).toBe(0);
    writeFileSync(join(sentinel, "keep"), "sentinel");
    expect(git(sentinel, "add", "keep").exitCode).toBe(0);
    expect(git(sentinel, "-c", "core.hooksPath=", "commit", "-qm", "sentinel").exitCode).toBe(0);
    const head = git(sentinel, "rev-parse", "HEAD").stdout.toString().trim();
    const metadata = ["HEAD", "index", "config"].map((name) => join(sentinel, ".git", name));
    const before = metadata.map((path) => readFileSync(path));
    const childTest = join(fixture, "isolation.test.ts");
    writeFileSync(childTest, `import { expect, test } from "bun:test";
test("fixture owns Git writes", () => {
  expect(process.env.GIT_DIR).toBeUndefined();
  expect(process.env.GIT_WORK_TREE).toBeUndefined();
  expect(process.env.GIT_INDEX_FILE).toBeUndefined();
  expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
  const git = (...args) => Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("config", "user.name", "fixture").exitCode).toBe(0);
  expect(git("config", "user.email", "fixture@example.test").exitCode).toBe(0);
  expect(git("add", "isolation.test.ts").exitCode).toBe(0);
  expect(git("-c", "core.hooksPath=", "commit", "-qm", "fixture").exitCode).toBe(0);
});`);
    const env = { ...process.env, GIT_DIR: join(sentinel, ".git"), GIT_WORK_TREE: sentinel,
      GIT_INDEX_FILE: join(sentinel, ".git", "index"), GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "false" };
    const options = { cwd: fixture, stdout: "pipe", stderr: "pipe", env } as const;
    const args = ["--preload", join(import.meta.dir, "test-sandbox.ts"), childTest];
    const unsafe = Bun.spawnSync([process.execPath, "test", ...args], options);
    expect(unsafe.exitCode).not.toBe(0);
    expect(unsafe.stderr.toString()).toContain("inherited Git context is unsafe");
    expect(metadata.map((path) => readFileSync(path))).toEqual(before);
    expect(git(sentinel, "rev-parse", "HEAD").stdout.toString().trim()).toBe(head);
    const child = Bun.spawnSync([process.execPath, "run", join(import.meta.dir, "test-run.ts"), ...args], options);
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    expect(metadata.map((path) => readFileSync(path))).toEqual(before);
    expect(git(sentinel, "rev-parse", "HEAD").stdout.toString().trim()).toBe(head);
    expect(child.exitCode).toBe(0);
    expect(git(fixture, "log", "-1", "--format=%s").stdout.toString().trim()).toBe("fixture");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
