# Reviewed fingerprint coverage pin

Normal release run 41298785367 for immutable v0.1.45 (4d33582) stopped at the
storage-shape tripwire after 6,176 tests across 655 files (414.36 seconds).
The real full gate had passed docs-search and all nine protected-browser cases.
No binary build or publication ran. Failed job evidence is task-local at
`C:/Users/chiev/AppData/Local/Temp/codex-bunzai-release-41298785367-failed.log`.

The canonical 88-owner manifest at its previous pin commit 708e8d5 reproduces
`f1706f2b902d1e801429927ee4b7af908e70977950bca036a3e4338aded9ee06`.
Current owners reproduce
`dd80128451656e177f9fc720b6abbfd927ab061fd37fabb7c332ac67c36cb347`.
The only changed owner is the previously reviewed `row-fingerprints.ts` line
adding `origin` to Core birth coverage and explicitly advancing that spec to v2.
Root and the independent reviewer verified this exact manifest/delta and approved
the compatibility decision: no migration, stored-column change or SCHEMA_BUMPS
entry is needed. Valid v1 rows are explicitly adopted; historical v1 fingerprints
did not authenticate plaintext origin. The encrypted body remains authoritative.

Only the expected tripwire pin and one dated compatibility note changed. The
manifest, schema count assertion, normalization and hash assertion are unchanged.
Isolated Bun 1.4.2 ran the real tripwire, existing row fingerprint suite and three
Core-origin cases: 11 passed, 247 assertions, exit 0/signal null. The actual full
line guard passed, including the tripwire's 499 lines. Diff checking passed.
This is focused evidence, not a claim that the full release gate has passed.

Root independently reviewed the exact pin/comment diff and reran the real
tripwire: 1 passed, 2 assertions, exit 0/signal null. Root approved the scoped
normal-hook acknowledgement and one subsequent normal release attempt.
