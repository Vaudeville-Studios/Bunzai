# Chrome startup fetch leak follow-up

Candidate: `ae75f09c03147d9ec122f4176719cf2d451de8b2` in `Bunzai-binary-release-resume-20261101`.

The prior full pre-push failure was reproduced in the ordered 31-file mutator cohort followed by a temporary copy of only the first Chrome startup test. Before the repair, 228 tests passed and that case failed at its original 10-second deadline. The connector made 140 attempts against an `impl` fetch that returned HTTP 200 with `{"phase":"unlocked"}`; no request reached its delayed child. Interleaved probes located the first leaked implementation immediately after `src/ui/shell/library-gate-mount.test.tsx`. That file replaced both global `fetch` and `EventSource` in `beforeEach` but its DOM teardown did not own those descriptors.

The one-line fix adds `fetch: globalThis.fetch` and `EventSource: globalThis.EventSource` to the existing `installDom` globals snapshot. It leaves the existing fixture setup, assertions, polling, transport, and deadlines unchanged. `installDom` restores the prior descriptors on the existing awaited teardown path.

Verification on the fixed source:

- Root ran the 31 source files followed by the verbatim original first Chrome test using default Bun runner flags: 229 passed, 664 expectations, 32 files, exit 0, 56.52s.
- An executor diagnostic rerun inserted 32 fetch/EventSource descriptor probes into the same ordered cohort and appended the temporary first-case copy: 261 passed, 664 expectations, 64 files, exit 0, 55.70s. Fetch retained the same native function hash before and after the cohort; EventSource remained absent before and after. The original first-case assertions passed after 13 HTTP 503 warming responses and one HTTP 200 response.
- Candidate source hashes after verification: `library-gate-mount.test.tsx` `4c948aa998d2885896fea7a5522de47b18ca7c83d41539c7f4073a0e83abd406`; `App.boot-retry.test.tsx` `3b536da3e20a2a4748b96cb538955331051f7ec8190a1ef1ed1af8da4aa7c054`; `App.boot.test.tsx` `fafafa33bd4a226141f805500fb5bc9223db8f02025ad37961e0cfe12f944810`; Chrome test `07b4bb3104397e5dc4a5332c5b60820f3108725358a734742f626b46343a574d`; driver `4be4de90fa56c4bcf34401f21d227a263405369d8018f8d10c507c1aba73a1d1`.

Raw bounded diagnostic logs remain outside the repository in `C:\Users\chiev\AppData\Local\Temp\codex-chrome-cause-ae75-run1` and `...\codex-chrome-cause-ae75-probes`. The diagnostic tests/probes are temporary, untracked files and are not release artifacts. This verifies the fetch-leak cohort and Chrome startup test only, not the full release suite.