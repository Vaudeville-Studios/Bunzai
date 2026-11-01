# Core birth fingerprint coverage and busy-writer fixture

Source base: c5430bb8f463754973da81bef2ed2121b7fa1164 plus separate pending lore work, which this lane does not alter. Tests use verified Bun 1.3.14 and fresh whitelisted task profiles. No migration, schema, database.ts retry owner, authority or other fingerprint spec changed.

RED: current Core birth plaintext origin tampering was not reported by the real health scan. A legacy v1 fingerprint remained classified same rather than old/adoptable. The unchanged exhaustive fingerprint coverage test independently identified missing origin. Final new tests were run before production changes and failed for these actual outcomes.

GREEN: the single core_scene_creation_bindings spec now includes origin at version 2. New real Core births are sealed at v2; raw origin changes are detected while authorization still reads origin from the authenticated encrypted body. Historical v1 inputs are explicitly frozen in the fixture. A valid v1 row is classified old through the real health lane, explicitly adopted by the public health API into v2, then scans clean. This is not a retrospective guarantee: v1 did not authenticate its omitted plaintext origin field.

A third regression scans an adoptable old row, corrupts its encrypted body, and clears the write queue to model physical damage. Adoption re-opens it, refuses to sign it, preserves its old fingerprint and damaged cell, and reports cell-unreadable. This does not rely merely on a queued-write shortcut.

The timing-sensitive database test now waits until its real SQLite INSERT has actually thrown SQLITE_BUSY before starting the exclusive job. Both real connections, 100ms retry budget, 400ms exclusive hold, successful write and row count are unchanged. This is a fixture precondition repair, not evidence of a production database defect.

Completed GREEN: new fingerprint-origin, existing row-fingerprint and full database suites: 30 pass, 289 assertions. Existing health adoption cases: 3 pass, 8 assertions, including adoption refusing damaged rows. Health restore and Core authority: 24 pass, 126 assertions, including older snapshot adoption, damage preservation and migration52/version51 data preservation. Total completed focused checks: 57 tests, 423 assertions. The latter two batches also explicitly recorded child exit 0 and no signal.

An earlier four-file health scan/repair/restore/Core attempt ended without a final Bun summary after reporting individual passing cases. Its child exit was not retained because subsequent shell commands masked it. That attempt is unverified and is not included in the passing totals. No whole-wall rerun or production retry change was used to conceal this limitation.

Independent approval: luna_js_engine approved the source changes. Root independently reviewed the complete storage diff and reran the new Core-origin plus existing fingerprint tests: 10 pass, 245 assertions, explicit child exit 0 and no signal. Root approved this scoped commit; this approval does not claim the remaining browser or UI/Kit failure families are resolved.

Current protected-browser child stderr is retained separately in protected-browser-current.txt. It confirms connectOverCDP ECONNREFUSED 127.0.0.1:9591 at driver.ts:28 under Node22.23.4 in run41275963827. The actual Chrome process stderr was discarded by the driver, so its launch failure reason remains unknown. No browser repair is included here.
