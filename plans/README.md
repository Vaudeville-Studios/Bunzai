# Implementation plans

Generated using the improve skill on 2026-10-31 against `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.

These plans record intended implementation. Current implementation and verification results are recorded in the execution evidence ledger, separately from the original design.

| Plan | Title | Priority | Effort/risk | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| [001](001-unified-extension-runtime.md) | One capability-driven extension runtime, generated permission/API catalog, SDK and developer preview | P1 | XL / HIGH | Sequential work packages in plan | IMPLEMENTED; VERIFIED SOURCE |

Implementation authorized 2026-10-31. The feature branch is being merged into Mainstage in `C:\Users\chiev\Documents\Bunzai-extension-merge-20261031`, branch `deliver/extensions-merge-20261031`, preserving the owner's original worktrees. The user authorized this merge and push. Historical feature-branch full-suite evidence is separate from current merge evidence: focused migration, broker, catalog and Core protection checks, TypeScript, independent review and the built Browser extension smoke pass. The current merge has not run the full suite or refreshed native executable proofs. Core-linked scenes still do not run extension prompt/event hooks; unsupported operations fail explicitly. Native GUI file-picker acceptance and an external developer's tutorial trial remain manual checks. This is not a stable-API or universal isolation certification. See the execution ledger for exact evidence and limitations.

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
