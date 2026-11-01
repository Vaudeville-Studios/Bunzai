# Docs-search runtime-pin fixture

Normal release run 41298220078 for immutable v0.1.44 (67a4b2c) failed at
`src/site/docs-search.test.ts`: its query still contained Bun 1.3.14 while the
installation guide and generated search index correctly described Bun 1.4.2.
Fail-fast stopped after 555 tests across 71 files, with no builds or publication.
The task-local failed job log is
`C:/Users/chiev/AppData/Local/Temp/codex-bunzai-release-41298220078-failed.log`.

The query now derives from the authoritative `.bun-version`; both the held-fetch
and eventual installation-link assertions remain unchanged. The pure website
installation page links that same authority instead of maintaining another
numeric version, and describes optional remote helpers rather than Kit releases.
The no-published-assets statement remains until actual publication.

On the exact candidate, isolated Bun 1.4.2 ran docs-search, site pages and egress
tests: 8 passed, 97 assertions, exit 0/signal null. Diff checking passed. This is
focused source proof, not a full release pass. The previous tag remains immutable.

Root independently reviewed the exact three-line test/copy diff and reran
docs-search under isolated Bun 1.4.2: 1 passed, 2 assertions, exit 0/signal null.
Root approved the scoped normal-hook commit and one new normal release attempt.
