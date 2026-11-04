/** Fast pre-commit orchestration: keep the generated docs index and code map current, then the structural gate. */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  needsCodeMap,
  needsDocsIndex,
  parseNameStatusZ,
} from "./pre-commit-core";

const run = (name: string, command: string[]): number => {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  const code = result.exitCode ?? 1;
  if (code !== 0) console.error(`GUARDRAIL BLOCK (${name}): command exited ${code}.`);
  return code;
};

/**
 * Regenerate the docs index from the STAGED snapshot and stage it. A pre-commit generator must not
 * read the raw working tree: if a developer stages one doc while leaving an edit to another unstaged,
 * a working-tree read folds the unstaged edit into the committed index, so docs:index:check goes
 * stale in CI right after the commit. We export the staged docs/ tree into a temp directory
 * (`git checkout-index`), point the generator at it, and copy the two staged outputs back. Nothing
 * here stashes, resets, or rewrites the working tree, so MERGE_HEAD, MERGE_MSG, untracked files and
 * unstaged edits are never at risk (a stash during a merge commit silently dropped the merge).
 */
function regenDocsIndexFromStagedSnapshot(): number {
  const snapshot = mkdtempSync(join(tmpdir(), "pre-commit-docs-"));
  try {
    const listed = Bun.spawnSync(["git", "ls-files", "-z", "--", "docs"], { stdout: "pipe", stderr: "inherit" });
    const exported = (listed.exitCode ?? 1) === 0
      ? Bun.spawnSync(["git", "checkout-index", "-z", "--stdin", `--prefix=${snapshot.split("\\").join("/")}/`], {
        stdin: listed.stdout,
        stdout: "inherit",
        stderr: "inherit",
      })
      : listed;
    if ((exported.exitCode ?? 1) !== 0) {
      console.error("GUARDRAIL BLOCK (docs-index-snapshot): could not export the staged docs snapshot.");
      return 1;
    }
    const gen = Bun.spawnSync(["bun", "run", "scripts/docs-index.ts"], {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, DOCS_INDEX_ROOT: snapshot },
    });
    if ((gen.exitCode ?? 1) !== 0) {
      console.error(`GUARDRAIL BLOCK (docs-index-regen): command exited ${gen.exitCode ?? 1}.`);
      return 1;
    }
    for (const out of ["docs/generated/docs-index.json", "docs/llms.txt"]) {
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(join(snapshot, out), out);
    }
    const add = Bun.spawnSync(["git", "add", "docs/generated/docs-index.json", "docs/llms.txt"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((add.exitCode ?? 1) !== 0) {
      console.error("GUARDRAIL BLOCK (docs-index-stage): could not stage the regenerated docs index.");
      return 1;
    }
    return 0;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function main(): number {
  const diff = Bun.spawnSync(
    ["git", "diff", "--cached", "--name-status", "-z", "--diff-filter=ACMRD"],
    { stdout: "pipe", stderr: "inherit" },
  );
  if ((diff.exitCode ?? 1) !== 0) {
    console.error("GUARDRAIL BLOCK (staged-paths): could not read the staged Git diff.");
    return diff.exitCode ?? 1;
  }
  const paths = parseNameStatusZ(new TextDecoder().decode(diff.stdout));

  // Auto-regenerate the docs index (from the staged snapshot) when docs change and stage it, so a
  // forgotten manual regen can never fail docs:index:check in verify:ci. A no-op when already current.
  if (needsDocsIndex(paths)) {
    const code = regenDocsIndexFromStagedSnapshot();
    if (code !== 0) return code;
  }
  // The code map reads git's staged snapshot itself, so it needs no stash, and stages its own output.
  if (needsCodeMap(paths)) {
    const code = run("code-map", ["bun", "run", "scripts/code-map.ts", "--staged"]);
    if (code !== 0) return code;
  }

  // Style, color, clone, list, catalog and lint checks live in the owner harness (verify:ci), not here.
  return run("structural", ["bun", "run", "scripts/hooks/gate.ts", "--staged"]);
}

process.exit(main());
