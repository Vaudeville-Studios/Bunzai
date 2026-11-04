# AGENTS.md

Instructions for AI agents (and new humans) working in this repo. Read this whole file before
writing any code.

## 1. Read first, in this order

| # | File | Why it's required |
| --- | --- | --- |
| 1 | [docs/01-VISION.md](docs/01-VISION.md) | What this product is and is not |
| 2 | [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | The canonical model and how adapters hang off it |
| 3 | [docs/03-CONVENTIONS.md](docs/03-CONVENTIONS.md) | Code style and the rules the hooks enforce |
| 4 | [CONTRIBUTING.md](CONTRIBUTING.md) | Ground rules, including AI-model disclosure on PRs |
| 5 | [docs/reference/components.md](docs/reference/components.md) | **Before building ANY UI control.** If a control exists, you reuse it |
| 6 | [docs/reference/ui.md](docs/reference/ui.md) | Every studio surface, documented truthfully |
| 7 | [docs/reference/architecture.md](docs/reference/architecture.md) | The reference map of the source tree |
| 8 | [docs/reference/glossary.md](docs/reference/glossary.md) | Words that mean something particular here, their traps, and which folder owns each. To find a file, search [docs/generated/CODE-MAP.md](docs/generated/CODE-MAP.md): every source file with its one-line purpose |
| 9 | [docs/decisions/](docs/decisions/ADR-001-runtime.md) | Every accepted ADR under `docs/decisions/`: consequential choices and their reasoning. If you disagree with one, raise it in an issue rather than coding around it |

## 2. Contracts: which pages govern your work

The reference pages under `docs/reference/` are the contract for each area, and
[docs/FORMAT-SUPPORT.md](docs/FORMAT-SUPPORT.md) lists what each format supports. Match your task to
its pages before starting; they answer most design questions so you don't have to guess.

| If you're touching... | Read these pages |
| --- | --- |
| Any format adapter | [canonical-model](docs/reference/concepts/canonical-model.md), [detection](docs/reference/concepts/detection.md), [escrow-and-roundtrip](docs/reference/concepts/escrow-and-roundtrip.md), plus the format's own page under [docs/reference/formats/](docs/reference/formats/README.md) |
| SillyTavern / CCv2 / CCv3 cards | [sillytavern](docs/reference/formats/sillytavern.md), [character](docs/reference/entities/character.md) |
| Lorebooks / world info | [lorebook](docs/reference/entities/lorebook.md), [character-book](docs/reference/concepts/character-book.md) |
| Presets | [preset](docs/reference/entities/preset.md), [promptformat](docs/reference/entities/promptformat.md) |
| Personas | [persona](docs/reference/entities/persona.md), [persona-editor](docs/reference/concepts/persona-editor.md) |
| Regex sets | [regex](docs/reference/entities/regex.md), [regex-engine](docs/reference/concepts/regex-engine.md) |
| RoleCall, Backyard, Lumiverse, Marinara, Risu, Agnai, NovelAI, Pygmalion | the platform's page under [docs/reference/formats/](docs/reference/formats/README.md) |
| Import of multi-piece files | [bundles](docs/reference/concepts/bundles.md) |
| Macros | [macro-engine](docs/reference/macro-engine.md) |
| Token estimates | [token-meter](docs/reference/token-meter.md) |
| Prompt assembly and the studio surfaces | [architecture](docs/reference/architecture.md), [ui](docs/reference/ui.md) |

Working on a format adapter? Also read [docs/FORMAT-SUPPORT.md](docs/FORMAT-SUPPORT.md), the
relevant page under [docs/reference/formats/](docs/reference/formats/README.md), and start from
`src/formats/_template/`.

## 3. Project rules

These apply to every change. Work that breaks one will be sent back, so read them before
starting.

1. **Hub and spoke only.** Every format maps to and from the canonical model
   (`src/core/canonical.ts`). Never write a format-to-format conversion.
2. **Never modify escrowed originals.** The parsed source snapshot and unmapped source fields are
   stored inside the saved piece. Code must not drop, rewrite, or reformat that escrow. Same-format
   round trips satisfy the semantic Round-Trip Law; byte identity is required only where the format
   spec explicitly declares a byte-level tier and fixtures prove it.
3. **Imported scripts stay sealed.** Lua and regex payloads are data at every import and conversion boundary. Imported
   scripts run only when the person invokes them, and only inside their sandbox worker, on the isolated sandbox origin
   described by [ADR-009](docs/decisions/ADR-009-sandbox-origin.md): Lua in wasmoon, regex in a terminable worker. That worker
   serves the Lua and regex test benches and a scene's regex sets the person has switched on for that scene (switching a set on
   is the invocation; a set is never run because it was imported). The Kit agent's regex tools run only the agent's own draft
   rules, never an imported script. Nothing outside the worker compiles or
   executes a sealed script, the Bun process included: a scene's turn holds its request and waits for the page's answer, and a
   worker that cannot run fails closed (a prompt pass ends the turn before anything is sent, a display pass shows the message as
   written). Do not add another execution path for sealed scripts. Macro templates are governed separately by
   [ADR-012](docs/decisions/ADR-012-macro-evaluation-boundary.md): a closed-world, in-process
   interpreter under `src/core/macros/` may evaluate them, bounded and data-only, reachable only
   from the macro test bench, the transfer report, prompt assembly, chat display, and the
   user-invoked extension `macros.preview` operation accepted by ADR-015. That operation requires a
   manifest-declared command, fresh host confirmation, bounded value-only context, read-only mode,
   and regex disabled; it evaluates only after confirmation. Event, prompt-hook, background,
   scheduled, import, save, and codec paths never evaluate; macro text stays opaque payload at every
   import and conversion boundary.
4. **Folders are the schema.** Apps, format adapters, settings sections, deck views, wizard
   steps, and tours are drop-in folders. Never register anything in a central list when a
   drop-in folder is possible.
5. **No hardcoded colors.** Every color comes from `src/ui/theme/tokens.css`. A genuine one-off
   needs a `hardcode-ok` comment on the same line. The guard blocks everything else.
6. **500 lines per file, maximum.** Split by concept, don't grandfather. The guard blocks it.
7. **One concept per file; shared logic extracted exactly once** (into `_shared/`). Duplication
   is a bug.
8. **Fail closed.** Untrusted input is parsed once into a known type; anything unreadable is
   rejected at the boundary. Detectors return empty on bad input instead of throwing.
9. **Docs move with the code.** A change to any surface updates its page under
   `docs/reference/` in the same commit, truth-based, never aspirational.
10. **Changes carry proof.** Bug fixes and features include tests or documented verification in the
    PR or handoff. Commit messages need no special trailer. Don't bypass hooks.
11. **UI collapse is container-based.** Panels adapt via `@container` queries on the pane they
    live in, never viewport media queries.
12. **Every token of code costs money.** Write the fewest lines that do the job correctly and stay
    readable. No abstraction, option, wrapper, helper, or comment without a present need; no
    speculative extensibility; no parallel copy of logic that already exists. If the same behavior
    fits in fewer lines with no loss of correctness, clarity, or tests, the longer version is a
    defect. Long lists go through `useVirtualRows` (`src/ui/_shared/virtual-list`), never a bare `.map` over every row.
13. **One button family.** Every clickable thing is a named part of `src/ui/components/button`
    (Button, IconButton, Segmented, Tabs, DocTab, Chip, ListRow, MenuItem, Disclosure, Tile, Card,
    Dot, Toggle, InlineValue, Scrim). Rooms never style a button. Lint blocks a raw `<button>`.
14. **Fonts come from the theme.** Use `--font-fancy`, `--font-body` and `--font-mono`, never a font
    name. The style guard blocks named fonts and viewport width media queries in new lines.
15. **No copy-paste-and-tweak.** The clone guard blocks a new function or CSS rule that nearly copies
    one in another file. Call or extend the existing one; a genuine twin carries a
    `clone-ok: <reason>` comment.

## 4. Gates: run before you claim anything is done

```bash
bun run verify:ci     # the complete Bun/TypeScript wall: everything below, in order
bun run verify:release  # the short smoke gate a release runs before publishing
```

Or individually while iterating:

| Command | What it checks |
| --- | --- |
| `bun run typecheck` | tsc, strict, no emit |
| `bun run test` | ~2,000 tests: engine, codecs, round-trip law, store, server, UI cores |
| `bun run test:node-core` | bundle the public core and execute its smoke test in Node |
| `bun run probe:sqlite` | the SQLite features the data model needs are present in this runtime |
| `bun run perf:check` | the speed budget: no everyday action freezes the app for more than 100 ms, on a realistic encrypted library |
| `bun run scan:lines` | 500-line file cap |
| `bun run scan:colors:check` | no hardcoded colors outside the token sheet |
| `bun run scan:style` | named fonts and viewport width media queries (report; pre-commit blocks new ones) |
| `bun run scan:clones` | near-duplicate functions and CSS rules outside the baseline (report; pre-commit blocks new ones) |
| `bun run scan:lists` | JSX lists that render every row without `useVirtualRows` outside the baseline (report; pre-commit blocks new ones; `bounded-ok: <reason>` exempts a short list) |
| `bun run scan:emdash` | no em dashes in prose |
| `bun run scan:headers` | every authored TS/TSX file opens with a purpose docblock |
| `bun run scan:emoji` | no emoji pictographs in authored TS/TSX code |
| `bun run scan:links` | no dead markdown links |
| `bun run scan:boundaries` | D18: store backends import no engine, entity, or format code, nothing imports a backend except through its interface, and test stand-ins (`fake-*.ts`) are imported only by tests |
| `bun run lint:ui` | eslint on all authored Studio and Kit TS/TSX, zero warnings |
| `bun run catalog:check` | docs/reference/components.md matches the component folders |
| `bun run codemap:check` | docs/generated/CODE-MAP.md matches every source file's opening comment (the commit hook regenerates it from staged files) |
| `bun run glossary:check` | every path docs/reference/glossary.md names exists, and every folder under `src/` is explained there |
| `bun run matrix:check` | docs/FORMAT-SUPPORT.md matches the live format registry |
| `bun run license:audit` | no copyleft/restricted dependencies |

Pre-commit regenerates the docs index and code map and runs the structural gate. Pre-push and the
release run only the smoke gate, `verify:release`. `verify:ci` is the owner harness.
CI on push stays authoritative: its required `test` check runs `verify:ci` and independently vets, tests,
and builds the Go sidecar with the version pinned in `sidecar/go.mod`. The Go gate stays outside
`verify:ci` so contributors working outside the remote-access sidecar do not need a Go toolchain.

CI also runs a `packaged-sqlite` matrix that compiles the probe and executes the resulting binary on
Linux x64 and arm64, Windows, and macOS on both architectures. `bun:sqlite` is a runtime built-in, so
a pass under `bun run` proves nothing about the single-file binary users receive. Only the matrix does.

If a gate fails, fix the cause. Don't modify the gate.

## 5. Verification standard

- Red test first, then green: a bug fix starts with a test that fails without it.
- UI work gets verified live in the running studio (`bun run dev`, loopback), not by reading the
  code and hoping. Server-side changes need the dev server restarted before checking.
- Claims about behavior are labeled honestly: code-read, unit-proven, or live-proven. Only the
  last one counts as done for user-facing behavior.

## 6. Working method

1. Inspect the current implementation, callers, tests, release configuration, documentation, and Git
   state before editing. Name the authority and user-visible outcome.
2. For a bug or known contract, capture an honest failing test at the nearest public boundary before
   fixing it. For novel design, a bounded spike may come first, but contract proof is required before
   completion.
3. Fix the owning boundary. Do not add a parallel schema, registry, state authority, or compatibility
   path merely to avoid changing the real owner.
4. When docs and code disagree, classify the claim as `IMPLEMENT`, `REWRITE`, `DELETE`, or `RETAIN`.
   Specifications are planned until implementation evidence exists.
5. A substantial or high-risk change gets an independent adversarial review. Authors do not approve
   their own semantic summaries, security claims, migrations, or release evidence.
6. Warnings, skipped checks, and source-only proof are reported honestly. They are not clean,
   live-proven, or packaged-artifact-proven.
7. Commit, push, merge, release, deploy, migrate, and external messages require explicit authorization
   for that action and destination.

## 7. Agent traps

Each of these is a mistake an agent actually made in this repo.

- **"Done" means proven.** Label the proof (section 5). A present-tense claim in a spec or doc needs
  code, a test, or the shipped artifact behind it. CI runs only on Mainstage, so work on another
  branch is "proven when merged", not "proven by CI".
- **A test must fail without the fix.** For a guard or a check, remove it and watch a test go red.
  A test that passes either way is not coverage.
- **Tests never touch the real home.** `scripts/test-sandbox.ts` (preloaded for every `bun test`)
  points per-user folders at a throwaway one and fails the run if the real ones gain anything.
  Never test on the maintainer's own library or chats; make throwaway data.
- **Search across lines, and read the map first.** A call split over lines hides from a one-line
  search: search for the quoted name alone. Before guessing where something lives, search
  [docs/generated/CODE-MAP.md](docs/generated/CODE-MAP.md).
- **Words mean two things here.** Spoke, gate, doctor, keyring, sidecar, and cast each have two
  meanings; check [the glossary](docs/reference/glossary.md) before assuming.
- **Destructive git is recoverable, not free.** Name paths explicitly (`git checkout -- <path>`,
  never bare), and never `git stash pop` an entry you did not just make: confirm it by name in
  `git stash list` first. On the maintainer's machine a snapshot is taken before any discarding git
  command; list them with `git for-each-ref refs/safety-net/` and restore a file with
  `git checkout refs/safety-net/<name> -- <path>`.
- **The Windows shell eats escapes.** Inline sed, perl, and heredocs mangle backslashes and quotes.
  For anything beyond a one-word substitution, write a small script file and run it with bun. Bun
  and Node want `C:/...` paths, not `/c/...`. Files stay LF (`.gitattributes` enforces it).
- **Bun's `expect(promise).rejects` can hang.** While the promise waits on a timer, it blocks the
  timer, so the test never ends. Settle first (`const e = await p.then(() => null, (x) => x)`), then
  assert on the result.
- **One plan at a time.** When someone raises an idea mid-work, answer it and restate the current
  plan; do not quietly fold every idea into the work.

Before adding a shared helper, check [HELPERS.md](HELPERS.md) for its existing home and extend that
module when its contract fits. If the index has no suitable home, add one and regenerate it with
`bun run helpers`.

## 8. Repo layout

Every folder under `src/` and the other top-level folders are explained in
[the glossary](docs/reference/glossary.md) ("Where things live"), which `bun run glossary:check`
keeps complete. Every source file's purpose is in [the code map](docs/generated/CODE-MAP.md).

## 9. Security posture

Read [SECURITY.md](SECURITY.md). If your change touches the server, paths, parsing, archives, or
anything sandbox-adjacent, the relevant tests (`src/ui/server.test.ts`, `src/studio/path-policy.test.ts`,
`src/sandbox/`) must grow with it.
