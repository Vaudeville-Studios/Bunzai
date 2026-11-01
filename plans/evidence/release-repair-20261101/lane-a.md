# Lane A: release-verification contract coverage

Base: 2307cd60fc23fb0eed7de3853a715ce9bd6082d3. RP-Core: 9cce0552df233c7185329d9cfc5473be67e2e821. Verified Bun: 1.3.14. Root and vendor frozen installs passed without lock or vendor changes.

Tests ran in whitelisted child environments with fresh per-invocation temporary HOME, USERPROFILE, APPDATA, LOCALAPPDATA, BUNZAI_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, XDG directories and TEMP. No provider/account environment was inherited. The normal preload remained enabled.

RED: actual unmodified focused tests rejected src/site/docs-search.ts (1) in the egress inventory and reported all seven missing Core methods in the locked-store inventory. Docs search's existing delayed-index interaction passed. The first cold egress scan also exceeded the default five-second timeout; the normal package command uses --timeout 120000. This was not treated as an additional product bug.

Owning changes: register exactly one generated same-origin static docs-index fetch in the existing exact-count egress policy; add typed inputs for createCoreChat, projectCoreMessage(s), stage/record/applyCoreExtensionState and discardCorePendingState. The exhaustive method inventory, exact LockedError assertions and entire-database before/after snapshot are unchanged. No production behavior changed.

GREEN under the normal 120000ms test budget: ./src/egress-doors.test.ts + ./src/site/docs-search.test.ts + ./src/stage/store/locked-stores.sqlite.test.ts: 6 pass, 150 assertions. Adjacent ./src/stage/store/sqlite/core-extension-state.test.ts + ./src/stage/store/sqlite/core-record-authority.test.ts: 28 pass, 127 assertions, including the actual QuickJS state command. Diff whitespace check passed.

Current release run 41275963827 was cancelled by root authorization after actual partial logs confirmed 1253 failures across 224 groups. No binaries were published; v0.1.43 remains immutable. This focused repair does not claim the remaining browser, native or Kit failure families are fixed or the full gate passes.

Independent review: root reviewed the exact Lane A diff and the static documentation index generator, then independently reran the isolated pinned three-file suite: 6 pass, 150 assertions. Reviewer extension_plan_review found Plan007's bounded scope shippable. Root approved this Lane A commit; native and DOM/Kit lifecycle investigation remain separate work and are not covered by this approval.
