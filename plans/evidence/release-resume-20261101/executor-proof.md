# Release resume candidate evidence

Candidate worktree: `C:\Users\chiev\Documents\Bunzai-binary-release-resume-20261101`
Branch: `release/binary-v0.1.47-20261101`
Base: published Mainstage `70ab382c1827721004912eb8f613baf4da4901c0`
Runtime: Bun `1.4.2` (`744846f84`)
Vendor: `vendor/rp-core` at `9cce0552df233c7185329d9cfc5473be67e2e821`

## Changes and proof

- The two previously reviewed test repairs were copied byte-for-byte from the isolated test-reduction tree. Their hashes remain `2D7656CC4133C64667A3B55FB04EEBB85D8ED81ABFF2F8B21938C9A6429C2B31` (`src/kit/render/app.test.tsx`) and `9FCCF9C4503C0832E99913C27946BF019A9DC50837CE1036A946E3922582D10A` (`src/studio/scene-turn-prompting.test.ts`).
- Unchanged `./scripts/extension-required-families.test.ts` reproduced the stale `scenes.create` exclusion (`desktop` and `terminal` excluded). The existing Core integration fixture now exercises Terminal QuickJS creation and Desktop service creation against the same encrypted SQLite library. Desktop activation waits for its real pending user approval, verifies the scene does not exist before approval, then checks the successful result, frozen character identity/version and exact active-take/Core session link. After this proof, only the stale `scenes.create` exclusions were removed.
- The unchanged live single-source guard initially reported eleven duplicate-owner findings. The ten approved owners now reuse canonical helpers. The existing live guard itself was unchanged and now passes. SQLite swipe/message cut predicates use the shared `LIVE`/`liveOf` string; the emitted predicates remain `m.cut_at IS NULL` and `s/w.cut_at IS NULL`, with all other ownership and visibility checks unchanged.

## Commands and results

All test/typecheck runs used fresh TEMP profile roots with `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `BUNZAI_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_STATE_HOME` redirected before imports, plus `BUN_OPTIONS=--no-env-file`. The full suite was not started; the normal pre-push hook is expected to run it once during authorized delivery.

- `bun install --frozen-lockfile`: exit 0, 9 packages installed; `package.json` SHA-256 `ED23E570924E4960D868C73D7F36C9FDAF212414A58288450317BD08ACC63775`, `bun.lock` SHA-256 `C4AEA5AA740350523025E88EB806AB8287A95B470F74993EC198BFD14C377B97`; vendor gitlink unchanged.
- `bun test ./src/kit/render/app.test.tsx ./src/studio/scene-turn-prompting.test.ts ./src/kit/extensions/core-scene-guard.integration.test.ts ./src/ui/server-extension-owner.test.ts ./scripts/extension-required-families.test.ts --timeout 120000`: 31 tests, 136 expectations, exit 0. Log: `%TEMP%\bunzai-release-fivefile-20b394c5ac7f4936a2efe51e8803f3af.log`.
- `bun test ./scripts/hooks/single-source-core.test.ts --timeout 120000`: 26 tests, 100 expectations, exit 0. Log: `%TEMP%\bunzai-release-single-source-final-7c547c92d6af4b9a87bcb776b9c07f01.log`.
- Final affected-owner suite, 16 files: `bun test ./src/error-message.test.ts ./src/ui/_shared/render-policy.test.ts ./src/ui/apps/docs/docs-core.test.ts ./src/studio/core-inspect.test.ts ./src/ui/apps/scenes/scene-core-wing.test.tsx ./src/extensions/runtime/turn-services.test.ts ./src/ui/server-chats-turn.test.ts ./scripts/theme-measure/chrome-startup.test.ts ./src/stage/store/sqlite/core-record-authority.test.ts ./src/stage/store/sqlite/core-extension-state.test.ts ./src/stage/store/chat-store-state.sqlite.test.ts ./src/kit/render/app.test.tsx ./src/studio/scene-turn-prompting.test.ts ./src/kit/extensions/core-scene-guard.integration.test.ts ./src/ui/server-extension-owner.test.ts ./scripts/extension-required-families.test.ts --timeout 120000`: 149 tests, 626 expectations, exit 0. Log: `%TEMP%\bunzai-release-final-focused-1acab66c071d4bbaafb256383e39a2a2.log`.
- `bun run typecheck`: exit 0. Log: `%TEMP%\bunzai-release-typecheck-final-c8a8df732bda4b6e93c13397190d456a.log`.

## Current boundary

The candidate has not been committed, pushed, built as a release artifact, or published. The normal pre-push test gate and remote release workflow remain the next verification steps. The published v0.1.46 tag is untouched.