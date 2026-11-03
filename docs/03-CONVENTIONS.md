# Conventions

These are the repository's binding implementation rules. They describe current enforced practice,
not an idealized future toolchain.

## Code

- TypeScript runs in strict mode. Untrusted values are narrowed at their boundary.
- Rich internal domain interfaces may be handwritten. Runtime schemas are separate fail-closed
  decoders and must exhaustively cover their canonical type. Only explicitly open extension or escrow
  bags may accept unknown keys. `defineExhaustiveShape<T>()` rejects missing or extra keys, narrowed
  unions, coercion, `any` at any nesting depth, and `never` during typecheck, and
  `src/entities/runtime-schema.ts` composes the strict per-kind decoders used by storage, HTTP, format
  corpus verification, and Kit draft validation.
- Core logic has no UI dependency, no import-time effects, and no hidden singleton authority.
- Throw `Error` objects or typed errors, never strings. User-facing boundaries translate failures
  into plain language.
- Files use kebab-case, types use PascalCase, and values use camelCase.
- Authored TS and TSX are scanned for pictographs. Intentional fixtures or encoded data need the
  gate's line-scoped exception. Documentation and product copy are outside that mechanical scan.

## Tests

- Use `bun run test` for the full suite under the authored `src/` and `scripts/` trees. Its launcher
  removes inherited Git repository overrides before starting Bun, so hook-run fixtures own their Git writes.
  Direct focused `bun test` remains available outside a Git hook; the preload refuses inherited repository overrides.
- Start bug fixes with a public-boundary test that fails against the reported behavior.
- Same-format adapter fixtures must prove parse, serialize, and reparse without semantic loss.
- Tests are deterministic: no live network, uncontrolled clock, or unseeded randomness.
- A green result with framework synchronization warnings is not clean verification.

## CLI

The target automation contract applies to non-interactive data commands: `convert`, `inspect`,
`validate`, `label`, `formats`, and `version`.

- JSON mode emits exactly one JSON value to stdout.
- Human diagnostics use stderr.
- Exit `0` means success, `1` means invalid user input or content, and `2` means an unexpected
  internal failure.
- `help` and the long-running `ui` server are outside the JSON contract.

Not every data command satisfies this contract yet. Until the implementation and command matrix tests
land, [the CLI reference](reference/cli.md) is the source of truth for current behavior.

## Repository

- Source development requires Bun 1.4.2 or later. CI and release builds read the exact version
  from `.bun-version` through setup-bun's version-file input.
- Use a concise commit subject that names the change and affected area. Mainstage subjects must make
  sense in release history; avoid WIP, `misc`, or context-free `fix` messages.
- Conventional prefixes are welcome but not required.
- `[skip release]` is the only machine-read commit marker.
- User-facing behavior changes include tests or recorded live verification.
- Do not bypass hooks or weaken a gate to make a change pass.
- Studio virtualization imports go through `src/ui/_shared/virtual-list`.
  `scan:virtualizers`, CI verification, and the relevant pre-commit path enforce this owner.
- A long flat list is `VirtualRows`; a long card grid is `VirtualShelf` (both from `src/ui/_shared/virtual-list`). Both find their own scroller. Reach for `useVirtualRows` directly only when neither fits.
- Host CSS and TypeScript never key a look or behavior on a theme id; use a surface pick or a manifest field any theme can set.
  `scan:theme-keys` fails on such selectors and comparisons; a comparison that is truly about the bundled set carries `theme-key-ok: <reason>`.
- Every `data-part` is a dotted lowercase name keyed on an id, never on a label, and every scenes wing, tab and pop-out file carries one.
  `scan:parts` fails on an undotted, computed or label-keyed name and on an unnamed wing; `docs:parts` regenerates the page themes read.

## Documentation

- Reference pages describe built behavior only. Planned behavior belongs in a section labeled
  planned.
- Docs move with the source in the same change.
- Generated indexes and semantic summaries do not turn an inaccurate source page into truth.

## Working method

- Inspect implementation, callers, tests, release configuration, documentation, and Git state before
  editing. Name the authority and user-visible outcome.
- For bugs and known contracts, start with an honest failing test at the nearest public boundary. A
  novel design may use a bounded spike before its contract is understood, but it still needs behavior
  proof before completion.
- Fix the owning boundary. Do not introduce a parallel schema, registry, state authority, or
  compatibility path to avoid changing the real owner.
- When docs and code disagree, classify the claim as `IMPLEMENT`, `REWRITE`, `DELETE`, or `RETAIN`.
- Run focused, adjacent, and complete supported verification. Report warnings and skipped checks;
  neither counts as clean proof.
- Substantial or high-risk work receives independent adversarial review. Authors do not approve their
  own semantic summaries, security claims, migrations, or release evidence.
