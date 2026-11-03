# Repo guardrails

Mechanical gates that stop common structural mistakes without making ordinary commits feel like a CI
run. They raise the floor on our standing doctrine; they do **not** make anyone infallible. A novel
logic bug nobody wrote a check for can still get through, so tests and honest verification remain part
of the work even though commit messages do not require special trailers.

## The gates

| Gate | Fires on | Blocks when | Cleared by |
| --- | --- | --- | --- |
| structural | pre-commit, Stop | the line cap, core purity/sibling, HTML sink, or shell import rules fail | fix the structural violation |
| staged-colors | pre-commit | staged UI additions contain hardcoded colors | use theme tokens |
| style | pre-commit | staged UI additions name a font or use a viewport width media query | theme font tokens; `@container` queries; `style-ok: <reason>` |
| clones | pre-commit | a staged function or CSS rule nearly copies one in another file and the pair is not in `clones-baseline.json` | call or extend the existing one; `clone-ok: <reason>`; `bun run clones:baseline` after a merge |
| component-catalog | relevant pre-commit changes | the generated component reference is stale | regenerate the catalog |
| code-map | pre-commit, when mapped source changes | the map cannot be written; otherwise it regenerates docs/generated/CODE-MAP.md from the staged files and stages it | fix the generator error |
| staged-ui-lint | pre-commit | staged live UI TSX has an ESLint error or warning | fix the staged files |
| green | pre-push, Stop | `bun run test` is red | fix the supported suite |
| typecheck | pre-push | `bun run typecheck` is red | fix the types |
| test sandbox | every `bun test` run (bunfig.toml preload) | inherited Git repository overrides, or writes into real user-data folders | use `bun run test` to clear hook Git context before Bun starts; keep fixture data temporary |

## Two surfaces

- **git** (`.githooks/`, wired via `git config core.hooksPath .githooks`): the commit/push backstop, for
  any committer. A fresh clone must run `git config core.hooksPath .githooks` once (or a setup script).
- **Editor hooks**: not committed. `gate.ts --worktree` is ready to run as an
  editor `Stop` gate, but wiring it is each contributor's choice. Blocking `--no-verify` and snapshotting
  work before destructive git commands live in the maintainer's own editor settings, not in this repo;
  AGENTS.md ("Agent traps") says how to recover from a snapshot.

## Layout (drop-in)

- `lib.ts` - the pure structural detectors (no fs, no git, no process). Unit-tested in `lib.test.ts`,
  which the supported suite runs so the guardrails cannot rot silently.
- `pre-commit-core.ts` - pure parsing and routing for staged paths, tested beside the implementation.
- `pre-commit.ts` - fast orchestration: structural and color checks every time, then catalog and UI
  lint only when the staged paths make them relevant.
- `gate.ts` - structural checks in `--staged` mode; structural checks plus `bun run test` in
  `--worktree` mode for the editor Stop gate.
- `stage-boundary-core.ts` - the pure D18 boundary rules (store backends stay dumb; nobody imports a
  backend except through its interface), tested beside it. `stage-boundary.ts` runs them over `src/`
  as `bun run scan:boundaries` in `verify:ci`.
- `glossary-core.ts` - the pure glossary rules (named paths exist; every `src/` folder is explained), tested beside
  it. `glossary.ts` runs them as `bun run glossary:check` in `verify:ci`.
- `.githooks/pre-push` - the full local proof: typecheck followed by the supported test suite.

Exit contract everywhere: **2** = policy violation, **1** = hook infrastructure failure, **0** = pass.
Git blocks every nonzero result; the distinct failure codes keep the diagnosis clear.

## Adding a gate

Add a pure detector to the relevant core module, test it beside that module, call it from the smallest
appropriate hook surface, and prove it blocks red-first before trusting it. Keep pre-commit checks
staged and fast; put whole-repository proof in pre-push or CI.
