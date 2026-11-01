# Public Docs and installation evidence

## Scope and result

- Checkout: `Bunzai-public-docs-20261031`, branch `feature/public-docs-installation`, based on published commit `7588d4b`.
- The pinned `vendor/rp-core` submodule was initialized at `b0b6761297fa27146c4fab6a285bad8e5bad1c1c`; `bun install --frozen-lockfile` completed.
- The build emits 180 site pages, including 141 bundled Docs pages. The Docs renderer reuses the in-app DocsIndex, page grouping, link rewriting, figure inventory, heading anchors, and safe Markdown renderer.
- The local Bun runtime used for checks was 1.4.2; the repository's `.bun-version` remains the documented source-install pin of 1.3.14.

## Automated checks

- `bun test ./src/site/documentation.test.ts ./src/site/guides.test.ts ./src/site/pages.test.ts ./src/ui/apps/docs/docs-core.test.ts` passed: 12 tests, 22,502 assertions.
- `bun run typecheck` passed (exit 0). Captured output: `typecheck.log`.
- `bun run build:pages` passed: `dist/pages ready: 180 site pages; studio/ has 12 apps, 4 setup steps, 141 docs`.
- `bun run docs:figures --check` passed: 62 figures current.
- `bun run docs:summaries:check -- guide/getting-started --author` and `bun run docs:summaries:check -- guide/installation --author` pass. `docs:index --check` is intentionally still red until both sidecars receive independent review; their authored summaries are not self-approved.

## Built Pages interaction

The built Pages artifact was served by `bun run preview:pages 18877` from `dist/pages` at `http://127.0.0.1:18877/Bunzai/` (Bun PID 40156). `proof-pages.ts` exercised the home Docs link, bundled index, a search query, and the installation deep link `#doc-run-from-source`. It observed 141 navigation links, three search results, the target heading and figure, zero page errors, and zero off-origin requests. At 375px and 768px, the page stacks without horizontal overflow; the 375px page list is scroll-bounded to 256px. At 1440px, the sidebar, article, and TOC remain in three columns with no overflow. Screenshots: `pages-docs-index.png`, `pages-installation.png`, and `pages-{375,768,1440}.png`.

This is a local built-HTML browser run, not connected-CUA evidence or a published Pages deployment. The preview process is left running for review.

## Isolated local Studio screenshots

The screenshots in `../../../docs/media/installation/` were captured from the real source Studio at `http://127.0.0.1:18321/` using a disposable profile at `C:\Users\chiev\AppData\Local\Temp\bunzai-public-docs-814f6e174d19424592b53a804964cfdd`. The first-run screen was captured before skipping setup; the Library screenshot shows the empty Library import and Start fresh doors; the Scenes screenshot shows a clean, empty local Scenes room. The images are 1440 by 960 pixels. No provider key or account credential was entered. The Studio process was closed after capture; the isolated profile was not copied from a user library.

- `setup-wizard.png` SHA-256 `95E339B912C8E25F361B453E2CD3F1C68AC5DD9F4271FC458A89BBD88EFE420F`
- `library.png` SHA-256 `3639CB5C81AACB9EF0BAC9214CE33CF29DDC710C2FE868AB8625EB9E76788999`
- `scenes.png` SHA-256 `1D4CD5A3816A7878CA8FAF1DFDBC813368424970F101113C54574E83F814542D`

The guide says the source checkout checks ten candidate ports. This was checked against `src/cli.ts` (`claimPort(port, 10, ...)`) and exercised with the actual `bun run dev` script: an existing Studio owned 8321, the isolated second instance started on 8322, and `/api/version` identified its disposable `studioDir`. The second instance was stopped; the existing Studio on 8321 was left untouched.

## Installation-copy review state

The two semantic sidecars are complete and author-valid. The docs-index warning is an approval gate, not a missing-source page. Request independent review before accepting the generated index as release-ready.
