# Bun runtime alignment

Date: 2026-11-01. The release checkout now selects Bun 1.4.2 in `.bun-version`
and declares `engines.bun >=1.4.2`. Existing CI, Pages and release workflows
continue to read the exact version from `.bun-version`. Dependency declarations,
`@types/bun`, both lockfiles, the vendor revision, test flags and gates are
unchanged.

## Isolated Linux candidate

Candidate: `/tmp/bunzai-bun142-align-339e0339007e4aa78462219ea838efee/src`.
It was assembled from source HEAD `a845a4c83d0fed30f23a2e0fa1b16d1b78f8fbeb`,
with only the current `package.json` and `.bun-version` overlaid. RP-Core was
archived from `9cce0552df233c7185329d9cfc5473be67e2e821` into the root's required
`vendor/rp-core` path. No prior replay snapshot or shared `node_modules` was
used or modified. The candidate had its own HOME, XDG directories, npm cache,
and temporary directory.

The overlaid `package.json` SHA-256 is
`6f4be71fd79725daecd44f82709aec365aa83ade570f28965907df850704a7d5`; the
`.bun-version` SHA-256 is
`b99b4c7cdf236f59bc9f65d963deaecae3b16a7dad87939cacb9057f7664daee`.

The copied Bun executable reports `1.4.2` and has SHA-256
`a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c`.
Frozen root install exited 0 and installed 350 packages; root `bun.lock` remained
SHA-256 `c4aea5aa740350523025e88eb806ab8287a95b470f74993ec198bfd14c377b97`.
Frozen RP-Core install exited 0 and installed 21 packages; vendor `bun.lock`
remained SHA-256 `a7ee35d5affc9abf440f6728bbfc41081dea25ef54f017b3191c729af8489451`.
The installed `rp-core` package resolves within this candidate.

From the candidate root, `bun run typecheck` exited 0. `bun run probe:sqlite`
exited 0 on Linux x64 with SQLite 3.53.2; all runtime checks passed. The root
lock hash remained unchanged after both checks.

The first staging attempt placed the vendor archive beside `src` instead of
under `src/vendor/rp-core`; typecheck then reported the expected missing
`rp-core` package. That malformed candidate was discarded from verification.
The successful results above came from a fresh, correctly rooted candidate.

## Documentation projections

The current source/install instructions now name Bun 1.4.2. The earlier native
cache tests described in `docs/reference/ui.md` are explicitly identified as
historical Bun 1.3.14 evidence, not as proof for the new pin. Root independently
reviewed and approved all four updated semantic summaries and their receipts.

The four focused summary author checks passed. Global
`bun run docs:summaries:check` passed for all 141 pages after the existing queue
projection was regenerated. `bun run docs:index:check` passed with all 141 pages
approved. Existing summary quality warnings remain warnings; they did not fail
the checks.

This is install, typecheck, SQLite-probe and documentation evidence only. It is
not a full `verify:ci`, packaged-artifact, release-build or release result.
