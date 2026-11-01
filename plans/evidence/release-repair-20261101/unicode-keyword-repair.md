# Unicode keyword-boundary repair

Date: 2026-11-01. Checkout: `c5430bb`, pinned Bun 1.3.14. All commands use
`C:/Users/chiev/AppData/Local/Temp/codex-bunzai-repair-run.ts` for isolated task
profiles and provider-environment removal.

## RED and candidates

The unchanged parity suite failed on `supplementary-plane letter glued`: for
`key="a"`, `text="\u{10400}a"`, the ordinary regex path returned true while the
trie path returned false. The trie and shared code-point classifier correctly
identify U+10400 as a letter. Bun 1.3.14's Unicode negative lookbehind is the
inconsistent path.

The first consuming-prefix candidate with a negative assertion remained red
(55 pass / 1 fail). A later shared code-point scan made parity green but was
rejected after review found quadratic rescanning on repeated literal keys. Both
were discarded before the final source change.

The approved direct complementary-class prototype uses
`(?:^|[^BASE_WORD_CLASS]|[SPACELESS])`, followed by the escaped literal and the
existing right-boundary lookahead. Its `u`/`iu` non-global regex matched all 35
word-category tuples against expected results and the trie, plus all 740 ASCII
differential combinations. Its repeated-a smoke measured 5.50/8.25/19.57 ms at
40k/80k/160k against 3.22/4.03/8.15 ms for the old lookbehind control. These
are exploratory measurements, not release performance claims.

The final source factors the base word categories into `BASE_WORD_CLASS`, exports
the complementary `WORD_PREFIX`, and restores the original nonglobal cached
`u`/`iu` regex with a single `.test()` call. The right lookahead, trie algorithm,
raw regex triggers, cache gates, budgets and counters remain unchanged.

Added cases cover astral letters before and after a key, a valid later match
after an astral-letter-glued occurrence, a later overlapping match, and repeated
calls through the cached matcher. A bounded child process checks the astral
keyword's glued-then-valid occurrence in both case modes, and checks that a
warmed repeated-a invocation makes between one and eight `RegExp.exec` calls.
The test does not depend on an exact internal call count.

## Verification

Focused parity command:

```powershell
& 'C:\Users\chiev\AppData\Local\Temp\codex-bun-windows-1.3.14-20261101\bun-windows-x64\bun.exe' 'C:\Users\chiev\AppData\Local\Temp\codex-bunzai-repair-run.ts' test ./src/core/lore/engine/key-word-boundary.test.ts --timeout 120000
```

Result: 59 passed, 0 failed, 1,564 assertions.

All Core Lore test files were run together through the same isolated runner:

```powershell
$files = rg --files -g '*.test.ts' -g '*.test.tsx' src/core/lore | ForEach-Object { './' + $_.Replace([char]92,'/') }
$files += './src/stage/crypto/keyring-heap-canary.test.ts'
& 'C:\Users\chiev\AppData\Local\Temp\codex-bun-windows-1.3.14-20261101\bun-windows-x64\bun.exe' 'C:\Users\chiev\AppData\Local\Temp\codex-bunzai-repair-run.ts' test @files --timeout 120000
```

Result: 422 passed, 0 failed, 21,114 assertions across 38 files. This includes
the stage keyring heap-canary lock test (3 tests, 6 assertions), including its
real heap-snapshot check that token, keyword-regex, and lore-index caches are
unreachable after lock. No full suite was run.
