---
id: reference/extending/make-a-theme
title: Make a theme
audience: dev
summary: How to author a Bunzai theme package, a manifest that picks host-built layout variants for 30 surfaces and sets a checked palette, fonts, frame shape, motion and accent behavior, and can go further with one checked stylesheet, its own fonts and images, and content in named slots, with a copy-paste starter.
tags: [extending, theme, appearance, palette, surfaces, contrast, styles, fonts, slots, parts]
related: [reference/architecture, reference/ui, reference/extending/add-a-format]
---

# Make a theme

A theme is a folder of data and, if it wants more power, one checked stylesheet. It never ships TSX,
JavaScript or HTML into the page. Bunzai builds every layout variant itself; a theme **selects** variants
and **sets** checked values. A theme that carries code, an external URL, a raw color word in its
descriptor or a radius is rejected when it is inspected, not when it is drawn. The stylesheet, fonts,
images and slots described under [Going further](#going-further) are checked the same way, and none of
them may name the protected layer.

Five themes ship. Four are each a different app rather than a recolor: Theater (an opera house playbill),
Encore (a game HUD), GirliePop (a sticker scrapbook and chat app) and Paper (a manuscript on a writing
desk). The fifth, RoleCall, is the default for a studio with no saved theme and is a recolor on purpose: RoleCall's
own palette, Cinzel and Inter, a thick stamped frame, and no surface picks, so it draws the core rendering. Each
theme's catalog entry reports a difference score: the share of the 30 registered surfaces where it picks
a variant that no other listed theme picks. The four identity themes must stay at 50 percent or more
(`src/extensions/theme-difference.test.ts`); RoleCall is exempt by name in `COLOUR_ONLY_THEMES`, and the test requires
an exempt theme to pick no variants at all. That score counts manifest picks only; it says nothing about the
screens the 30 surfaces do not cover. `bun run theme:measure` screenshots each screen in its inventory in the four
themes and reports the share that looks structurally different, colour and lettering aside: during capture all text
is set in one font and made invisible, so only boxes, frames and layout are compared. A screen counts as different only
when it is farther from every other theme than two negative controls are: Theater with Paper's colours forced over it,
and Theater with Paper's font faces forced over it. The report also says how much a font swap alone could fake. The
protected gate screens (lock, recovery words, load-in) cannot be themed, so they are listed and not scored. It needs
Chrome, so it is a manual gate and not part of `verify:ci`.

Built-in themes get no power a package lacks. Every built-in look comes from a surface pick or a checked value, and
`bun run scan:theme-keys` (part of `verify:ci`) fails on host CSS or TypeScript that selects on a theme id. A copy of a
built-in manifest under a new id paints the same root attributes, custom properties and mod styles
(`src/ui/shell/theme-copy-equality.test.ts`).

## What a package is

```
bunzai.theme.mine/
  manifest.json     the descriptor below
  LICENSE.txt       optional, shown before approval
  assets/*           optional images the manifest names: inert SVG, PNG or WebP
  fonts/*.woff2     optional fonts the stylesheet uses
  styles.css        optional, the one checked stylesheet
```

The Appearance section of Settings imports it as one JSON envelope,
`{"manifest": {...}, "assets": {"assets/name.svg": "<svg ...>", "assets/art.png": "<base64>", "styles.css": "..."}, "licenseText": "..."}`.
SVG and CSS travel as text and PNG, WebP and woff2 as canonical base64. The host-baked
Encore example (`src/extensions/examples/bunzai.theme.encore/`) can be downloaded in that shape. The
bundled themes live under `src/extensions/themes/`; folder discovery is the only list, so a new folder is
a new theme.

## The manifest

`schemaVersion` is `2`. Every field below is required except `styles`, `fonts` and `slots`, and an unknown key anywhere is an error.

| Field | Value |
| --- | --- |
| `id` | `bunzai.theme.<name>`, 2 to 59 characters of `a-z 0-9 . -` after the prefix |
| `version`, `name` | semantic version, display name (80 characters at most) |
| `requests` | the permission scopes, which must equal the scopes the manifest derives (see below) |
| `appearance.surfaces` | `{ "<surface id>": "<variant id>" }`; any subset of the 30 surfaces |
| `appearance.palette` | `surface`, `line`, `text` and `roles` colors, lowercase `#rrggbb` only |
| `appearance.type` | `display`, `ui`, `body`, `mono` font ids and a `scale` step of 0, 1 or 2 |
| `appearance.shape` | `frame` style, `frameWidth` 1 to 3, `density` and `motion` profile, and the `chrome` sizing |
| `appearance.accent` | `{ "follows": "user" }` or `{ "follows": "locked" }` |
| `appearance.marks` | optional asset ids: `dock` (retained legacy dock mark; the overlay does not mount it) and `bookFrame` (library frame) |
| `assets` | images, 24 at most: `{ "id", "path": "assets/<name>.svg", "mediaType" }`. SVG is checked as inert and is 96 KB at most; PNG and WebP are checked for structure and are 128 KB at most. No animation |
| `styles` | optional, the string `"styles.css"`: one checked stylesheet of 64 KB at most |
| `fonts` | optional, 4 at most: `{ "id", "path": "fonts/<name>.woff2", "mediaType": "font/woff2" }`, 128 KB at most each, and the stylesheet must use each one |
| `slots` | optional, content placed in named slots; see [Going further](#going-further) |

### Surfaces and variants

A surface is a place where the app can look different. A theme names one variant per surface it wants to
change. A surface the theme leaves out, or a variant the host has not built yet, renders as the current
rendering (`core`). Every variant keeps every control and every piece of data; only the arrangement and
the look change. The variant order below is Theater, Encore, GirliePop, Paper.

| Surface | Variants |
| --- | --- |
| `shell.nav` | Bottom dock cosmetics: `playbill-rail` stronger border; `hud-bar` square double-weight border; `tab-bar` raised panel; `index-rail` flat square panel. Every variant retains the same bottom placement and navigation behavior. |
| `shell.overlay` | `gilt-widgets` fine outer rules; `hud-widgets` mono headings and crisp shadows; `sticker-widgets` slab shadows; `ink-widgets` quiet ruled panels. All retain the same square floating overlay layout, working app window, optional App shortcuts and import flow. App selection stays in the overlay; Open full workspace explicitly returns the same app instance to the canvas. Selected through the existing `appearance.surfaces` grant; palettes and fonts retain their own existing grants. |
| `shell.title` | `proscenium` curtain-framed premiere landing; `attract` arcade attract screen; `sticker-splash` scrapbook splash; `title-page` book title page |
| `shell.status` | `footer-line` one thin contextual line below the top chrome; `hud-strip` segmented readout strip; `chip` small chips; `margin-note` footnote-style note in the margin |
| `library.grid` | `covers` portrait covers on shelves; `inventory-slots` numbered slot grid; `sticker-wall` sticker wall; `catalog-list` dense catalog list |
| `library.card` | `playbill-cover` playbill cover; `item-card` item card with slot number; `sticker-card` thick-bordered sticker; `index-card` ruled index card |
| `scenes.list` | `marquee-hero` marquee hero over a list; `save-file-slots` save-file slots; `chat-list` chat list; `table-of-contents` table of contents |
| `ui.dialog` | `curtain-card` card under a curtain rule; `menu-window` game menu window; `pop-card` pop-up card; `margin-sheet` sheet in the margin |
| `ui.toast` | `program-slip` program slip; `hud-ticker` HUD ticker; `bubble` speech bubble; `footnote` footnote. A toast never covers the page: the first three sit inside the status row and `footnote` stays in the status line |
| `ui.empty` | `spotlight` spotlit empty stage; `no-data-panel` no-data panel; `doodle` doodle; `blank-page` blank page |
| `ui.panel` | `gilt-frame` thin gold rule frame; `bracket-frame` corner-bracket frame; `slab-frame` thick slab frame; `ruled-frame` hairline ruled frame |
| `ui.meter` | `thin-rule` thin rule; `segmented` segmented bar; `chunky-pill-bar` chunky bar with square ends; `ink-tally` ink tally marks |
| `ui.icons` | `engraved`, `pixel-crisp`, `filled-cute`, `line-ink`: one icon set in four render styles |
| `ui.toolbar` | `playbill-bar` ruled bar of find, scope, art size, select all and import; `hud-command-bar` boxed command bar; `sticker-shelf` shelf of thick-bordered stickers; `margin-ruler` ruler line under the margin. The Library and Scenes filter rows |
| `library.decks` | `program-list` playbill-style deck list; `inventory-tabs` inventory tab stack; `sticker-stack` stack of stickers; `chapter-index` chapter-index list. The Library's deck sidebar |
| `ui.section-header` | `engraved-title` engraved title between gold rules; `slot-header` numbered slot header bar; `banner-tag` banner tag; `chapter-heading` chapter heading with a rule |
| `ui.tabs` | `rule-tabs` tabs on a rule; `menu-cursor` game menu with a cursor mark; `pill-row` chunky square pill row; `underline-ink` ink underline. The segmented tabs (view, layout, order, period) |
| `ui.label-type` | `small-caps-serif` small-caps serif lettering; `caps-mono` capital monospace; `rounded-sentence` sentence-case rounded lettering; `italic-serif` italic serif. Buttons and labels, never `.host-protected` |
| `scene.layout` | `stage-column` prose column on a stage; `vn-stage` visual novel stage; `chat-thread` chat thread; `manuscript` manuscript page |
| `scene.message` | `prose` prose with the speaker in small caps; `vn-box` name plate and text box; `bubble` chat bubbles with avatars; `screenplay` screenplay layout |
| `scene.composer` | `prompt-line` prompt line; `command-box` command box; `chat-input` chat input; `typewriter-line` typewriter line |
| `scene.swipes` | `arrows-count` arrows and a count; `key-chips` key chips; `dots` dots; `margin-numbers` numbers in the margin |
| `scene.wings` | `side-curtain` side curtain; `pause-menu` pause menu; `drawer` drawer; `marginalia` marginalia |
| `scene.hud` | `quiet-line` quiet line (no readout); `full-hud` full HUD; `chips` chips; `footnotes` footnotes. Every variant except `quiet-line` adds a readout line (take, message count, model) |
| `scene.reasoning` | `program-note` thin margin bar, flush for native reasoning and dashed for tag thinking; `slot-tab` numbered label tab on a thin frame; `slab-note` solid header slab for native, plain card for tags; `footnote` hairline rules and numerals, no fill. The two thinking blocks above a reply; with no pick, RoleCall's own two cards without the glass |
| `editor.frame` | `two-pane` two panes; `tabbed-menu` tabbed menu; `card-stack` card stack; `long-form` long form. Rearranges the character, persona, sprite pack, HTML doc, preset, lorebook, regex and quick reply editors: each editor declares its sections and the shared layout lays them out. With no pick, each editor keeps its own arrangement |
| `editor.fields` | `labeled-rows` labeled rows; `stat-sheet` stat sheet; `cards` cards; `form-on-paper` form on paper |
| `settings.shape` | `program-sections` program sections; `options-menu` options menu; `big-toggles` big toggles; `contents-page` contents page |
| `app.room` | `ledger-rail` ledger rail (side rail beside a wide main, thin rules); `hud-console` HUD console (each room gets a bracket-framed command or status block); `sticker-tray` sticker tray (main on the left, status and actions as a chunky tray on the right); `manuscript-column` manuscript column (one narrow centred page, side parts below as an appendix). Arranges the setup wizard, the Press, the Agent room and the CSS Workshop. Every part stays in every variant |
| `ui.controls` | `quiet`, `game`, `sticker`, `ink`: control chrome, always square. The host paints it into one style element in the page head, and it never reaches `.host-protected` surfaces |

The ids live in one module, `src/extensions/surface-registry.ts`. The registry test fails if a variant
folder under `src/ui/` names an id that is not listed there.

### Palette

Colors are lowercase six-digit hex, nothing else: no names, no `rgb()`, no short forms, no URLs.

| Group | Keys |
| --- | --- |
| `surface` | `well` (stage, rails), `base` (app canvas), `sunken`, `field` (inputs), `panel` (cards, dialogs), `raised` (chips on a panel), `ink` (key caps, status bar) |
| `line` | `strong` (frame edges), `line` (dividers), `track` (meter tracks), `control` (input and switch boundary), `focus` (focus ring) |
| `text` | `text`, `soft`, `dim`, `faint`, `onTint` (ink on a role fill), `onDeep` (ink on a deep fill) |
| `roles` | `brand`, `action`, `select`, `ok`, `warn`, `danger`, `info`, each with `fill`, `text` and `deep` |

One jewel hue carries one meaning. `brand` is the logo and one highlight, never a state. `action` is
primary actions and links, `select` is the current item, `ok`, `warn` and `danger` are statuses, and `info`
is readouts. A role's `fill` sits under `onTint` text, its `text` is the hue as text or a mark, and its
`deep` sits under `onDeep` text.

**Contrast is checked at inspection.** A palette that misses any floor is rejected and the message names
the failing pairs:

- `text.text` is 7:1 on every surface except `ink`.
- `text.soft`, `text.dim`, `text.faint` and every `roles.*.text` are 4.5:1 on every surface except `ink`.
- `line.control` and `line.focus` are 3:1 on every surface except `ink`.
- `text.text` and `text.dim` are 4.5:1 on `surface.ink`.
- `onTint` is 4.5:1 on every role `fill`, `onDeep` is 4.5:1 on every role `deep`, and every role `text`
  is 3:1 on `line.track`.

### Type, shape and accent

- `type.display` is one of `archivo`, `cinzel`, `fraunces`, `atkinson`, `fredoka` (a rounded face);
  `type.ui` (labels, tabs, buttons and the text of a scene's wings) is any of those, `inter` or `system-ui` (the platform sans);
  `type.body` one of `archivo`, `atkinson`, `fraunces`, `inter` or `system-ui`; `type.mono` is `plex-mono`, `courier-prime`
  (a typewriter face), `jetbrains-mono` or `system-mono` (the platform monospace). These are the fonts Bunzai ships; to add a face of your own, use `fonts`
  and `styles` (see [Going further](#going-further)). `type.scale` of 1 or 2 enlarges body text by 6 or 12 percent, and body text
  never goes below 16px.
- `shape.frame` is `rule`, `double`, `bracket`, `slab` or `stamp`; `shape.frameWidth` is 1, 2 or 3 pixels;
  `shape.density` is `dense`, `comfortable`, `roomy` or `airy` and scales the spacing; `shape.motion` is
  `none`, `calm`, `snappy` or `bouncy`. `shape.chrome` is `bunzai` (square corners, the 12px text floor) or `rolecall` (RoleCall's corner radii, small-label sizes,
  zinc steps and wing colors, painted dark); there is no other radius field, and the frame style may vary but the radius may not. Reduced motion always wins over `shape.motion`.
- `accent.follows: "user"` maps the accent color picked in Settings onto the `brand` role, and its neighbours
  28 degrees either side on the colour wheel onto the `action` and `select` roles, with the deep and text tones
  derived so they stay readable. `"locked"` ignores the pick.

## Permissions

`requests` must list exactly the scopes the manifest uses: `appearance.palette`, `appearance.type`,
`appearance.shape`, `appearance.surfaces` and `appearance.accent`, plus `appearance.assets` when `assets`
is not empty, `appearance.styles` when there is a stylesheet, `appearance.fonts` when there are fonts and
`ui.slots` when any slot has an item. A package can do nothing else; it receives no library access, credentials, network or
execution. The installer shows the derived scopes and the package digest before it asks for approval.
Approval is bound to that digest, so any edit to the manifest, an image, a font, the stylesheet or the license text makes the
package inactive until it is reviewed again, and an update that adds a scope waits for approval while the old package keeps serving. Disable and revoke return the app to the core appearance.

The protected layer is never themeable. The lock screen, recovery words, the Kit Gate and the theme and
mod manager keep their own host colors and fonts no matter what a theme sets.

Beyond the gates, these controls are drawn inside the protected layer (the `protect()` helper in `src/ui/_shared/protected-control.tsx`
puts one element in it; `src/ui/protected-set.test.ts` holds each to the file that owns it). A mod cannot restyle, hide or relabel them:

- Prompt Inspector Send and Stop
- Provider keys and models (Settings > Providers)
- MCP connections (Settings > Connections)
- Spotify sign-in and Client ID
- Narrator Tool Access and Max tool rounds
- Compendium per-book access grants
- Scene regex set switches and deletes
- Delete and restore of takes
- Delete and restore of lorebook entries
- Remove and restore of participants
- Delete and remove of tracker items
- Story Director model and connection
- Dramaturg model and connection
- Story Director Reset DM

## Copy-paste starter

This starter validates as it stands (a test parses this block). It is Encore's descriptor without its SVG
marks. Change the id, the name and the values, keep `requests` equal to the derived scopes, and import it.

```json
{
  "schemaVersion": 2,
  "id": "bunzai.theme.starter",
  "version": "1.0.0",
  "name": "Starter",
  "requests": [
    "appearance.accent",
    "appearance.palette",
    "appearance.shape",
    "appearance.surfaces",
    "appearance.type"
  ],
  "appearance": {
    "surfaces": {
      "shell.nav": "hud-bar",
      "shell.title": "attract",
      "shell.status": "hud-strip",
      "library.grid": "inventory-slots",
      "library.card": "item-card",
      "scenes.list": "save-file-slots",
      "ui.dialog": "menu-window",
      "ui.toast": "hud-ticker",
      "ui.empty": "no-data-panel",
      "ui.panel": "bracket-frame",
      "ui.meter": "segmented",
      "ui.icons": "pixel-crisp",
      "ui.toolbar": "hud-command-bar",
      "library.decks": "inventory-tabs",
      "ui.section-header": "slot-header",
      "ui.tabs": "menu-cursor",
      "ui.label-type": "caps-mono",
      "scene.layout": "vn-stage",
      "scene.message": "vn-box",
      "scene.composer": "command-box",
      "scene.swipes": "key-chips",
      "scene.wings": "pause-menu",
      "scene.hud": "full-hud",
      "editor.frame": "tabbed-menu",
      "editor.fields": "stat-sheet",
      "settings.shape": "options-menu",
      "app.room": "hud-console",
      "ui.controls": "game"
    },
    "palette": {
      "surface": {
        "well": "#03060f",
        "base": "#070b18",
        "sunken": "#0b1124",
        "field": "#060a15",
        "panel": "#111a33",
        "raised": "#1a2547",
        "ink": "#02040a"
      },
      "line": {
        "strong": "#7d9cf0",
        "line": "#28365e",
        "track": "#232f55",
        "control": "#8aa4e6",
        "focus": "#ffd23f"
      },
      "text": {
        "text": "#f4f7ff",
        "soft": "#d9e2fb",
        "dim": "#b9c6e8",
        "faint": "#9aa9d0",
        "onTint": "#06091a",
        "onDeep": "#ffffff"
      },
      "roles": {
        "brand": {
          "fill": "#ff7a45",
          "text": "#ff9a6b",
          "deep": "#a8420f"
        },
        "action": {
          "fill": "#5c9dff",
          "text": "#82b4ff",
          "deep": "#2758a6"
        },
        "select": {
          "fill": "#b48cff",
          "text": "#c4a3ff",
          "deep": "#6a4ca6"
        },
        "ok": {
          "fill": "#3ee08f",
          "text": "#3ee08f",
          "deep": "#036b39"
        },
        "warn": {
          "fill": "#ffb83d",
          "text": "#ffb83d",
          "deep": "#7c4d00"
        },
        "danger": {
          "fill": "#ff5a67",
          "text": "#ff7a85",
          "deep": "#a62530"
        },
        "info": {
          "fill": "#2fd9cf",
          "text": "#2fd9cf",
          "deep": "#006963"
        }
      }
    },
    "type": {
      "display": "archivo",
      "ui": "archivo",
      "body": "archivo",
      "mono": "plex-mono",
      "scale": 0
    },
    "shape": {
      "frame": "bracket",
      "frameWidth": 2,
      "density": "dense",
      "motion": "snappy",
      "chrome": "bunzai"
    },
    "accent": {
      "follows": "user"
    },
    "marks": {}
  },
  "assets": []
}
```

## Going further

The descriptor above is tier zero: it picks and sets. Four optional fields go further, each through the same
install, approval, update and revoke path, and each adds one scope that the installer shows in plain words.
[Encore](../../../src/extensions/examples/bunzai.theme.encore/README.md) uses all of them and its README walks
through each one.

### Parts: stable names to aim at

App-specific overlay widgets are trusted packaged app exports, not theme code. Their shared frame inherits `shell.overlay`; `[data-part="shell.overlay.widget"]` selects a widget and `[data-overlay-app="library"]` narrows to its discovered app id. Custom stylesheet rules still require `appearance.styles` and digest-bound approval. No widget execution, import, navigation or secret-access grant is created for themes.

Every surface root and its key parts carry `data-part="<surface>.<part>"`, for example `shell.overlay`,
`library.card`, `scene.message` or `editor.section`. The names are the contract: a part can move or change
tag between releases, and its name stays. The full list is generated from the component sources, so it is never
out of date: [docs/generated/theme-parts.md](../../generated/theme-parts.md). Prefer a part name over a host
class name, which is an implementation detail.

A part name is a dotted, lowercase literal. Where one component draws many things of a kind, the page lists a
family such as `props.tracker.<id>` or `scene.popout.<id>`, and `<id>` is a stable id (a prop, a tracker module,
a pop-out kind, a settings section), never the visible label, so a rename or a translation never breaks your
styles. The scene's wing panels share one name, `scene.wings.panel`, and carry the wing in `data-wing`
(`booth`, `cast`, `prompting`, `world`, `finalcut`, `props`, `ai`, `stage`, `context`), so
`[data-part="scene.wings.panel"][data-wing="world"]` is the World wing. `bun run scan:parts` fails the build when a
wing, tab or pop-out ships without a part, or when a part is undotted or keyed on a label.

Your rules do not out-rank a host rule by being later alone. The scope adds no specificity, so a plain
`[data-part="x"]` rule (specificity 0,1,0) loses to a host rule written as a class chain (for example
`.scs .cp-chipp button`, 0,2,1). Raise yours until it is higher (repeat the attribute selector, or add the part's own class) or, as a last
resort, use `!important`. Class chains like that exist in the host, so check the result in the scene before you ship.

### Styles: one stylesheet, any selector

`"styles": "styles.css"` ships one checked CSS file (`appearance.styles`). It can hide, move, restyle,
re-lay-out and animate anything outside the protected layer.

```css
[data-part="library.card"]:hover { outline: 2px solid var(--bk-role-warn); }
[data-part="shell.status"]::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: var(--bk-role-action); }
```

The file is tokenized and checked as a whole; one bad token refuses the package. It may not contain:

- `@import`, or any `url()` that is not `url(asset:<id>)` naming a file in the package;
- `@font-face` whose `src` is not one package font, or that redefines a family Bunzai ships (Archivo, Cinzel, Fraunces, Atkinson Hyperlegible, IBM Plex Mono, Fredoka, Courier Prime, Inter, Lexend, OpenDyslexic, Crimson Pro, Playfair Display, JetBrains Mono);
- rules nested inside rules, `attr()`, `image-set()`, `expression()`, `behavior` or `-moz-binding`;
- `@keyframes` that reuse a host animation name;
- `--host-*` properties, or any selector, attribute value or string that names the protected layer.

Allowed at-rules are `@media`, `@supports`, `@container`, `@keyframes` and `@font-face`. The palette
arrives as `--bk-*` custom properties (`--bk-surface-panel`, `--bk-role-brand`, `--bk-text`, `--bk-line-strong`),
so a stylesheet can follow the palette instead of repeating hex values.

A scene also paints the character's and the persona's own colors as scoped tokens on its container: `--bk-character-accent`,
`--bk-character-accent-text` and `--bk-character-accent-deep`, and the same three with `persona` and with `scene` (the colour the replies and the scene's panels wear, by the Stage wing's Scene accent source). They are already nudged in
lightness to stay readable on your palette, and they are unset when a piece has no color, so write
`var(--bk-character-accent, var(--bk-role-brand))` to fall back. Protected surfaces never see them.

Your rules load last and are unlayered, so they override the host's normal rules at equal specificity. They
do not match the protected layer: Bunzai adds a zero-specificity `:where(:not(.host-protected, .host-protected *))`
to the subject of every selector, and the protected root redeclares the theme tokens in a higher cascade layer
with `!important`. While a protected prompt is on screen, a watchdog checks that it is visible, sized, in place and
clickable. If your styles cover it, Bunzai drops the styles and slots at once, keeps the prompt up, and revokes
the theme with a `broken` audit record; enabling it again needs fresh approval. A mod is hardened against, not
isolated from, the protected layer: it can still restyle ancestors, and the watchdog catches the visible cases.
`bunzai ui --safe-themes` (or `BUNZAI_SAFE_THEMES=1`) resolves every theme to core for one launch.

### Fonts

`fonts` ships up to four `woff2` files (`appearance.fonts`). Declare each in `styles.css` with
`@font-face { font-family: "Name"; src: url(asset:<font id>) format("woff2"); }` and use it like any family.
Ship only fonts whose license lets you, and include that license in `LICENSE.txt`; Encore bundles
Silkscreen under the SIL Open Font License. Keep body text on a readable face.

### Images

`assets` takes SVG, PNG and WebP (`appearance.assets`). Reference one from CSS as `url(asset:<id>)`, from a
slot item by id, or from `marks` as before. Every file is served by Bunzai from its own digest URL; a page
never loads an image from anywhere else.

### Slots: content in named places

`slots` places static content where the host reserved room (`ui.slots`). An item is data, drawn by Bunzai:

- `{ "kind": "image", "asset": "<image id>", "alt": "..." }`
- `{ "kind": "text", "text": "...", "class": "mod-<name>" }`, at most 280 characters,
  always drawn as text and never as HTML. A class must start with `mod-` (the host never uses that prefix) and your stylesheet must
  define it as a rule whose selector is exactly that class, such as `.mod-banner { ... }`; any other class is rejected.

A slot holds 1 to 4 items and a package 24 in all. An empty slot adds nothing to the page.

| Slot | Where it is drawn |
| --- | --- |
| `shell.nav.start`, `shell.nav.end` | decorative slots at the beginning and end of the bottom dock |
| `shell.title.below` | end of the title screen |
| `shell.status.end` | end of the status line |
| `library.header` | top of the Library page |
| `library.empty` | the Library's first-run landing |
| `scenes.header` | under the Scenes heading |
| `scene.backdrop` | behind the messages of a scene, over the person's own backdrop picture when the scene has one |
| `scene.composer.above` | above the message box |
| `scene.director` | the top of the Story Director panel, above its hero |
| `editor.header.end` | the top corner of every editor |
| `settings.header` | top of the open Settings section |
| `scene.wing.<wing>` | the top of that wing's panel, above its tabs; `<wing>` is one of `booth`, `cast`, `prompting`, `world`, `finalcut`, `props`, `ai`, `stage`, `context` |
| `scene.wing.<wing>.<tab>` | the top of that tab's body: `cast` (`character`, `persona`, `participants`), `prompting` (`preset`, `guides`, `note`, `tools`), `world` (`lorebook`, `compendium`), `finalcut` (`cut`, `regex`), `ai` (`model`, `generation`), `stage` (`appearance`, `gallery`, `music`, `spotify`, `wardrobe`), `context` (`inspector`, `memory`) |

Each slot is wrapped in an element named `slot.<id>`, and its items are `slot.text` and `slot.image`, so your
styles can place and size them. Interactive slot content is not possible yet; it waits for the extension
runtime and its grants.

```json
{
  "slots": {
    "library.header": [
      { "kind": "image", "asset": "crest", "alt": "Encore crest" },
      { "kind": "text", "text": "Player one ready", "class": "mod-banner" }
    ]
  }
}
```

### What the installer shows

A package that uses all four powers asks for `appearance.styles`, `appearance.fonts`, `appearance.assets` and
`ui.slots` on top of the descriptor's five, and the approval is bound to the digest of every file. An update that
adds a scope waits for approval again. Revoke removes the styles and slots at once and returns to the core
appearance.

## Checking your work

1. Import the envelope in Settings, Appearance, and read the review. An appearance error names the field or the failing contrast pair; a bad envelope, id or asset path reports only that the package is invalid.
2. Compare your surface picks with the matrix printed by `bun test src/extensions/theme-difference.test.ts`.
3. Open every screen in your theme. Variants that Bunzai has not built yet show the current rendering.
