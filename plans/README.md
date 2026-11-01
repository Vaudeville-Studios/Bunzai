# Implementation plans

Generated using the improve skill on 2026-10-31 against `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.

These plans record intended implementation. Current implementation and verification results are recorded in the execution evidence ledger, separately from the original design.

| Plan | Title | Priority | Effort/risk | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| [001](001-unified-extension-runtime.md) | One capability-driven extension runtime, generated permission/API catalog, SDK and developer preview | P1 | XL / HIGH | Sequential work packages in plan | IMPLEMENTED; VERIFIED SOURCE |
| [002](002-rp-core-extension-integration.md) | Connect extension hooks, execution and persistence to existing RP-Core scenes | P1 | XL / HIGH | 001 merged | VERIFIED SOURCE; DELIVERY PENDING |
| [003](003-public-docs-and-illustrated-installation.md) | Publish bundled Docs and a real screenshot installation guide | P1 | L / MED | Reconcile after 002; independent site lane | VERIFIED SOURCE; DELIVERY PENDING |
| [004](004-hoplight-helper-and-product-launch-identity.md) | Restore helper availability and isolate Hoplight/Bunzai launches | P1 | L / HIGH | Independent remote lane; reconcile with 002/003 | IN PROGRESS |

Implementation authorized 2026-10-31. Plan001 is published on Mainstage at 7588d4b. Plan002 source is independently reviewed and committed at 708e8d5; its RP-Core fork branch is published and fresh-clone verified at 9cce055. Plan003 source is reviewed and committed at 0a7cfdd. Plan004 source is independently reviewed; the exact rebuilt Hoplight artifact and Bunzai helper are approved for backed-up local repair. Their final combined Bunzai Mainstage delivery remains pending.

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


