# Implementation plans

Generated using the improve skill on 2026-10-31 against `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.

These plans record intended implementation. Current implementation and verification results are recorded in the execution evidence ledger, separately from the original design.

| Plan | Title | Priority | Effort/risk | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| [001](001-unified-extension-runtime.md) | One capability-driven extension runtime, generated permission/API catalog, SDK and developer preview | P1 | XL / HIGH | Sequential work packages in plan | IMPLEMENTED; VERIFIED SOURCE |
| [002](002-rp-core-extension-integration.md) | Connect extension hooks, execution and persistence to existing RP-Core scenes | P1 | XL / HIGH | 001 merged | VERIFIED SOURCE; PUBLISHED MAINSTAGE |
| [003](003-public-docs-and-illustrated-installation.md) | Publish bundled Docs and a real screenshot installation guide | P1 | L / MED | Reconcile after 002; independent site lane | VERIFIED SOURCE; DEPLOYED PAGES |
| [004](004-hoplight-helper-and-product-launch-identity.md) | Restore helper availability and isolate Hoplight/Bunzai launches | P1 | L / HIGH | Independent remote lane; reconcile with 002/003 | VERIFIED SOURCE; PUBLISHED BOTH REPOS; NATIVE LIMITS BELOW |
| [005](005-binary-distribution-and-archive-reconciliation.md) | Prepare Hoplight-equivalent Bunzai binaries and reconcile archived plans | P1 | L / HIGH | 001-004 source merged | WINDOWS BUILT; BASIC COMPILED CHECKS PASS; RELEASE GATES OPEN |

2026-11-01 reconciliation: Plans 001-004 are on published Bunzai Mainstage
`9f8e8571929e32fc8e65ad721a13b653c1aa787f`. Pages deployment 41269539303
succeeded for that SHA. Hoplight helper/launch repairs are published on its Mainstage
`8e1bdb4b8bbc52528258ac33495643e5b78c361e`. Earlier candidate/pending statements
below describe the historical integration checkpoint, superseded by this paragraph.
Neither source publication nor Pages deployment establishes a Bunzai binary release.
The owner's next priority is binary distribution; the deferred test reduction remains
outside this task. Archived drafts are inventoried in Plan 005 rather than reopened.

Implementation authorized 2026-10-31. Plan001 is published on Mainstage at 7588d4b. The reviewed Plan002 source commit `708e8d5158f630d82c421c0aa3aab2c63ec4d8f9` is integrated by merge `1748278a984427764a10fe4c08790833a875b83c`; its RP-Core fork commit `9cce0552df233c7185329d9cfc5473be67e2e821` is published and fresh-clone verified. The reviewed Plan003 source commit `0a7cfdd8b142742a56512e52b9d7139c10f6de1a` is integrated by merge `386a68b55956c6ca6c5e0e7071e941d9e89cc0e3`. The reviewed Bunzai helper source commit `68262753aa83110cc7ff312abb91252223a828b2` is integrated by merge `454b4902571fb1b218864dee3345833e8699ef3e`. The candidate branch remains unpublished pending the final root checkpoint.

Verification distinguishes source, automated integration, Browser build, and native packaging. The complete test suite was explicitly skipped at the owner's request; focused checks and TypeScript passed in their reviewed branches. Core operations now use the existing external RP-Core owner with fenced journal writes, prompt/event hooks and bounded preview; delete/fork and unsupported Core setting selectors remain explicitly refused. The Hoplight isolated native-window creation failed, and its rebuilt executable's truthful browser fallback was verified at the packaged HTTP boundary. The owner explicitly accepted finishing without the blocked live visual check. No new Tailscale account sign-in or real-device network journey was performed. These results are not universal isolation or stable-API certification. Exact evidence lives alongside each execution plan.

## Execution order

WP0 baseline -> WP1 contract -> WP2 engine proof and WP3 catalog/WP4 store -> WP5 package lifecycle -> WP6 broker -> WP7 runtime -> WP8 content -> WP9 scenes/state -> WP10 external effects -> WP11 UI -> WP12 SDK/examples -> WP13 consolidation -> WP14 artifact/adversarial gates -> WP15 docs/handoff.

Do not parallelize implementation across shared security/lifecycle owners. Independently review contracts before connecting execution, and review the actual security/migration/release diff before readiness claims. Every work package has its own commands, required negative cases and stop conditions.

## Deliberately rejected shortcuts

- Rebuild all foundations: Lua/regex workers, semantic capabilities, Kit policy primitives and theme validators already exist and must be reused where contracts match.
- Treat existing Kit risk modes as extension grants: safe reads can disclose private data; extension authorization is additional.
- Hand-maintain a permission list: source descriptors generate UI, SDK, documentation and runtime catalog.
- Automatically expose all routes/store methods: discovery does not imply authorization.
- Infer complete permissions from JavaScript: static analysis is advisory; broker checks remain mandatory.
- One unrestricted native plugin import or HTML bridge: violates the no-ambient-authority boundary.
- Keep separate theme and executable grant systems: migrate to one lifecycle, retain only tested compatibility adapters.

Read the complete plan before starting. Preserve the existing unrelated Library/media/design working-tree changes and `m.png`.

The [independent cold-review record](001-unified-extension-runtime-review.md) lists the integration gaps found and incorporated. It does not approve an implemented runtime.

## Deferred owner request

After this runtime cohort, review the test harness with a target of roughly 65% fewer tests. The owner explicitly deferred that work on 2026-10-31; no harness reduction, test deletion or CI redesign belongs to the current runtime implementation.


