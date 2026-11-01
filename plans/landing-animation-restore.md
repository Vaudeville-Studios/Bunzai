# Landing animation restoration provenance

The screen opening adapts the recovered Vaudeville sequence from the read-only archive at
`C:\Users\chiev\Documents\VAUDEVILLE\apps\rc\src\components\coming-soon\PrerollSequence.tsx`
(SHA-256 `57DAEBDA61A6FE258AFAE84D136952920D50F4D2A8DB13EED06A14088B34B67A`). The companion
prototype is `C:\Users\chiev\Documents\VAUDEVILLE\wireframes\preroll\preroll-combined-final.html`
(SHA-256 `50829B6561A2514DD551E874BEAC13271973EED7AFF49DDB62D833655D2CF963`). Neither archive
file was modified. The static version keeps the five-second production and NOBUNNY cards, the
original Shakespeare phrase/timing table, skip, and the original ending hold. It replaces the old
beta claim with an independent-production credit and ends on Bunzai's requested `All the worlds:
your stage` tagline.

The full-frame curtain entrance is separate from the screen film. The supplied six-second
`curtain-opening.webm` / `curtain-opening.mp4` and `curtain-closed.webp` poster are copied unchanged
from the original Bunzai checkout. Their source SHA-256 values are `28B409D3F0302820A1779DED9BB87005551A88D70B07703C1E489F401B917159`,
`B71C35755D38E6FBCAA01ACCCA7BA703604D3E6B25D784F6E63B2534AF1C39EC`, and
`EAFE906C168BCA09AA23D50EB81EF0783C4985FD2AC93AAF694333EB3AA7341B`. The curtain assets are never
used as the projected film.

The existing `docs/media/bunzai-preview.png` social card is refreshed from a 1200x630 Chromium
capture of the built initial landing screen so the shared tagline agrees with the public page. The
capture is emitted by `scripts/landing-animation-proof.ts` as `open-graph-preview.png`.

The source change was authored in `C:\Users\chiev\Documents\Bunzai-landing-animation` on
`feature/landing-animation-restore` from `Bunraku-publish` HEAD `fea0b2c` and committed as
`411c9f3`. For delivery it was applied to `C:\Users\chiev\Documents\Bunzai-page-delivery`, branch
`deliver/page-and-native-branding`, based on `origin/Mainstage` `6f1febf`. The UI document retains the
Mainstage Core/runtime and theme sections; only its public landing description changes. Root reviewed
the delivered source at SHA-256
`2957AC159B95F2CFD62BF0C3B5CFAE78C8C1CB48AEF1F9A4E81E9A84CE2FBCE7`, and approved its semantic
projection for documentation accuracy. This is not a release or security approval. The original
checkout, stopped delivery worktree and recovered archive remain untouched.

The parallel extension-runtime branch also edits `docs/reference/ui.md` and its generated semantic
metadata. Reconcile that file during merge: preserve the accurate static Pages entrance paragraph
from this branch alongside the extension-runtime material, rather than replacing either branch's
section wholesale.

## Verification

The static Pages build produced 37 website pages, with 12 apps, 4 setup steps and 133 documentation
pages under `studio/`. Focused tests passed 14 cases with 186 assertions. The Chromium proof exercised
the built site at `http://127.0.0.1:8899/Bunzai/`: initial frame, click-gated
curtain progress, both production cards, the word run, final tagline, first and next feature pictures,
and mobile reduced-motion entry. It reported zero page errors and confirmed the reduced-motion path
did not load the curtain video. Screenshots are under the ignored
`dist/landing-preview/evidence/` directory, including `desktop-curtain-progress.png`,
`desktop-nobunny-card.png`, `desktop-final-tagline.png`, `desktop-feature-picture.png`,
`mobile-reduced-feature-picture.png`, and `open-graph-preview.png`. The last capture is the source
for the refreshed 1200x630 `docs/media/bunzai-preview.png` social card.

The standard Desktop build also passed. An isolated Windows profile and ephemeral loopback port
verified HTTP 200, the `Bunzai.` native window title and owning process, matching large and small
`WM_GETICON` bitmaps against the compiled executable icon, and a cached WebView DLL matching the
packaged source hash. Closing the window exited cleanly and closed the listener. The run used no
`WEBVIEW_PATH` override; executable SHA-256 was
`739455A136276505E1D2CA460578164C9E7F3E347BAE3F8BD46F90ABB9017D02`.
