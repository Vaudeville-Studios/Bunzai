# Plan 003: Publish the bundled documentation and a photographed installation guide

## Status and ownership

- User requested this explicitly while Plan002 RP-Core integration was active. This is a separate site/documentation delivery lane; do not abandon or mix visual changes into the runtime work.
- Planned at Bunzai `7588d4bf5c835b4a2176e3ebaf1843f9f5006c66`, 2026-10-31.
- Priority P1; effort L; risk medium for shared docs/build contracts, low for reversible presentation.
- Use a new isolated worktree/branch from the published base. Preserve all existing dirty worktrees. Share no source files with Plan002 while it is in flight; reconcile generated documentation after integration rather than overwriting either branch's output.
- Root reviews source and semantic summaries; executor writes source, tests and screenshots. Delivery goes to the existing Bunzai Mainstage/Pages after review under existing authorization. No native release train or full 16k test suite.

## Result

The public GitHub Pages site has an obvious Docs link and a detailed standalone documentation section. Its pages, navigation, search, links, screenshots and figures derive from the same canonical corpus bundled in the application. A user can read help/reference/extension documentation without entering Browser Studio. A thorough illustrated installation guide explains the actually available release and source paths, platform differences, first launch, model configuration, library location and updates. Images are real high-resolution screenshots with useful framing, captions and alt text. No fabricated installer screens, fake download assets or AI-generated app UI.

## Current source facts

1. `scripts/build-pages.ts` reads `docs/generated/docs-index.json` through `parseDocsIndex`, copies the declared markdown plus `docs/media` and generated figures into `dist/pages/studio/docs`, then invokes `buildSite`. `src/docs/corpus.ts` is the fail-closed shared inventory/path owner; `src/docs/types.ts` owns DocRecord/DocAnchor/DocFigure contracts.
2. `scripts/build-site.ts` currently scans only `docs/guide/**/*.md`, runs `src/site/guides.ts:renderGuide`, then renders `src/site/pages.ts`. The guide renderer strips `@fig` entirely and sends reference links to GitHub. That is an incomplete port of bundled docs.
3. `src/ui/apps/docs/docs-core.ts` is pure shared presentation logic for `groupDocs`, title overrides, search, link derivation and `prepareDocSegments`. Reuse this owner or extract its actual shared logic into `src/docs` with compatibility exports; do not create a second manually maintained navigation or link registry. `doc-content.tsx` renders prepared markdown/assets with the shared safe markup door. Inspect `src/ui/_shared/render-markup.ts`, render-policy and existing HTML/URL helpers before adding a website renderer.
4. `src/site/pages.ts:frame` owns public site navigation, metadata and relative base paths. The auditorium header currently has Star repo, Open repo, Download; preserve them and add accessible Docs access. Other page nav and footer should link the same Docs section. `src/site/site.css` imports existing Premiere semantic tokens; reuse them and preserve the current theater landing and animation.
5. The canonical existing guide is `docs/guide/getting-started.md`. Its install section is brief and stale: clone lacks `--recurse-submodules`, source Bun minimum differs from `.bun-version` (1.3.14), and some UI descriptions need source verification. Add a dedicated canonical installation guide and link to it from this page and public download/help entry points. Do not maintain one installation article for the site and another for the app.
6. `.github/workflows/release.yml` and `.github/RELEASE-NOTES-INSTALL.md` own distribution names/platform details. Windows desktop is Bunzai.exe; CLI/Kit artifacts are different downloads. macOS/Linux CLI `ui` serves the Studio in a browser; do not call those native desktop apps. Verify names and actual availability before publication.
7. Current live primary-source check: `gh release list --repo Vaudeville-Studios/Bunzai --limit 5` returned no published releases, and `gh release view` returned release-not-found. Recheck before writing final copy. Do not create a release or fabricate a latest-download URL. If none exists, clearly present the source installation as currently available and explain the release route conditionally; fix broken download affordances in scope without pretending there is an installer to download. Browser Studio can be tried but is not the installed local app.

## Scope

In scope: `scripts/build-site.ts`, narrow `build-pages.ts` integration if required, `src/site` docs page/layout/search/render modules and tests, existing site frame/nav/download links/styles, shared pure docs helpers with compatible app callers/tests, canonical `docs/guide/installation.md` (new), getting-started and guide index links, stale installation text in release notes only where directly inaccurate, real screenshot assets/provenance under docs/media, necessary generated docs/figures/summaries and review receipts.

Out of scope: RP-Core/extension source, engine pin/publication, changing auditorium artwork/preroll/timing, app restyling, changing install behavior, publishing native binaries, registering domains/hosting/services, adding paid infrastructure or dependencies without a present need, test harness redesign. Keep new authored code files below 500 lines.

## Sequence

### 1. Read the actual public and bundled docs boundaries

Read AGENTS.md, relevant UI/component references, `docs/reference/architecture.md`, the shared docs corpus/types, app docs-core/doc-content, site build/render/test owners, installation/release workflow, `.bun-version`, package scripts and security/library defaults. Record the base SHA and existing published release/assets output. Review applicable nested instructions. Keep one source of truth for content, discovery, headings/anchors, navigation and URL policy.

### 2. Generate a complete standalone Docs section

Use the existing decoded bundled DocsIndex inventory, not an independent glob or manual registry. Emit stable Pages-safe document URLs for every bundled document, with meaningful overview/user/developer/extension navigation and in-page TOC. Normalize README routes deterministically and preserve exact generated anchor semantics. Keep existing guide links working through generated redirects/compatibility links rather than duplicate authored pages. All indexed markdown links must route locally when a corresponding page exists; non-doc source links may point to the canonical repo. Copy or correctly reference all allowed docs/media/generated-figure assets; keep `@fig` illustrations instead of silently dropping them.

Reuse the existing search/nav logic and canonical metadata. Make search keyboard accessible with labeled inputs, visible result/no-result state and a bounded list of results. Static article content/navigation must remain usable without JavaScript. No full Studio app bundle just to read docs. Keep Pages prefix `/Bunzai/`, encoded paths, nested doc links and hash fragments correct. Use safe HTML/URL handling: code examples remain inert, unsafe protocols/raw script markup do not execute, image URLs stay within allowed assets or explicitly supported documented links. Reuse existing rendering/escaping owners instead of another sanitizer policy.

Use a readable documentation layout matching the site tokens: legible body type, clear hierarchy, useful article width, navigation and TOC, well-spaced code/tables/callouts, mobile navigation and restrained movement. This is documentation, not another animated theater slideshow. Preserve reduced motion, keyboard focus and accessible targets. Do not change landing composition while adding its Docs link.

### 3. Author one thorough canonical installation guide

Write `docs/guide/installation.md` with appropriate metadata so it is automatically bundled and published. Cover:

- What to choose: Windows desktop versus CLI versus optional Kit, supported CPU/OS choices from actual release workflow, Browser Studio's distinct purpose.
- Download route only if actual assets exist; choose the correct asset and distinguish source-code archives. Avoid hardcoded version URLs. If no release is published, source installation is the actionable primary route and the release path is clearly conditional.
- Source prerequisites and the exact pinned/supported Bun version; Git clone with `--recurse-submodules`, `bun install --frozen-lockfile`, the actual development/launch command and printed local address. Existing checkouts use `git submodule update --init --recursive` after updating. Explain where to run commands and how to recognize success.
- First launch and current wizard/screens as actually implemented, opening the Library, importing/creating the first piece, configuring the current model/provider door, starting a scene and where to find docs/settings. Do not ask for or show real provider keys. State that provider usage is separate only where it helps the user make a choice.
- Actual library location and encrypted database behavior, choosing a different library if supported, backups/export before an update, safe update instructions including submodules, uninstalling the program versus deleting personal data. Verify every path against current source; never repeat stale plain-files claims.
- Focused troubleshooting: wrong binary/architecture, CLI window behavior, current Windows WebView2 requirement, occupied loopback port, submodule-not-initialized or Bun version errors. Do not fabricate macOS notarization/installer steps. Windows warning guidance must be accurate, sourced and avoid asserting an unsigned executable is safe merely because it is unsigned.

Keep getting-started concise and link to this guide. Update its stale source command and directly conflicting installation text. Changes to other unrelated docs belong to their owners, not a mass rewrite.

### 4. Capture real pictures and verify the flow

Capture high-resolution screenshots from the actual current app/site using an isolated fixture/profile, never the user's real library or credentials. Use a representative clean first-run/setup, model selection with fake/non-secret values and ready Library/scene screen; add an actual source-install/download screen only where its pictured route is available. If release assets are absent, do not manufacture a release-download screenshot. Native platform screens must be actual captures on that platform or be clearly omitted; do not pretend Windows screenshots prove macOS/Linux installation.

Use purpose-built browser/Playwright tools or the computer-use skill when native app control is required; read that skill first if used. Screenshot capture is evidence, not generated art. Preserve source resolution and aspect ratio, crop through capture regions rather than scaling a full desktop until text becomes illegible. Use useful captions/alt text and click-to-enlarge links; keep images free of private content. Record command/profile/capture dimensions and what platform was actually exercised under plans evidence. Do not commit giant unrelated screenshots or generated build output.

### 5. Verify and reconcile delivery

Add meaningful tests at the actual build boundary: bundled-index inventory equals generated Docs pages; stable URL/anchor mapping and local crosslinks; figure/media resolution; unsafe markup/code remains inert; no missing install screenshots; no fake release availability. Use a temporary build output/fixtures, not user paths. Existing site guides/pages tests should retain compatibility behavior or document intentional redirects.

Run `bun test ./src/site`, focused shared-doc tests if changed, `bun run typecheck`, site structural/lint checks appropriate to changed modules, generated docs/summaries checks, `git diff --check`, and `bun run build:pages`. No full-suite run. Build output must include all corpus pages and real assets. Serve built output and interact with Docs nav, search, a deep reference/extension page, figure, installation steps, image enlargement, back links and mobile navigation. Verify a nested URL and hash work on reload under the Pages prefix, code/tables remain readable at common desktop/mobile widths, and landing entry still works.

Update accurate canonical UI/site documentation and author semantic summaries; root independently approves them. Commit the scoped site branch only after review. Reconcile with Plan002's generated catalog/summary changes before final Mainstage push. On deployment, verify the actual Docs/installation pages and key screenshots return200 and match the checked artifact; do not claim a native installation was tested merely because Pages builds.

## Done criteria

Complete corpus derived from the same inventory as bundled Docs, discoverable public Docs navigation, functional search/TOC/deep links/figures, one canonical thorough illustrated installation article, verified current distribution facts, real sharp screenshots with provenance, green focused/build checks, live built-page interaction evidence, independently approved summaries, preserved landing and runtime work, and truthful platform/release limitations. No fake installers, parallel docs copies, dangling links, new paid service or hidden full-suite run.

## Stop and report to root

Report a missing authoritative corpus/figure contract, unsupported release claim, screenshot requiring real private data, necessary runtime edits, or a new dependency/hosting cost. Resolve content truth with source evidence; do not fill gaps with invented UI or claim support that has not shipped. Continue independent safe work while root resolves the specific issue.
