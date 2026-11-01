# Public Docs and installation evidence

## Scope and result

- Original docs checkout: `Bunzai-public-docs-20261031`, branch `feature/public-docs-installation`, based on published commit `7588d4b`.
- Integrated candidate: `Bunzai-final-delivery-20261031`, branch `deliver/mainstage-final-20261031`, published Mainstage source `a3631157aad229574a763c811ea46e0c4be515f2`, based on `7588d4bf5c835b4a2176e3ebaf1843f9f5006c66`.
- The candidate preserves the reviewed source commits as ancestors: Core `708e8d5158f630d82c421c0aa3aab2c63ec4d8f9` via merge `1748278a984427764a10fe4c08790833a875b83c`; docs `0a7cfdd8b142742a56512e52b9d7139c10f6de1a` via merge `386a68b55956c6ca6c5e0e7071e941d9e89cc0e3`; Bunzai helper `68262753aa83110cc7ff312abb91252223a828b2` via merge `454b4902571fb1b218864dee3345833e8699ef3e`.
- The pinned `vendor/rp-core` submodule is initialized at approved fork commit `9cce0552df233c7185329d9cfc5473be67e2e821`; `bun install --frozen-lockfile` completed.
- The build emits 180 site pages, including 141 bundled Docs pages. The Docs renderer reuses the in-app DocsIndex, page grouping, link rewriting, figure inventory, heading anchors, and safe Markdown renderer.
- The local Bun runtime used for checks was 1.4.2; the repository's `.bun-version` remains the documented source-install pin of 1.3.14.

## Automated checks

- The published candidate passed `bun test ./src/site`: 32 tests, 22,651 assertions. The search-latency follow-up adds one regression; the current local follow-up passes 33 tests, 22,653 assertions.
- `bun run typecheck` passed (exit 0) on the published candidate and again on the search-latency follow-up.
- Focused Core integration/storage checks passed: 33 tests, 211 assertions. Focused Bunzai helper/launch checks passed: 105 tests, 246 assertions.
- `bun run build:pages` passed: `dist/pages ready: 180 site pages; studio/ has 12 apps, 4 setup steps, 141 docs`.
- `bun run docs:index:check` reports 141/141 approved semantic pages; `bun run docs:summaries:check` reports all 141 approved and projections current; `bun run docs:figures:check` reports 62 figures current.

## Built Pages interaction

The integrated candidate Pages artifact was served from `dist/pages` at `http://127.0.0.1:18879/Bunzai/` using `bun run preview:pages 18879`. `proof-pages.ts` exercised the home Docs link, bundled index, search, and installation deep link `#doc-run-from-source`. It observed 141 navigation links, three search results, the target heading and figure, 152 local Docs links, zero page errors, and zero off-origin requests. Its delayed-index scenario types the query before releasing `docs/docs-index.json` and then observes three results without another input event. At 375px and 768px, the page stacks without horizontal overflow; the 375px page list is scroll-bounded to 256px. At 1440px, the sidebar, article, and TOC remain in three columns with no overflow. The proof runner is configurable with `DOCS_PREVIEW_ORIGIN`; the local preview process was stopped after verification. Screenshots: `pages-docs-index.png`, `pages-installation.png`, and `pages-{375,768,1440}.png`.

## Published Pages verification and search-load follow-up

- Manual Pages workflow `41268646260` completed successfully for `a3631157aad229574a763c811ea46e0c4be515f2`. The live site is `https://vaudeville-studios.github.io/Bunzai/`.
- Public requests returned 200 for the landing page, Docs index, installation guide, 1,040,180-byte Docs catalog, and all three installation screenshots. The published catalog contains 141 records, including the installation guide. The public browser proof observed the Docs link, three search results, installation deep link and figure, 152 local Docs links, and zero page errors, failed requests, or off-origin requests at 375px, 768px, and 1440px. The first cold-cache run timed out waiting for search; after assets warmed, the live search probe and complete browser proof passed.
- The cold-cache timeout prompted a separate built-UI timing regression. With `docs-index.json` held, typing `Bun 1.3.14` left zero results after the response arrived and no second keystroke. The follow-up attaches the input listener before fetch and applies the current query after index validation. `docs-search.test.ts` covers deferred fetch using the generated catalog; the built browser proof now covers the same delay and returns three results.
- The search-latency follow-up passes `bun test ./src/site` (33 tests / 22,653 assertions), `bun run typecheck`, `bun run build:pages` (180 pages / 141 Docs), and the local delayed-index browser proof. This follow-up is recorded separately from the successful live deployment above and requires its own reviewed Mainstage/Pages update.

No connected-CUA evidence, native installation, or release-download flow was tested. The guide reflects the source-install route and available release facts.

## Isolated local Studio screenshots

The screenshots in `../../../docs/media/installation/` were captured from the real source Studio at `http://127.0.0.1:18321/` using a disposable profile at `C:\Users\chiev\AppData\Local\Temp\bunzai-public-docs-814f6e174d19424592b53a804964cfdd`. The first-run screen was captured before skipping setup; the Library screenshot shows the empty Library import and Start fresh doors; the Scenes screenshot shows a clean, empty local Scenes room. The images are 1440 by 960 pixels. No provider key or account credential was entered. The Studio process was closed after capture; the isolated profile was not copied from a user library.

- `setup-wizard.png` SHA-256 `95E339B912C8E25F361B453E2CD3F1C68AC5DD9F4271FC458A89BBD88EFE420F`
- `library.png` SHA-256 `3639CB5C81AACB9EF0BAC9214CE33CF29DDC710C2FE868AB8625EB9E76788999`
- `scenes.png` SHA-256 `1D4CD5A3816A7878CA8FAF1DFDBC813368424970F101113C54574E83F814542D`

The guide says the source checkout checks ten candidate ports. This was checked against `src/cli.ts` (`claimPort(port, 10, ...)`) and exercised with the actual `bun run dev` script: an existing Studio owned 8321, the isolated second instance started on 8322, and `/api/version` identified its disposable `studioDir`. The second instance was stopped; the existing Studio on 8321 was left untouched.

## Installation-copy review state

The two semantic sidecars are complete and author-valid. The docs-index warning is an approval gate, not a missing-source page. Request independent review before accepting the generated index as release-ready.
