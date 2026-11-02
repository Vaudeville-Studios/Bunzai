# RP-Core Director list windowing

This evidence covers the follow-up to commit `1e5ca2b8521e081130025e33c3e40d2a9815048a`; that commit was stopped before any remote update. The follow-up uses the existing `VirtualRows` owner for the Director's variable-height records and preserves all five sections, their order, empty states, row content, seed payoff/status, and Memory's 20-entry pages.

## Verification

- RED before windowing: `bun test ./src/ui/apps/scenes/scene-core-wing.test.tsx --timeout 120000` failed the large-list contract (`324` mounted rows; expected fewer than `60`); the three existing tests passed.
- GREEN after windowing: the same focused test file passed 4 tests / 15 assertions.
- Shared virtualizer plus component: `bun test ./src/ui/apps/scenes/scene-core-wing.test.tsx ./src/ui/_shared/virtual-list/core.test.tsx ./src/ui/_shared/virtual-list/rows.test.tsx --timeout 120000` passed 20 tests / 46 assertions.
- `bun run typecheck` exited 0; `bun run scan:lines` exited 0.
- Browser proof used Bun 1.4.2 (`744846f84`) and cached Playwright Chromium 149 (`ms-playwright/chromium-1228`), with a fresh task-owned user-data directory and redirected task profile paths. It mounted the production `CoreWing` and `WingFrame`, `SCENE_STYLE`, `WING_STYLE`, `MEMORY_STYLE`, and `tokens.css`. On the actual `.scs .wbody.mm` scroller, computed `overflowY` was `auto` and `clientHeight` was `804px`. First view mounted 33 rows, showed the first row within the viewport, and did not mount the last. After scrolling, 12 rows were mounted, the first was absent, and the full final row (`Seed entry 319 · Payoff: opens the east gate · pending`) was visible at y=194..217; `scrollTop=15781`, `scrollHeight=16585`. Page errors: none.

First viewport screenshot: `C:\Users\chiev\AppData\Local\Temp\bunzai-core-wing-browser-LYIiVq\director-first-viewport.png` (SHA-256 `b2d1b0f6a92a67c9410cbb2728440bd3661da315a75e5f3202631197303fc28e`).

Late viewport screenshot: `C:\Users\chiev\AppData\Local\Temp\bunzai-core-wing-browser-LYIiVq\director-late-viewport.png` (SHA-256 `0d21122a5f8854adba819e1c9aad1ef64052328cfa641ef511014af71ec056af`).

## Source identity

| File | SHA-256 |
| --- | --- |
| `src/ui/apps/scenes/scene-core-wing.tsx` | `AEEA709FCA2178C4C80EF7FF572A42C18E84A11DEB07BC91151F2BFBD8C402BF` |
| `src/ui/apps/scenes/scene-core-wing.test.tsx` | `18EDE802AB8DCA5D25A614AE5531D77C08027B1283974F0ED6D1CA7DD4496838` |
| `src/ui/apps/scenes/scene-style.ts` | `557099F8F8B65FA6166B2C3A847DF4A5ADDF2C07BDD8D182AE47129C104AD1B0` |
| `src/ui/apps/scenes/scene-wing-style.ts` | `6FD2A234C64649901B4156D8C3B36B148B9A511A015D7AD2990191FAD01CF80C` |
| `src/ui/apps/scenes/context/memory-style.ts` | `60F420CF9C8A1A1FE8120770239D72AE3B6AA129C0400737FB300B85FBDFC0C0` |
| `src/ui/apps/scenes/scene-wing-frame.tsx` | `F250C472E913776FF338D31ED601B790B2923DCB1B0229A13D37B02FDE18468D` |
| `src/ui/_shared/virtual-list/rows.tsx` | `1673975E1F564651B8D7046BE85B014C064329F65CF219B12F3FE072CC3E0741` |
| `src/ui/theme/tokens.css` | `47BCDCEDE2611180711D8498C58A669696FBC53FA8998CAAF8FC4757075EE911` |

`docs:summaries:check -- reference/ui --author` passes with 11 existing warnings. The global docs index and summary checks were run before refreshing the `reference/ui` approval receipt and correctly reported stale generated projections; they are not claimed green yet.

The refreshed page source hash is `sha256:88439556c9741158180da24f9cb9a18f6784b20d200227d3137a2e6e31f83b72`; the updated semantic summary hash is `sha256:381e786ee3c082d54e314f0875266c2edd8fabaec49e30017e7b4544dbb83d87`. The page summary's independent approval receipt and derived indexes remain pending review/regeneration.
