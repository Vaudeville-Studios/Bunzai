# Implementation plans

Generated using the improve skill on 2026-10-31 against `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.

These plans record intended implementation. Current implementation and verification results are recorded in the execution evidence ledger, separately from the original design.

| Plan | Title | Priority | Effort/risk | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| [001](001-unified-extension-runtime.md) | One capability-driven extension runtime, generated permission/API catalog, SDK and developer preview | P1 | XL / HIGH | Sequential work packages in plan | IMPLEMENTED; NORMAL COMMIT GATE |

Implementation authorized 2026-10-31. Isolated worktree: `C:\Users\chiev\Documents\Bunzai-extension-runtime`, branch `feature/unified-extension-runtime`. The owner's original worktree remains separate. The full source suite and all individual verification checks pass; the aggregate wrapper's test-path correction and exact results are recorded in the ledger. Root approves a scoped normal-hook commit. No push is authorized. Native GUI file-picker acceptance and an external developer's tutorial trial remain manual checks; this is not a stable-API or universal isolation certification.

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
