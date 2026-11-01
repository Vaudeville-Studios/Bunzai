# Local Windows artifact preparation

Source: 9f8e8571929e32fc8e65ad721a13b653c1aa787f; RP-Core submodule 9cce0552df233c7185329d9cfc5473be67e2e821. Bun 1.3.14, official Windows archive SHA256 0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922. Frozen root and vendor installs passed. Build command: bun run scripts/build-desktop.ts --cli-targets=bun-windows-x64 --kit.

Exact artifact sizes, hashes, CLI help/version/formats/validation and Kit help/invalid-option exit outcomes: windows-basic.json. Actual packaged CLI isolated HTTP and extension lifecycle results: windows-http.json. Reproduction orchestrator: http-smoke.ts; it spawns the production CLI, never a separately compiled substitute.

Original CLI SHA cab4a8b7954faf233e6c77f9cc2de71383c2d7fb2128456485e618c2e398b3b0 reproduced activation HTTP 500 and asserted exit 1 (windows-http-red.json). The identical guest succeeded interpreted; a compiled diagnostic exposed ModuleNotFound for ./sandbox/javascript/worker.ts. The packaging owner omitted that extra worker entry from CLI builds. One shared JavaScript worker path now supplies Desktop, CLI and Kit. Official CLI-only rebuild passed. Rebuilt CLI SHA f2a69c0ababa97b5d51b55d1cdee863bc125a611005d7eda2e3884aa4eb55d64 passes the same asserted production HTTP regression: fresh fixture SQLite library, preview/install/enable/activate, completed output {sum:4,fetch:undefined,process:undefined}, where both undefined values are strings. GREEN exit 0. windows-basic.json retains the ORIGINAL artifact inventory; its CLI hash is obsolete for current dist. Original Desktop and Kit were preserved unchanged. Engine independently reviewed source and exact RED/GREEN evidence. Source worker regressions: 8 pass, 10 assertions.

Separate compiled source probes passed SQLite 3.53.0 WAL/FK/generated columns/JSON1/FTS5/trigram/sealed bytes/rollback/reopen, and maintenance/password/cold-read worker packaging. These probe executables do not prove the production Desktop, CLI or Kit worker graph. Kit terminal interaction, actual Desktop startup/native window, provider turn, full Core journal/projection/state parity, S21 10000 and full verify:ci remain unverified for these artifacts.

Artifacts are large because the shared packaging owner base64-bakes all 231655454 bytes of docs/media (including 183335404 bytes of book-cover layers), adding approximately 309 MB before executable overhead. No assets were dropped or packaging policy changed.

No tags, releases, workflow changes or published pins were created. Stable publication remains gated by existing full verify:ci and packaged S21 evidence. A separately authorized helper-only published prerelease could bootstrap real helper pins before one app gate; unpublished/local helper bytes cannot become public pins. Existing release checkouts all correctly use recursive submodules.


Root independently reran the public regression successfully: root-review.json, exact rebuilt artifact hash, activation 200 and expected isolated guest output. Rebuilt CLI size is 462521856 bytes.


Pinned Bun 1.3.14 executing the local TypeScript compiler with --noEmit passed (exit 0). The source worker suite passed 8 tests and 10 assertions. No full suite or S21 was run.
