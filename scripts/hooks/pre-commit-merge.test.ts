/** Drives the real pre-commit hook in throwaway repos: a merge commit must keep both parents, and the
 *  docs index must come from the staged snapshot, never the working tree. */
import { afterAll, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL = join(import.meta.dir, "..", "..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const GENERATOR_STUB = String.raw`
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.DOCS_INDEX_ROOT ?? join(import.meta.dir, "..");
const docs = readdirSync(join(root, "docs")).filter((n) => n.endsWith(".md")).sort()
  .map((n) => ({ path: "docs/" + n, text: readFileSync(join(root, "docs", n), "utf8") }));
mkdirSync(join(root, "docs", "generated"), { recursive: true });
writeFileSync(join(root, "docs", "generated", "docs-index.json"), JSON.stringify(docs, null, 1) + "\n");
writeFileSync(join(root, "docs", "llms.txt"), docs.map((d) => d.path).join("\n") + "\n");
`;

function git(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? 1, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "hook-merge-"));
  made.push(dir);
  mkdirSync(join(dir, "scripts", "hooks"), { recursive: true });
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  for (const f of ["pre-commit.ts", "pre-commit-core.ts"]) {
    cpSync(join(REAL, "scripts", "hooks", f), join(dir, "scripts", "hooks", f));
  }
  cpSync(join(REAL, "scripts", "hooks", "file-selection.ts"), join(dir, "scripts", "hooks", "file-selection.ts"));
  cpSync(join(REAL, "scripts", "code-map-core.ts"), join(dir, "scripts", "code-map-core.ts"));
  for (const f of ["gate.ts", "no-hardcode-colors.ts", "style-guard.ts", "clones.ts", "unbounded-lists.ts"]) {
    writeFileSync(join(dir, "scripts", "hooks", f), "process.exit(0);\n");
  }
  writeFileSync(join(dir, "scripts", "docs-index.ts"), GENERATOR_STUB);
  const hook = join(dir, ".githooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexec bun run scripts/hooks/pre-commit.ts\n", { mode: 0o755 });
  chmodSync(hook, 0o755);
  git(dir, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", ".githooks"], ["core.autocrlf", "false"]]) {
    git(dir, "config", k!, v!);
  }
  return dir;
}

const commit = (dir: string, ...args: string[]) => git(dir, "commit", "-q", ...args);

test("a merge commit with an untracked file keeps both parents and its merge message", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "docs", "a.md"), "# A\n");
  git(dir, "add", "-A");
  expect(commit(dir, "--no-verify", "-m", "base").code).toBe(0);
  git(dir, "checkout", "-q", "-b", "side");
  writeFileSync(join(dir, "docs", "side.md"), "# Side\n");
  git(dir, "add", "-A");
  expect(commit(dir, "--no-verify", "-m", "side work").code).toBe(0);
  git(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "docs", "a.md"), "# A main\n");
  git(dir, "add", "-A");
  expect(commit(dir, "--no-verify", "-m", "main work").code).toBe(0);

  expect(git(dir, "merge", "--no-ff", "--no-commit", "side").code).toBe(0);
  writeFileSync(join(dir, "scratch-untracked.txt"), "not part of the merge\n");

  const result = commit(dir, "--no-edit");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(git(dir, "rev-list", "--parents", "-n", "1", "HEAD").out.split(" ")).toHaveLength(3);
  expect(git(dir, "log", "-1", "--format=%s").out).toContain("Merge branch 'side'");
  expect(readFileSync(join(dir, "scratch-untracked.txt"), "utf8")).toBe("not part of the merge\n");
  expect(git(dir, "stash", "list").out).toBe("");
});

test("the docs index is built from the staged snapshot, not unstaged working-tree edits", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "docs", "a.md"), "# A\n");
  writeFileSync(join(dir, "docs", "b.md"), "# B\n");
  git(dir, "add", "-A");
  expect(commit(dir, "--no-verify", "-m", "base").code).toBe(0);

  writeFileSync(join(dir, "docs", "a.md"), "# A staged\n");
  git(dir, "add", "docs/a.md");
  writeFileSync(join(dir, "docs", "b.md"), "# B UNSTAGED LEAK\n");
  writeFileSync(join(dir, "untracked.txt"), "keep me\n");

  expect(commit(dir, "-m", "stage a").code).toBe(0);
  const committed = git(dir, "show", "HEAD:docs/generated/docs-index.json").out;
  expect(committed).toContain("A staged");
  expect(committed).not.toContain("UNSTAGED LEAK");
  expect(readFileSync(join(dir, "docs", "b.md"), "utf8")).toBe("# B UNSTAGED LEAK\n");
  expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me\n");
  expect(git(dir, "stash", "list").out).toBe("");
  expect(git(dir, "diff", "--name-only", "docs/b.md").out).toBe("docs/b.md");
});

test("the real docs-index generator honors DOCS_INDEX_ROOT and leaves the repo docs alone", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-root-"));
  made.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "only-here.md"), "# Only here\n\nA page.\n");
  const before = readFileSync(join(REAL, "docs", "llms.txt"), "utf8");
  Bun.spawnSync(["bun", "run", "scripts/docs-index.ts"], {
    cwd: REAL,
    env: { ...process.env, DOCS_INDEX_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(readFileSync(join(root, "docs", "llms.txt"), "utf8")).toContain("only-here.md");
  expect(readFileSync(join(REAL, "docs", "llms.txt"), "utf8")).toBe(before);
});
