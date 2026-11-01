# The visual app (bunzai ui)

`bunzai ui [port] [studioDir]` boots the primary local studio: a loopback Bun server (default
`127.0.0.1:8321`) serving the shell and a JSON API that is a thin skin over the same engine the CLI
uses. Optional remote listeners are separately enabled and gated. One engine, two shells - no format
logic exists in the UI layer.

Native desktop builds use host-specific output names and Windows-only executable flags. On Linux, the desktop host detaches the launcher environment before window startup and names its GTK process `bunzai`. A private, owned `XDG_RUNTIME_DIR` can hold a content-checked copy of the bundled native library, published through the shared atomic writer with private permissions; invalid caches fall back to normal loading. Pinned Bun 1.3.14 tests cover launcher-variable removal and cache integrity. A compiled extraction probe passes with an unusable `TMPDIR`; actual GTK4 window launch and close are unverified because the test host lacks GTK4. Linux desktop release artifacts are not currently published.

## Velvet premiere landing

Fresh launches use the velvet theater title screen in `shell/TitleScreen.tsx`.
The curtains, scenery and footlights are locally shipped artwork (`docs/media/velvet-premiere-wide-unlit.png`,
`velvet-premiere-tablet-unlit.png` and `velvet-premiere-phone-unlit.png`);
the wordmark, tagline, navigation and actions are live HTML. The artwork has no painted overhead
beams, colored light pools or fog; deeper ambient
shadows make the live effects stand out. Warm front-edge footlights remain in the artwork.
A 90% dark overlay dims the artwork beneath the live lights and fog.
Enter the theater keeps boot's chosen room. Continue your story resumes the most recently updated
scene through the existing scene handoff, or opens Scenes when none is available. The Now playing
frame reads the real scene-list API; empty and failed reads show guidance rather than sample stories.
The reusable `components/proscenium/` uses `docs/media/now-playing-proscenium.png`, a transparent
frame asset extracted from the selected reference: textured black molding, scalloped ruby curtains,
a central divider and a riveted hanging gold sign. Scene artwork and HTML controls occupy the clear
apertures underneath; the overlay does not intercept input. On narrow panes the art fills both
apertures and the controls move beneath the intact frame. Artwork uses the frozen portrait endpoint and visibility-gated
cache as Scenes; missing artwork shows the character initial. A portrait the server answers with 404 or 410 is fetched once per art identity and every mount shares that answer; any other failure is retried on the next ask. Quick Start combines a rose admission
ticket with two smaller dark, notched tickets: Start a story opens Library, Import a piece uses the
Library's existing request signal, and Browse stories opens Scenes with the selection cleared.
The landing occupies the shell canvas. The bottom app dock, its Overlay tile, Ctrl+K/Cmd+K and existing app shortcuts remain usable. Explicit workspace navigation or Open full workspace leaves the landing; choosing an overlay app does not.
The shell's temporary fullscreen overlay presents a working app in a floating window over a translucent scrim. Selecting an app changes only the overlay destination; the underlying workspace remains mounted. Escape, Close overlay and Ctrl+K/Cmd+K dismiss the overlay without changing the workspace app, focused editor, split arrangement, title-screen state or remembered app. Only Open full workspace promotes the chosen app and editor selection onto the canvas. The shell navigation slice owns separate workspace and transient overlay destinations, with one presented-app selector and one pane-selection selector. Reopening remembers the last overlay app and editor selection. AppSurface routes each app's one portal container to its host without remounting or copying drafts; choosing the same app as the workspace temporarily moves that one instance into the overlay. Workspace, last overlay and piece-editing app instances remain mounted as needed. Hidden outer surfaces contribute no layout; background apps cannot handle editing shortcuts or replace the active screen brief. Open pieces and their drafts remain shared, so opening or explicitly closing an editor affects the shared tab inventory; workspace restoration still persists that inventory under its existing policy. Late boot screen correction checks the navigation revision and cannot overwrite a subsequent overlay visit, even after dismissal. The overlay uses the shared DialogCore focus and Escape boundary. Its searchable app list comes from discovered manifests, includes catalog-only apps and excludes coming-soon entries. Import files reveals a floating panel; Choose files opens the Library widget and requests its existing picker through the shared pending import latch. Preferences and the theme toggle remain in quick actions. The bottom dock is the default workspace navigation; the overlay remains optional. The workspace reserves the measured dock height and bottom offset, keeping bottom-aligned controls such as the scene composer above navigation. Collapsing the dock releases that space; resizing remeasures it.
The registered `shell.overlay` surface provides square cosmetic widget variants across themes, with unchanged panel positions and behavior. Existing appearance scopes and digest approval govern theme customization; themes gain no navigation or import authority. React and native modal prompts own the keyboard ahead of the launcher and room shortcuts; ordinary inline protected settings remain navigable.
The primary widget contains the actual app: editable Workbench fields, Library browsing, scene controls, export setup, CSS editing, macro bench, sealed HTML preview, documentation, Agent, Settings or the app directory. Existing save, execution and approval boundaries still own these operations. Optional App shortcuts expands the app's smaller context cards: editor selection and split arrangement, Library counts/recent arrivals, recent scenes, the Press queue, CSS draft excerpt, engine availability, saved pages, reading bookmark, Agent brief, appearance readout or packaged-app directory. These shortcut actions keep the overlay open, including Library-to-editor selection.
An app folder's trusted `BunzaiApp.OverlayWidgets` export owns its optional shortcut cards and uses the existing AppContext; `onActivate` tells the host an action occurred without dismissing the overlay. Host app and editor handoffs target the active presentation, so shortcuts inside the overlay cannot navigate the workspace. Cards mount only while App shortcuts is expanded in the visible app panel. The loaded module supplies both the working app and shortcuts; no separate widget registry or draft authority exists. Inventory loading, confirmed empty results and failed reads remain distinct. Overlay app selection leaves the landing intact; explicit full-workspace promotion dismisses it through the host callback. The shared OverlayWidget frame inherits `shell.overlay` decoration and exposes stable theme parts, with `data-overlay-app` derived from the discovered app id. Themes supply appearance data and checked styles, never executable widgets or new host powers.
DialogCore shares its nesting context across separately bundled apps, keeping app dialogs above the launcher. Shell-owned discard/follow prompts inherit that layer too. Native protected dialogs retain browser top-layer ownership: the launcher yields Tab, Escape and its shortcut while one is open. Context menus and the scene emoji picker portal into their owning dialog so keyboard access stays inside the overlay; Library lasso decoration follows its modal layer. Onboarding tours wait until the overlay closes.
The host supplies cross-bundle AppActivity from the active presentation. Background editors decline save/undo shortcuts, suppress status and screen-brief publication, and exit focus/fullscreen modes. Split-editor shortcuts belong to the frame containing the event target, with workspace-level keys falling back to the primary pane. Activating a retained editor republishes its detailed screen brief. Autosave and dirty-window-close guards retain their existing policy.
Enter from the landing enters the chosen room; focused buttons retain native keyboard activation.
Clicking scenery or typing does not dismiss. Reduced motion skips the closing fade. Container aspect-ratio
queries select panoramic, standard or portrait stage art, fitting the complete composition to the
stage pane so curtains and footlights stay visible. Only the selected background loads. Container
width queries stack the controls on narrow panes. The landing canvas owns the size query;
the scene itself has natural block size. No fixed 46rem row or size containment clips its
controls. Heading size and vertical spacing respond to available height, and the canvas scrolls
when zoom leaves insufficient room, keeping every action reachable.
The compact black footer blends into the stage floor. Evolving cloud noise warps into billows and
curling wisps across the lower stage. It shares the spotlight renderer and does not intercept input.
Two moving CSS gradient layers provide the fog fallback when WebGL is unavailable; reduced motion
leaves that haze still.
`components/light-rays/` adds two rose/violet beams aligned with the painted spotlights for each
art composition. The vertex and fragment shaders are copied unchanged from Vaudeville RoleCall's
`light-rays.tsx`. Its OGL Renderer, Program, Triangle and Mesh setup runs
both sources and the fog on one canvas (`fog={false}` leaves the fog out; the chat layout chooser uses that),
capped at 640 pixels per dimension and 24 frames per second, with hidden-tab suspension and GPU
resource cleanup. Reduced motion or unavailable WebGL uses still CSS beams. OGL is bundled locally.
The rays appear only on this title screen and the scene chooser (`scenes/layout-chooser/`, without fog); no other room draws them.
Settings > Appearance > Stage lights (`ui.stageLights`) sets them: Moving (the default, and what an unsaved or unknown value reads as), Still (one frame at a fixed moment, no animation loop, no pointer follow) or Off (the component renders nothing). The studio's Reduce motion setting makes Moving act as Still; it never turns Off back on.
The `followMouse` flag is enabled: both spotlights ease toward the mouse using LightRays' existing
mouse uniforms, with 35% influence. Touch movement leaves the beams alone.
Light pulsation is disabled. Ray shimmer runs at quarter speed with gentle distortion and low noise.
Broad, softly feathered fog billows use low opacity so the floor art
remains visible through them.
Existing boot rules still skip the title for restored workspaces, reloads, direct app links and setup.

## Bottom app navigation

In narrow shell containers the dock sits at the bottom within the safe area, keeps 44px app targets and scrolls the selected app into view. All discovered apps remain available. On coarse-pointer devices it hides while a text field has focus. Browser viewport metadata requests keyboard resizing; physical-phone keyboard behavior has not been verified.

`shell/Dock.tsx` directly ports RoleCall's `FloatingDock` geometry, paint and motion:
fixed at bottom 24px (0 in compact landscape), centered, native 20px marks and 10px labels,
charcoal gradient, accent glow, icon hover scale and 400ms slide into its edge pill. The source
app's global sharp-radius overrides are included. Native small labels and grabber geometry are
deliberate fidelity exceptions. Idle tiles and the hide chevron use a lighter gray than RoleCall's so the
names stay readable. Every available discovered app appears, including
catalog-only tools; unavailable apps are excluded and Settings ends the row. Clicking a tile
navigates the workspace directly. An Overlay tile after Settings opens the temporary overlay.
Pending app loads use the native pulse and indicator. The dock floats over the workspace: the
shell measures the visible bar into its shared bottom reserve and clears that reserve when hidden. It sits above every app
surface (z 145, under dialogs and toasts at 150). Narrow and landscape containers show scrollable
icons with accessible names and hover titles. Both dock and pill stay mounted for the native
slide; inertness, ARIA and tab order keep the hidden controls inaccessible.
Arrow keys, Home and End move focus; existing app shortcuts use the same manifest order.
There is no idle auto-hide. `shell.nav` theme variants change decoration, not placement or
behavior; `shell.nav.start` and `shell.nav.end` remain decorative slots under existing appearance
approval. The Overlay tile and Ctrl+K/Cmd+K open the optional temporary overlay.
Routine theme and piece counts appear in that overlay, rather than a permanent footer. The
contextual status line sits below the top chrome and disappears when empty. It retains real
messages, library-read failures, the Browser Studio export-before-reload warning and approved
`shell.status.end` slot content. No status or reload row stacks under the dock.

Launchers identify this product using the explicit product field from `/api/version`; another app or a generic version server is not reused. A new bind is accepted only when its public per-server instance ID matches; this ID is independent of the private session bearer. Default launches search ports 8321-8330. Browser launchers open only the actual positively identified address within a shared twelve-second readiness deadline. The native desktop accepts `BUNZAI_PORT` as an isolated explicit port from 1024 to 65535; an occupied override fails rather than attaching to another session. Failed native creation is reported as a window failure, not a normal close; the owned Studio server remains available and opens its verified URL in the browser.

## Browser Studio

The GitHub Pages build (`scripts/build-pages.ts`) publishes two things. At the root is the public
website from `src/site/`: the home page, a feature tour page per part of the app, the user guides
rendered from `docs/guide/`, a download page, and what's new, which the page reads live from the
GitHub releases list. Under `studio/` it publishes the same React shell, discovered apps, setup steps, format
adapters, editors, import flow, Press, and indexed documentation as a static site. It needs no
account and sends no Studio data to a Bunzai server. A browser runtime supplies the existing
`/api/*` client contract from in-process stores and the shared inspect/export engine; it does not
fork the canonical model or maintain a second set of format conversions.

The public website opens on a static Bunzai title, `All the worlds: your stage`, inside an
illustrated movie auditorium (`src/site/auditorium.ts`). Its owner-requested cutout-style room artwork is
`docs/media/cinema-auditorium.png`; the generation prompt and provenance sit beside it.
The public repository belongs to Vaudeville-Studios; Pages publishes at
`https://vaudeville-studios.github.io/Bunzai/`. Repository actions, release requests, downloads,
documentation source links and canonical preview URLs use that organization-owned location.
Clicking Begin the showing dims the room and pushes the camera toward the screen while the local
curtain-opening film plays. The recovered Vaudeville title cards then run inside the screen: an
independent-production credit, `VAUDEVILLE PRESENTS`, and a 32-phrase Shakespeare sequence.
Each phrase pairs intact, unmasked text with one recognizable story prop, such as Oz's ruby slippers
or Harry Potter's spectacles and lightning bolt. Props share a Persona- and Danganronpa-inspired
layered-paper illustration style, independent of each story's native art style. Each prop appears
in full color for up to 300ms during the opening phrases. Accelerated ending phrases skip the
full-color hold and hard-cut directly to exactly two flat colors: each phrase's main color and a
shadow color. A directional burst of straight paper shards starts at the same beat and clears
when the next phrase begins. Every phrase has its own short, abrupt text entry; the complete words remain visible
without masks. If the WebGL renderer is unavailable, the prop stays in full color. The last `YOURS`
pairs with the existing Bunzai bunny mark in its original colors, with the burst behind it. The
revision and prompt source are in `plans/preroll-paper-revision.md`; v2 asset sources and prompts are
listed in `plans/preroll-paper-assets.json`. Skip and replay are available, and hidden tabs pause
the sequence. Reduced motion skips the curtain and title animation and opens the first product
picture directly. Native title content and
pictures sit inside the artwork's empty screen. Each picture pairs with
live text explaining the feature and the pictured view, plus a link to its tour page. Pictures
crossfade and their descriptions slide into place; reduced motion removes these transitions.
The picture inventory derives from the existing feature tour: Scenes, an opening scene, character,
lorebook and preset editors, the Library, the Press and Paper as its single theme example.
Node boards and other theme slides are excluded at the owner's request. Each picture has its own
explanatory copy, with
previous/next, picture buttons, arrow/Home/End keys,
and an explicit slideshow pause. Automatic playback starts only after entry, pauses while
hovered/focused, offscreen, in hidden tabs, or under reduced motion, and uses cancellable timers.
Inactive pictures are inert. The separate `info.html` page holds the
feature tour, local-library/provider explanation, guides, release feed and download links.
The landing header links to GitHub through Star repo and Open repo, alongside Download. Star repo
opens GitHub, where the visitor can choose to star it; it does not change their account automatically.
Static Open Graph metadata includes a canonical page URL and a branded 1200 by 630 PNG preview,
captured from the native auditorium title. Preview tags are checked in the HTML without requiring
JavaScript; appearance in an external app depends on that app's preview fetching and cache.
The site build writes both page styles and the shared theme/font assets. Focused fixture checks
cover entry, navigation, reduced motion and playback cancellation. The title, click-to-enter,
dimmed room and enlarged showing were checked in the running desktop preview. The stacked picture
and description were checked at 390px; mobile keeps the screen in view without the desktop zoom.
The Press, Library and theme captures use 3000px PNGs rendered from a closer 1000px
layout at three times the density; the Workbench uses a 3840px capture of its 1280px desktop grid.
Promptbook pictures focus on the board and its toolbar, captured at three times the density.
Captures exclude the open-piece strip. Pictures occupy more of the screen and open their original
PNG in a separate tab through Enlarge image. They show the owner's normal Library. The saved example Promptbook,
**Example - The Midnight Express**, has seven phases for situation, clues, suspect intentions, alibi
checks, the reply, continuity and open threads, with explicit hand-offs and a player-agency Script Sheet.
It was created and photographed through the running Studio without making model calls. RoleCall
was restored after photographing the bundled themes. This proves editing and presentation, not a
completed AI run of that example.

Website redesign studies live under `design/wireframes/bunzai-site-2026/`, separate from the
published site. They reuse the Velvet Premiere theme, proscenium and capped light/fog renderer.
The customized overture adapts Vaudeville's original production cards and accelerating words,
then plays the supplied curtain film. An exploratory CSS multiplane camera connects stage,
scene and studio at different depths. Chat replies and prompt stacks are explicitly scripted
design examples. These are local proposals, not shipped interface or deployment claims.

Every mutable browser store is intentionally memory-backed. Pieces, collections, settings,
Workbench state, previews, and portraits last only for the current page load. Bunzai does not
write them to localStorage, sessionStorage, IndexedDB, a service worker, or a remote account.
Reloading or closing the page starts a new empty Studio, so the ready shell's status line says
**temporary studio · export before reload**. The library gate goes straight into the Studio: the
runtime answers the library status as unlocked, because a tab's library is in memory with no password.
JSON API bodies are read as a stream and rejected with `413` as soon as they exceed 32 MiB; the
browser runtime cancels the remaining request body instead of buffering an oversized payload first.

Host-owned operations are not simulated. Kit and provider calls, MCP connections, remote-access
controls, updates, local engine checkouts, Lumiverse archive imports, and Lua or regex execution
require the installed app. Script source remains editable, but Run refuses because GitHub Pages
cannot provide the separate sandbox origin required by ADR-009. Host-only API routes and the direct
test-bench runners each return an explicit installed-app refusal. Ordinary supported files can still be
imported, edited, organized, converted, and downloaded entirely inside the page.

Browser Studio also includes the reviewed extension runtime in Settings > Extensions. Packages run
through an isolated browser worker and receive only Browser-declared operations against that page's
volatile in-memory store. Provider calls, native file access, and persisted rp-core scenes are not
available to Browser extensions. This does not enable the standalone script test bench described above.

## Kit terminal shell

Kit is Bunzai's conversational terminal preview. Run it from a source checkout with `bun run kit`;
release binaries also carry a Kit executable for Windows, Linux (x64 and arm64) and macOS, built by
the same bake as the CLI. Its composer accepts multiline text and up to five
large paste cards. Up and Down recall submitted drafts only at the relevant buffer edge, Ctrl+F opens
transcript search without discarding the current draft, and Escape stops an active turn. A rejected
submission remains in the composer. The block editor stores UTF-16 offsets but projects editing,
selection, wrapping, and clicks onto whole grapheme boundaries and terminal-cell widths, so an emoji,
combining sequence, or joined line stays intact, including batched keystrokes. Plain messages submitted during an active turn enter a bounded
FIFO follow-up queue; a compact receipt shows the next message and folded remainder count, then Kit
runs each message in order as the previous turn settles. The queue survives stopping the active turn
but is intentionally session-local and is not restored after relaunch. Typing `/` opens a
registry-driven command palette containing
every installed slash command and its summary; typing filters it, Up and Down move selection, Enter
runs the selection, Tab completes it for arguments, Escape closes it, and rows are clickable. Direct
prefix matches rank ahead of broader matches while filtering slash commands and piece mentions. Past the
command word the same palette offers that command's ARGUMENT - `/rail` lists the presets with their
display names beside the ids - because a studio id is exact, hyphenated and nothing like the name
somebody remembers, and typing it from memory is where the mistake happens. Right-clicking the input
pastes from the system clipboard, and Alt+V pastes an image, as do Ctrl+G and `/image`; a Ctrl+V
that arrives carrying no text is read as a pasted picture too, since that is what an empty paste
means. Alt reaches Kit two ways and both are read: the Kitty protocol reports it as one modifier and
the older ESC-prefix convention as another, and reading only the first is what once made every alt
chord look undeliverable. WHETHER A PICTURE IS SENT IS THE PROVIDER'S ANSWER, declared per spoke
rather than assumed: a provider that reads images gets the picture attached to the next message and
the caption says so, and one that does not keeps the image on screen for you alone. Absent means no,
because attaching an image to a text-only model errors the turn rather than degrading. A file path
written or pasted into a
message becomes reachable for that file alone, without a separate sharing step: naming a path is
consent to it, exactly as picking one in a file dialog is, and the path is drawn as a link that
shift+click reveals in its folder. A
trailing `@` query opens matching studio pieces; choosing one inserts a stable `@kind:id` marker,
and resolved markers in replies render as compact name-and-kind cards. When the composer is empty,
its placeholder suggests a deterministic next move from the live studio shape, such as auditing
lorebook triggers or comparing two named characters; it disappears as normal placeholder text as
soon as typing starts and is never submitted implicitly. If a provider stops after
streaming part of a reply, Kit keeps
that partial reply visible before showing the stop or error. The input and connection state form one
fused prompter rail: an open heavy top rule and rose prompt cap lead into the input plate, while a
thin seam joins the quieter provider, model, and ready or working register below. Transcript
scrolling remains available by mouse wheel and navigation keys without painting a second,
application-owned scrollbar beside the terminal's own window chrome. Home and End jump to the oldest
or newest transcript content, and Page Up/Page Down move by a viewport. When new rows arrive while
the reader is scrolled up, a capped `new below` pill appears above the composer; clicking it or
pressing End returns to the latest row and clears the count.

`/rail` (also `/blocks`, `/outline`) keeps a preset's block list open beside the conversation, and
`/rail off` closes it. Order is what it exists to show: a preset evaluates top to bottom, so a block
can be enabled, expand perfectly and never be read because something later overwrote what it wrote,
and position is the only place that shows. Naming a preset is optional when there is only one, and
several matches are listed rather than guessed between - and typing `/rail` then a space offers the
presets as a list, so a studio id never has to be remembered and retyped. Kit reaches the same view
through `rail_open`; a request to show a preset is ignored while edits are unapplied, so it cannot
pull the rail out from under somebody mid-rearrange. What is on the rail rides in each turn's ambient
context, so Kit knows without asking rather than answering from what it opened earlier.

The rail is edited directly. Click, shift-click for a range in either direction, and ctrl-click to
add or remove one; drag a selection anywhere; space toggles, delete removes, and left/right expand a
block's content. Arrows move the cursor and alt+arrows move the blocks, so every gesture has a key
for anyone without a mouse. Ctrl+B hands the keyboard between the composer and the rail, and the
header and footer show which side holds it - without that, an open rail swallowed the keys it claims
and silently toggled blocks while somebody typed a prompt.

Its shape belongs to the reader, not the layout: Ctrl+Shift+Left/Right resizes it, Ctrl+Shift+D
switches between roomy rows and fitting as many as the window allows, and `<` / `>` thumb through the
studio's presets in order so two can be compared without typing either name. The footer count says
`all 155` when everything really is on screen, rather than a fraction that has to be interpreted.
Stepping away refuses while edits are unapplied, because a key that sometimes destroys work is worse
than one that sometimes says no.

`/gallery` (also `/cast`, `/faces`) lays your card art in a row along the bottom, sitting on the
composer. It answers a different question from the preset rail and so it sits differently: a block
list is long and read top to bottom, while a cast is something you glance down at and go back to
typing. It is windowed rather than wrapped, so a shelf of forty faces scrolls sideways to keep the
cursor in view and the transcript above it never moves. The keyboard contract is the rail's on
purpose: Ctrl+B hands the keyboard over, left/right move, Home/End jump to the ends, Enter fills the
composer with that name rather than sending it, and nothing is intercepted at all while the composer
holds focus. Clicking a card selects it. The strip reports how many pieces it looked at that carry no
art, and says when a deck was larger than it scanned, because a silently short shelf reads as missing
art rather than as a bounded read. `/art <name>` shows one piece full size in the conversation
instead, and `studio_art` is the same view opened by Kit when a face is worth showing mid-sentence.
A portrait held as an asset-store or archive reference does not resolve yet and reports as no art.

Nothing there writes as you go. Edits accumulate against the rows as last read from storage, the
header counts them, and Enter stages the lot as one ordinary draft that pauses at the same Gate a
model draft does. Refused, denied, stale and failed are four different sentences, because they lead
to four different next moves. A denial keeps the edits in the rail and discards only the staged
draft.

`/help` opens a full-screen, registry-driven reference stage instead of writing a long help message
into the transcript. Commands and live keyboard bindings share grouped sections, the pane scrolls
with navigation keys, and Escape or `q` returns to the untouched session view.

While Kit is open, a bounded read-only stage watcher reads the canonical studio listing and compares
it with the prior snapshot whenever the studio folder itself changes (a debounced folder watch, not a
fixed beat), with a plain interval as its fallback if that watch is
refused. Outside imports, edits, and removals coalesce into one searchable `NOTICED` transcript cue
with a suggested next question; Kit never acts on the change by itself. Temporary unreadable states
are skipped until the next check, the live piece/deck counts and composer suggestion refresh from the
new snapshot, and the watcher stops with the Kit process. Watch notices are live-session context and
are not written into saved conversation history.

Settled replies longer than 1,200 characters fold to a one-line cue and reopen by click or Ctrl+O;
live streaming text never folds mid-answer. Fenced unified diffs receive counted add/remove
treatment, horizontal rules share Kit's scene seam, and error rows cap hostile or accidental floods.
Hovering a user, assistant, or error band exposes a copy corner. Copy uses the terminal's OSC52
support, refuses oversized payloads, and reports unsupported or rejected requests in a short status
toast instead of claiming clipboard success.

Successful turns are saved atomically as one JSON file per session under the Bunzai configuration
directory's `sessions/` folder. `/session` opens the saved-session playbill, `/resume [name]` restores
history and visible transcript lines, `/rewind` can truncate or fork at an earlier turn, and
`/export [md|json]` writes a transcript with a session-specific filename. Search, resume, and rewind
lists keep the selected row inside a terminal-height-based visible window.

`/model` opens provider settings. Credential, endpoint, or provider-option edits invalidate any
previous model result before another lookup. Lookup and save failures remain visible and can be
retried; activating or removing a provider refreshes the shell's provider and model state.
`/doctor` discovers and concurrently runs four independently timed, read-only checks: vault sealing,
a real provider proof-of-life, canonical studio enumeration, and the exact Bunzai/Bun build. One
timeout or failure becomes its own warning/failure row without hiding the other completed results.
`/decks` (also `/inventory`) prints the current canonical deck counts on demand. `/privacy` reports
recorded model calls and token counts for the session. It is not a network activity log: connection
checks, external tools, and failed calls without usage reports are outside it. Kit's greeting explains
that conversation context goes to the selected provider and connected services can make requests.
Wide terminals show the animated NOW
PLAYING theatre marquee without a persistent telemetry strip;
inventory stays out of persistent chrome. Narrow terminals use a purpose-drawn miniature rainbow
`V KIT` lockup but retain the complete greeting and stage cues, wrapping the copy instead of
replacing it with a terse fallback. Extremely short windows can scroll that opening while the
composer and connection commands remain reachable. On roomy terminals, the large `V KIT` lockup
and its welcome script share one centered stage block instead of clinging to the left edge of an
ultrawide canvas. The shell inherits OpenTUI's live canvas instead of copying a
dimension snapshot. Kit also matches the terminal emulator's default background to the stage while
it is open, then restores it on exit, so fractional-cell and profile-padding gutters visually belong
to the same surface.

Kit's live model tool belt includes `studio_list`, `studio_read`, and `studio_search`; bounded
Bunzai documentation query; bounded capability discovery; draft discard; and revision-checked
apply. Documentation
query lazily ranks catalog-declared Markdown sections with a local full-text scorer and reads only
catalog-declared pages or heading sections.
Capability discovery can search, browse a collapsed target to area to action hierarchy, or describe
one exact operation. Search replaces the deferred set with no more than five typed operations;
describe reveals exactly one. The set resets on the next user turn. Capability calls preview without
save. Kit keeps composing preview operations while the model still needs tools. When the model
finishes a composed draft, the shell replaces any model-authored save question with a semantic
`REVIEW CHANGE` panel. The panel shows up to five field-level before/after rows, the target, hidden
change and warning counts, and clickable Apply & save or Discard controls. Enter or `y` applies;
Escape, `n`, or `d` discards. Apply pauses in this interactive Gate, saves once
only if the stored canonical revision still matches, then re-reads the piece before reporting an
applied, stale, or failed receipt.

Converting a piece to another platform gets its own panel, because a crossing is not a draft: a
draft's honest shape is a field changing value, a crossing's is each thing meeting an engine that may
not have it. `REVIEW CROSSING` is a two-column ledger of what each thing is and what becomes of it,
banded by severity worst first, with the stripe carrying the weight. Removals are listed individually, each naming the block it lives in,
up to a cap of six with one overflow row carrying the rest of the count; rewrites are grouped by
macro family, because a hundred respellings say what one row and a number say. A fixed line at the foot carries the key, and
carries one row's own note while that row is hovered, so the explanation never depends on owning a
mouse and never moves the buttons underneath it. The source's own escrow is reported under the rule
as reassurance rather than as damage: it is absent from the exported file and still held by Bunzai.
The panel is built by re-running the conversion at gate time; a preview that fails leaves the
ordinary confirm rather than denying the write.

That panel offers a third answer. `Talk it through` neither runs the call nor denies it: nothing is
written, no permission is granted or widened, and the model is told the user wants to understand the
call before deciding, so its next move is to explain rather than to apologise or to try another route
to the same effect. It is reported as `held` rather than `denied`, so a paused apply would keep
its draft rather than discarding it. That third answer is offered on the crossing panel only; the
change panel still answers apply or discard.

Read-only tool batches may run concurrently, but their
observations retain provider order; drafts and applies always serialize. Loop stops name the
model-round, tool-call, elapsed-time, no-progress, or cancellation budget and offer a recovery
action. `/tools` opens the keyboard-and-mouse Panel Deck browser for piece, area, action, platform
applicability, and preview behavior. Compact terminals show one active pane at a time. See
[Kit content tools](kit/tools.md) for the exact implementation boundary.

The Backstage header reflects scheduler-owned lifecycle state. Its sealed trace keeps the final
verified, stale, discarded, failed, cancelled, or stopped receipt beside the ordered tool moves.
Reasoning fragments from consecutive tool rounds accumulate into one rehearsal receipt instead of
adding one nearly identical collapsed row per model round. Provider-authored tool preambles remain
in model history but do not interrupt the user transcript; Backstage owns in-progress narration.

## Hyper-modularity (the build's spine)
- **Apps are drop-in folders**: `src/ui/apps/<name>/index.{ts,tsx}` default-exports a `BunzaiApp`
  (`src/ui/app-contract.ts`): a manifest (tile title, flat-ink SVG mark, accent, order, optional
  `comingSoon` / `catalogOnly` / `appCatalog`) plus `Component(ctx)`. The server discovers them with
  `Bun.Glob` (`_`-prefixed folders skipped) and bundles each for the browser on demand. A normal app
  gains a searchable overlay entry; a `catalogOnly` app also appears there and in the manifest-declared Apps
  catalog. No central list names either kind, identical doctrine to `src/formats/`.
- **Apps never touch the engine or the filesystem**: they receive an `AppContext` whose `api` is the
  only door (inspect/export/studio/formats). The shell owns theme, the Workbench tabs, and the status bar.
- **Tokens are one CSS source**: `src/ui/theme/tokens.css`. Apps consume semantic surface, action,
  status, selection, boundary, and focus roles; hardcoding colors or layout pixels in an app is a
  review rejection (fluid law). Typography roles set body copy to at least 1rem, controls to 0.875rem,
  and metadata to 0.75rem. The Theater theme uses gold for shell structure and distinct sapphire,
  amethyst, emerald, topaz, and ruby roles for primary action, selection, success, warning, and danger.
  A theme package supplies those roles as its own palette; the legacy names in `tokens.css` alias them.
  In the Theater scene page, missing portrait art uses a compact initial tile; supplied portrait art
  keeps its normal layout.
- **Bright accents never carry small text**: every accent has a deep companion for text-bearing
  fills, always worn with `var(--stage-white)` ink (white on the deep tone clears ~7:1; on bright
  rose even black ink measured 4.47:1, under AA). Pairs: `--rose`/`--rose-deep`,
  `--accent`/`--accent-deep` (repainted together by the shell when a custom house accent lands),
  `--deck-*`/`--deck-*-deep`, and per-piece `--a`/`--a-deep` (minted together by
  `accentVars()` in `src/ui/_shared/decks.ts`; a hex piece accent's `--a-deep` comes from `accentRole()`
  under the active theme's contrast floors, via the `useAccentVars()` hook, so it is nudged exactly as
  the scoped character and persona accents are; the deepening math is `deepAccent()` in
  `src/ui/_shared/color-math.ts`, unit-tested to agree with the tokens). Bright originals keep
  borders, spines, and marks; a fill with a label on it takes the deep twin.

## First-run setup (the wizard)
The wizard wordmark reuses the generated bunny-b app icon, rather than maintaining a separate logo drawing.
The locked vs-setup-hybrid flow, one plain question per screen, built on the same drop-in doctrine:
- **Steps are drop-in folders**: `src/ui/setup/steps/<name>/index.ts` default-exports a `SetupStep`
  (`src/ui/setup/step-contract.ts`): a manifest (question, say-line, settings key, single/multi,
  stage note), its options (may be data-driven: the publish step derives platforms from
  `/api/formats`, excluding `native` formats), optional custom option widgets (theme thumbnails,
  color swatches), an optional stage ZONE (theme owns the backwall preview, first-deck the floor,
  publish the apron), optional direct stage effects (accent repaints `--accent`), and `phrase`/
  `recap` fragments for the final summary. The wizard (`src/ui/setup/wizard.tsx`) derives progress
  dots, "N of M", defaults, skip-all, the stage, the summary sentence, and the recap chips from the
  sorted step list; nothing central names a step. Pure logic (selection, defaults, sentence
  assembly) lives in `src/ui/setup/wizard-core.ts`, unit-tested.
- Theme thumbnails fill equal-sized grid cells, including space for the selection mark. The stage's
  deck cards occupy their own floor below the workspace caption and wrap inside narrow previews.
  The setup lockup uses the app's bunny-b icon asset, generated from `scripts/make-icon.ts`.
- **Settings**: `src/studio/settings-shape.ts` (open record, fail-closed per-key parser, known keys
  in `SETTING_KEYS`: theme / firstDeck / publishTargets / houseAccent) + `src/studio/settings.ts`
  (`<studioDir>/settings.json`). The shell boots settings-first: no `setupComplete` -> wizard;
  after OPEN VAUDE the shell applies theme + house accent and lands on the app whose manifest set
  `firstRunLanding` (the Library's two doors). A later, genuinely fresh boot lands on Scenes under
  the title screen below; the lowest-order app is the last-resort fallback (a link that names an
  app that no longer exists, or automation with nothing else to go on). None of this waits on the
  studio's piece list (`src/ui/shell/use-boot.ts`): the landing app and the title screen (when it
  shows) paint first, and `/api/studio/list` loads afterward, in the background. A saved workspace
  bench names its app right in settings.json, so which app to land on needs no list either; which
  of its pieces survived does, so the bench stays provisional - the shell store's
  `restoringWorkspace` flag, read by apps through `ctx.workbench.restoring()`, is true the whole
  time, and the Workbench shows a quiet "Restoring your bench..." line instead of claiming there is
  nothing open - until the list confirms them; a piece deleted since is dropped rather than restored
  as a tab that cannot open. If the piece list fails to load, `finishBoot` retries up to three more
  times with backoff (2s, 5s, 15s) before giving up; `restoringWorkspace` stays true throughout,
  including on final failure, so a saved bench never confirmed one way or the other can never be
  PATCHed over by the still-empty in-memory one. Only once every retry is spent does the shell settle
  with a sticky status-bar note (outranking any routine status write) naming the failure and asking
  for a reload, rather than falling back to the boot-error screen (that screen is reserved for a
  settings or app-roster failure, both still on the boot path proper). Settings > Appearance offers
  the host-verified bundled themes and imported data-only theme packages.
  A stored package that no longer passes the current checks stays in the list, disabled and without grants, with the reason; it can be removed (or installed again, for a shipped example). An unreadable saved theme state still lists the bundled themes, none enabled, with a one-line notice.
  GirliePop retains the saved `stage` identifier, and Paper retains `paper`; a package keeps its
  namespace ID. The saved setting is the requested selection, while the effective appearance comes
  from `/api/themes/effective`. Initial boot and selection changes show the neutral core appearance
  until that response verifies the host inventory or an explicitly approved package. Routine foreground
  verification keeps the last verified appearance while waiting. Invalid authority responses, lock and
  known lifecycle changes clear it immediately; a local-storage theme cache never activates an appearance. The authenticated first-party inventory is folder-driven under
  `src/extensions/themes/`: Paper keeps `paper`, GirliePop keeps `stage`, Theater keeps `theater`, and RoleCall
  keeps `greenroom`. RoleCall is the default: a studio with no saved theme paints it (the setup theme step lists it
  first and preselects it, the shell toggle cycles it first), and a saved theme is never changed. It is
  colour-only on purpose, RoleCall's own palette, Cinzel and Inter over the core rendering with no surface picks.
  These packages pass through the same descriptor validator as imports; host inventory provenance, not
  manifest flags, grants built-in status. The Appearance section lists bundled and installed packages,
  previews the exact digest and derived appearance scopes before explicit approval, and offers disable,
  revoke, restore, and remove actions. Each catalog entry carries the theme's registered-surface difference score (picks only; theme:measure measures the whole app) and a
  palette swatch; the in-panel display of both waits on an approved wireframe. Encore is shipped as an
  inspectable, downloadable example envelope and remains uninstalled until the user approves it.
  A schemaVersion 2 package picks one host-built layout variant for any of 29 surfaces (the one id list
  is `src/extensions/surface-registry.ts`), sets its own palette (lowercase hex only, contrast floors
  enforced at inspection), picks bundled fonts by id, a frame style and width, density and motion
  profile, and says whether the Settings accent follows. The descriptor has no radius field; host surfaces own their corner geometry.
  The painter (`src/ui/shell/theme.ts`, `theme-tokens.ts`) writes changed `--bk-*` custom properties
  and `data-surface-<id>` attributes only. Unrelated settings saves do not repaint. Identical effective
  appearances preserve the stylesheet, slots, verified browser asset URLs and watchdog health deadline; `tokens.css` holds the neutral core palette and aliases every
  legacy token to those names, and a component reads its variant with `useSurfaceVariant(id)`. A
  variant the host has not built renders as the current rendering. The host keeps the CSS, native
  controls, and interaction handlers. Packages cannot supply scripts or external URLs; optional checked
  styles, package fonts and static slots use the separately approved scopes in
  UI mods. With accent set to follow the user, the Settings accent replaces
  the brand role, and its neighbours 28 degrees either side on the colour wheel replace the action and select
  roles, each with deep and text tones derived to stay readable. Password/recovery
  gates, write confirmation, and theme approval sit inside `.host-protected`, which redeclares every
  property the painter can write from the immutable host palette. See
  [Make a theme](extending/make-a-theme.md) for the manifest.
  Visible desktop tabs compare an authenticated `{epoch, revision}` read about every two seconds;
  unchanged reads leave the current appearance alone, while focus rechecks the effective response
  without first resetting the theme. Suspending a revision read retains its last verified cursor.
  Hidden tabs abort the read and resume with a fresh comparison; the memory-only Pocket uses its
  same-tab revision event instead of a persistent connection.
  The setup wizard previews theme choices inside its own sample; it does not paint an unverified
  theme across the Studio. Individual controls use
  serialized `PATCH` updates so overlapping changes compose instead of replacing stale snapshots.
  Setup previews all three palettes side by side; selecting one does not recolor the other previews.
- **The title screen**: a genuinely fresh launch (not a reload of the tab, not a URL asking for a
  specific app, not fresh from the wizard above, not a restored workspace bench, and not
  automation) shows the attract screen first, over Scenes mounted underneath it: the ticket-bun
  mark, the BUNZAI wordmark, the tagline, and a "press any key" prompt. Any key besides a lone
  modifier, or a click, dismisses it with a short fade. The show/no-show decision is the pure
  `shouldShowTitle()` in `src/ui/shell/title-core.ts`; the overlay itself is
  `src/ui/shell/TitleScreen.tsx`. `prefers-reduced-motion` drops the drift, the motes, and the fade.

## The right-click system
One context menu for the whole app (`src/ui/shell/menus.ts`), extended by REGISTRATION:
- a surface marks an element as a TARGET: `ctx.menus.attach(el, () => ({ type, label, data }))`
  (deepest attached element wins; a document-level `shell` target is the always-there fallback)
- a feature contributes items: `ctx.menus.register(type, provider)` (any number of providers per
  type; each provider's items form a section; empty/null = deny by absence). Returns an
  unregister for app cleanup.
- shell-owned providers: `entity` (Send / Show / Open beside / Close the split / Remove on the
  Workbench - the one-shot single path, works in every room), `app` (dock tiles), `shell` (Go home /
  Import files / Switch theme). Adding a menu later (Open in editor, Export, Delete) = one
  register() call; nothing central is edited.

## Apps catalog and documentation
The catalog room ("Official Bunzai apps") is a `RoomHeader` over one Panel card per app, each marked "On your Dock" or "Included app" with an Open button.
The overlay lists the Apps catalog from discovered manifests (`appCatalog: true`) and
opens that surface without hardcoding an app id. The catalog derives its cards from `ctx.apps()`, so
it shows the official applications in the running build and cannot drift from the packaged manifest
roster. CSS Workshop is the first `catalogOnly` tool: it remains fully bundled and mountable while
appearing in the overlay alongside everyday apps. Help / Docs is another catalog-only app and renders the committed
`docs/` corpus inside the Studio. Its left navigation and search derive from
`docs/generated/docs-index.json`, including short frontmatter summaries, optional semantic page
summaries, retrieval topics, and nested H2/H3 anchors when sidecars are merged. The reader presents
the index as **User Docs** and **Developer Docs** with human-facing workflow, platform,
application/API, architecture, data-model, format, security, extension, and technical-decision
sections. Decision records keep their canonical ADR filenames on disk while the reader uses plain
titles without ADR codes. The center pane renders Markdown through the shared sanitizer and mounts
only generated figures or committed `docs/media/` images; the right rail derives from the current
page's heading anchors (nested anchors flatten depth-first while preserving H3 styling). The
desktop build bakes the same Markdown and assets that are visible on GitHub, so there is one source
rather than an in-app copy. Each page's **view on GitHub** action uses the existing leaving gate and
`/api/open` URL allowlist.

## Dev live-reload
`bunzai ui` (or `bun run dev`) watches all of `src/` (an app bundle imports core, stage, entities and studio; test files excluded) and announces updates over SSE (`/dev/reload`) to
every open page. A source update or server restart never reloads the document automatically.
The tab strip, which shows only while a piece is open or an update waits, offers a compact Reload Studio action with an accessible update announcement;
the open overlay shows the full explanation and the same explicit reload action.
The existing native beforeunload guard still protects unsaved editor drafts when that button is used.
The pending notice is transient shell state, independent of ordinary status messages. Repeated
events coalesce, and a server restart takes priority over a source update. SSE keeps reconnecting;
brief drops stay quiet, while a sustained outage reports that the server is down without closing
the workspace. Installed Studio also uses this explicit recovery action for stale-session API
refusals, without retrying a rejected operation or changing its authorization. Genuine library
locks still take priority through the existing protected gate. Bundles (`bundleModule`, `bundleVendor`, `/boot.js`) are memoized and rebuilt only
when that watcher sees an edit, not per request (`src/ui/server-static.ts`);
a quiet server keeps answering the same bytes. `bun run dev` bundles development React. The
"Bunzai (Browser)" shortcut (`scripts/vaude-browser.ts`) sets `BUNZAI_UI_PROD_REACT=1` and gets
minified production React instead - the same shape as the packaged exe's bake (dev React's checks cost real keystroke latency). The packaged exe
serves baked bundles and 404s the stream (the client goes quiet). Zero dependencies.

## The card-type chip
Summaries carry `sourceFormat` + `sourceVariant` (the first non-bunzai escrow entry). The Library
maps ids to chip labels from the LIVE registry: platform name when the adapter is
platform-specific ("RoleCall · V3"); when the adapter declares `generic` (the plain Tavern/CC
reader) a character reads "CC" plus its spec version and any other kind shows no chip, since CC
means character card; no source = no chip (made from scratch).

## The studio store
Full editor reads pair hydrated content with the stored revision from that same stable read. Reopening uploaded art therefore preserves the revision required by Save; actual concurrent changes still refuse the write. A public HTTP regression and a running Studio Strip Save followed by reload verify this path in an isolated library.
Mutation replies carry metadata from their own committed write, rather than rereading a potentially newer listing.
Portrait summaries recognize held blob references only after ownership is verified; derived-summary version 3 rebuilds older metadata.
`src/studio/store.ts`: `StudioStore`, the Studio's view of the encrypted library,
`<studioDir>/library.db`. Every piece is a canonical entity in the library's versioned `ContentStore`
(`src/stage/store/`): each change is a numbered version, a delete goes to a Trash for 3 days,
and a deleted id is retired so nothing new takes it. Beside the file, `library.db.snapshots/` holds the rolling
snapshots (Settings, Backups lists and restores them). The Studio's own documents (settings,
collections, engine roots, Kit's block graveyard) live in the library's `StateStore`. A folder of plain
files is imported once at first start (the load-in) and only ever read; the app never runs on it, and
`bunzai export` writes the library back out in that folder layout. The window comes up before the
library opens, and every Studio call answers 423 until it is open or while it is locked. The browser
build keeps the same stores in memory.
The packaged and development desktop entries share their window-worker message and close wiring while
keeping their own worker entrypoint and failure behavior. The live stagehand and rehearsal box share
one elapsed `m:ss` stamp; its terminal timer clears when its renderable leaves the tree or the active
flag is false.
The packaged desktop app uses loopback port 8321 by default, reusing an existing Bunzai there or
searching the next nine ports when another listener owns it. Set `BUNZAI_PORT` to a decimal port
from 1024 through 65535 to request one exact port; that mode fails on a bind conflict and never
attaches to another Bunzai or searches a different port. Invalid values fail before the library is
created. The override is intended for isolated launches and diagnostics.
Saving never silently overwrites: an occupied id gets a numbered sibling (the import journey's
"Keep both" default enforced at the storage floor).
`inventory()` returns readable summaries and separate records for library rows that no longer parse,
match the canonical schema, or match their kind or id. Damage records use bounded reasons. Files in a
folder that fail the same checks are reported by the import and left in the folder, unchanged.
A library's `inventory`/`list`/`graveyard` read each piece's
sealed summary (`ContentStore.summaries`/`graveSummaries`), never a body: a row whose summary is
current costs no decrypt at all, and only a row whose summary is missing or stale (the background
rebuild has not reached it yet) is computed fresh for that one row alone, so a damage record still
surfaces the moment a body genuinely fails to parse.

## The receipt
`src/ui/receipt.ts` renders the plain-words import receipt server-side (both shells say identical
sentences): platform names only, "we read / we kept" voice, lines only when true (embedded book,
scripts-as-data notice, privileged warning), and the warm unknown-file message. It is a rendering of
what the engine already knows - no new format logic.

## Endpoints

The Library's primary read is `GET /api/studio/inventory`, which returns healthy entities and
bounded damage records for library rows that no longer parse. `GET /api/studio/list` remains the
healthy-only read for existing clients.
`GET /` shell · `GET /tokens.css` · `GET /boot.js` · `GET /api/apps` manifests ·
`GET /apps/<id>.js` bundled app · `GET /api/setup/steps` step ids · `GET /setup/steps/<id>.js`
bundled step · `GET|POST|PATCH /api/settings` (POST replaces the document; PATCH validates and merges a partial update) ·
`GET /api/docs/index|figures` generated docs metadata · `GET /api/docs/get?id=` catalog-declared
Markdown only · `GET /api/docs/asset?path=` committed docs media and generated figure assets only ·
`GET /api/formats` (includes `native`) · `POST /api/inspect` (bytes + x-filename) -> receipt +
canonical entity · `POST /api/export` {entity, targetId, extension?} (cross-kind fails closed; `extension` picks the
container when a format writes more than one, and a character asked for `png` gets the standard card
even from a format that writes no PNG of its own) ·
`GET /api/coverage` (per-platform canonical-path claims - the editor lens's and the Press's ground
truth) · `GET /api/studio/list|get|inventory` (`get&revision=1` returns an editor baseline and its
revision) · `GET /api/studio/portrait?kind&id` (the entity's art: the
escrowed PNG carrier, else a data-URI `body.media.portrait`; 404 when none) ·
`POST /api/studio/save` (editor saves compare the loaded revision and return 409 when stale) ·
`GET /api/studio/export-pack?id=` (a stored Sprite pack as a ZIP of its pictures, each read from the
library as its turn comes and stored uncompressed, never the pack as one value) · `POST /api/studio/duplicate`
{kind, id} (a keep-both copy made by reference, so a big pack never crosses the wire) ·
`GET /api/studio/trash` and `POST /api/studio/restore` {graveId} (the Library's Trash; restore
always comes home) · `GET /api/chats/list|open?id=|trash` and `POST /api/chats/start|send|edit|rename|delete|cut|restore-cut|take|fork|rename-take|delete-take|update-card|revert-card|restore-scene|restore-take`
(Scenes, `src/ui/server-chats.ts` over `src/studio/scenes.ts`; `send` and `edit` carry the branch
version and answer 409 when stale, as do `cut`, `restore-cut`, `fork`, and `revert-card`; the first send saves the greeting and the message as one
write; `send` and the scene edits (`cut`, `restore-cut`, `take`, `fork`, `rename-take`, `delete-take`,
`update-card`, `revert-card`) answer the scene as it now stands; `trash` lists cut scenes and deleted takes) ·
`GET /api/chats/portrait?id=` (a scene's art, from its frozen copy of the card, never the live one) ·
`POST /api/studio/save-bundle` (the complete canonical batch is validated
before writing; keep-both lorebook renames rewrite `knowledgeRefs`) ·
loopback-only `POST /api/inspect-archive` (a `.lvbak` streamed to disk; entities stage server-side
and the response carries SUMMARY rows only - a real backup's entities total gigabytes) ·
`POST /api/inspect` stages single-file results whose canonical JSON exceeds 8 MiB; those receipts
carry summaries and use the same staged save path) · loopback-only `POST /api/studio/save-staged`
({token, key, refIds?}: commits one archive or large single-file import by reference through the same
saveBundle core; refIds rewrites `knowledgeRefs`, and an empty map
drops refs to books that never reached the shelf) · host-only `/api/remote/*` routes for tunnel/LAN status, setup,
join secrets, devices, approvals, and host controls · host-only `/api/updates/*` routes for release
information and version switching · host-only `/api/library/*` routes (`src/ui/server-library.ts`):
`GET status` (opening, loading-in with progress, failed, locked, or unlocked, plus whether a
password and words exist), `GET computers` (the remembered computers, unlocked only), and token-checked POSTs to unlock, lock, prove, make and confirm words, set
or remove the password, forget a computer, and move to a stronger lock; no response or log carries a
secret except the new words. Remote clients receive none of these control families.

A dropped chat `.jsonl` rides the same two routes: the row's `entity` is a scene carrier (`kind: "scene"`, never a library piece), `save-bundle` and `save-staged` hand it to `src/studio/scene-import.ts`, and a refusal (card not in the library, ambiguous, already imported) answers `{ ok: false, error }` (422) so the sheet lists it by file; chat rows commit after every card and persona in the drop. Local `POST /api/studio/cancel-staged` revokes staged rows abandoned by the import sheet. After an
import, `POST /api/studio/import-complete` reports the number of committed primary and related pieces;
the SQLite library requests planner optimization only above 1,000 pieces, and that maintenance
failure does not change the saved result. Large single-file inspect receipts use this same staged
commit path as `.lvbak` rows.

## The Library room (the shelves - deep browse)
Empty studio = the locked first-run doors; populated = the browse room, laid out as RoleCall's
/library: the RAIL on the left and the shelves beside it. The setup wizard's `firstDeck` is drawn first.
Import (drop anywhere, the rail's Add button, plain-words receipts) lives here. Covers use
`/api/studio/portrait` art when carried.
- **Start Scene** sits under every character card (`rc-cards.tsx`) and opens a new scene in Scenes
  (below).
- **Delete and the Trash** (`delete-flow.tsx`, `trash-panel.tsx`): RoleCall's "Move to Trash?" dialog
  moves a piece to the library's Trash for 3 days and frees its name at once; its id is retired, so
  nothing new takes it. The rail's Trash row (with its count) opens the Trash panel: each deleted
  piece, cut scene, and deleted take with the time it has left and Restore, which brings a piece back
  under its own id with its history and a scene or take with every message, and each removed version of a
  reply ("version of message N in <scene>") with "kept until restored" in place of a countdown, since a
  removed version never expires (store rule 32); RC's segmented toggle
  filters All / Pieces / Scenes, and RC's "Trash is empty" state. The rail stays up while only the
  Trash holds pieces. The Scenes page's Trash button opens the Library here. Routes:
  `GET /api/studio/trash`, `POST /api/studio/restore`, `GET /api/chats/trash`,
  `POST /api/chats/restore-scene|restore-take|restore-version` ({id: `messageId:swipeId`}).
- **The rail** (`rail.tsx`): the "The Library" header with RC's Carousel / Grid switch, one row per
  deck (glyph, name, blurb, and a LIVE count; while a search runs the count is matches, the tooltip
  keeps the total), which FILTERS as RC's does (click shows that deck alone, click again shows every
  deck), the person's collections (a click writes `collection:<id>` into search, exactly
  as the collections bar does), and Add to the library (the import picker). Deck names, blurbs,
  singulars, and glyphs are `DeckMeta` in `_shared/decks.ts`, the one home for per-kind constants.
  In a pane narrower than 48rem (an `@container` query on the room, never the window) the rail
  folds into wrapping chips above the shelf; each shelf's view choices also wrap inside the pane.
- **The shelves** (`shelves.tsx` + `carousel-core.ts`): every deck that holds anything gets a
  numbered section (Roman numeral, two-tone title, count, New) of the cards RC's own library rows
  use (`rc-cards.tsx`): characters and personas wear ContentCharacterCard (the tall portrait card,
  art fading into the name and italic tagline), presets ContentPresetCard (the sampler values the
  preset CARRIES, never engine defaults, its prompt count, a cover only when it has art), regex sets
  ContentRegexCard's content in the shared card shell (RC's own thin-bordered one read as another app), and lorebooks and the rest the fixed-height asset
  card (the square book cover with its entry count). Carousel is a sideways row per deck with a
  scrubber that tracks, drags, and jumps; Grid wraps the same cards, as many across as the art
  dial allows, and keeps drag-select (the box is drawn on document.body, since the
  room is a size container and would otherwise offset a fixed box). No marquee in a Carousel row: it
  would sweep cards nobody can see. Cards read their words through `peek`, which
  answers straight from the piece's listing summary (`facts` on
  `StudioEntitySummary`, no fetch, no body ever decrypted) when the listing already carries it; only
  a piece whose summary predates the current listing (just saved, created, or restored) falls back
  to the one-near-the-screen, three-at-once fetch, never cached on failure (`peek-queue.ts`). That
  queue stays stable across accepted receipts, keys cached peeks to each piece's write identity, and
  checks current PieceStore identity before admitting or publishing a read, and drops cached or
  late results when the lifetime changes (for example, on lock). Unmount closes admission. Dates
  say "Imported", the one date the studio keeps.
- **Preview continuity**: Tiles and List retain authored tagline, description, tags and carried
  metadata instead of reducing a piece to its name. All four alternate views reuse the shelves' bounded peek queue,
  including its write-identity and library-lifetime fences. Show presents an unclamped description
  preview with the same metadata; Shelf keeps its words and facts too. Compact descriptions show
  three lines, with the listing preview in the tooltip (listing descriptions are bounded to 400
  characters). Persona briefs and regex summaries come from Cards' shared deck-facts owner.
  Carried preset sampler values and block counts stay
  visible; absent values remain absent. Listing facts satisfy these previews without body reads.
- **Every Hoplight control on the page**: each section header carries its deck's own view switch,
  Cards beside every drop-in view below (Tiles, Show, List, Shelf, Sets for regex, Profiles for
  personas), and New; each deck keeps its own choice (`library.views`, kind to view id, falling back
  to Cards). The cards carry their shelf's tools: a lorebook or regex set has its on/off switch,
  Split, Copy, and merges when dropped on another of its kind (the split and merge workshops open
  in a wide sheet); a regex set shows rules on of total, what it does, and its slow count; a persona
  shows Default, pronouns, sections, and a linked lorebook; a character its filled fields and
  tokens. Each row of cards ends in a New tile. The art dial sits in the top bar and sizes every
  card (`--cw`: 15.75rem at its resting value, down to a 9rem tile) and the Tiles, Show, and List
  art. Each card sits in a size-container cell and folds down as it narrows: its secondary words go
  first, then it is art, a one-line name that ends in an ellipsis and never breaks mid-word, and its
  switch and menu (Split and Copy move into the card's menu, which always carries them: `set-menu.ts`
  adds Switch on/off and Split for lorebooks and regex sets beside the shell's Duplicate); a lorebook
  too narrow for its fixed shape drops its cover and grows to keep its tools. Footer facts are one
  plain line that ends in an ellipsis. Heights follow each card's own width (RC's proportions). The rail narrows
  the page to one deck; it gates no feature.
- **The top bar**: search (names, ids, lorebook keywords, a piece's tags, which the inventory summary
  carries from the store's `entityTags`, and source words), All / Recent (Recent = newest first by the Workbench's own recency,
  `recents-core.ts`, open pieces included), and Select all.
- **What is drawn is one list**: shift ranges, Select all, and the agent surface all walk the drawn
  order (every section end to end, or the one deck). With every deck showing, the agent headline
  names no single deck ("Every deck, showing N of M pieces").
- **Damaged files stay visible**: the Library loads `/api/studio/inventory`, which returns healthy
  entities and damage records from one filesystem pass. When any safe-id JSON file fails closed, an
  expandable notice names the file and bounded reason,
  confirms that Bunzai did not change it, shows the local studio path when available, and gives
  manual restore-or-remove guidance. The notice also appears when no readable pieces remain.
- **Deck views are drop-in modules**: one file in `src/ui/apps/library/views/` default-exporting
  a `DeckView` (`view-contract.ts`: label, icon, css, render(ctx)); `views/registry.ts` is the one
  stated seam (a browser bundle cannot glob), one import line per view. Shipped: `grid` (labelled
  Tiles, so it never reads as RC's Grid layout; fluid auto-fill 2:3 cards), the persona shelf
  (labelled Profiles, so it never shares a name with the plain Shelf), `showcase` (one card at a time: hero art, the card's own
  tagline/description via `peek`, prev/next + thumb rail, stage in place), `list` (dense rows).
  The toolbar derives from the registry; the library names no view. Every view renders two piece
  states from the context: `open` (a quiet "on the workbench" annotation) and `selected` (staged,
  accent ring + corner check). An RC card's stage control is its NAME, a real button reporting
  staged or not; the rest of the card takes a mouse tap, and its "..." button opens the same
  right-click menu.
- **Multi-select is staging** (restored after the IDE rework dropped it): tapping a
  piece toggles it into the room's staging set (persists across deck switches - the distributed tray);
  a Send action bar appears with the live count and commits the whole batch through
  `workbench.sendMany`, which fires the follow dialog ONCE with the real newly-opened count. The
  right-click `entity` menu keeps the one-shot single Send. Open pieces are annotation-only: tapping
  one just notes "already on the Workbench" (no state-dependent navigation - one rule for tap).
- **Art size is a continuous dial** (range slider, `SIZE_RANGE` 4-36rem, fail-closed `clampSize`):
  dragging repaints live via the cascading `--card-w` var; release persists. View + size persist
  per-user through `AppContext.prefs` (`library.views`, per deck, and `library.size`), as do the
  layout (`library.layout`) and the order (`library.order`).

## Scenes (the library's chats)

Dramaturg HTTP refusals read at most 64 KiB through the shared byte pump. Oversized or failed bodies preserve the HTTP status and use a bounded fallback message; oversized reads cancel the source.

Dramaturg polling for a conversation running in another window pauses while this browser tab is hidden and resumes when visible, through the shared visible-interval owner.

Narrow scene containers use compact portraits and tap-revealed message actions. The composer uses 16px text and a 5.5rem height cap on phones across themes; unchanged drafts refit when their container changes width through the shared inline-size observer. Running-browser checks cover 375px RoleCall and Paper, narrow message editing and wide-to-narrow-to-wide draft resizing. Physical phones and installed-app behavior remain unverified.

A scene opens only after a chat layout is chosen (`scenes/layout-chooser/`, wireframes `design/wireframes/rc-port/messenger.html` view 1 and `design/wireframes/features/layout-chooser/` header A; RoleCall's `ChatAppearanceChooser`): `LayoutGate` shows `LayoutChooser` (Full Chat preselected, Messenger, Preview dialog with Choose, "Use <name>") in place of the scene while `scenes.chatLayout` is unset or unreadable (`chat-layout.ts`), saves the pick, then renders the scene. Each card shows a real screenshot of one synthetic test scene in that layout (`docs/media/chat-layouts/full-chat.jpg` and `messenger.jpg`, 1920 by 947), under the caption "Actual screenshots from a test chat. Every layout runs the same scene." The page has a centered marquee header (gold kicker "Bunzai · A space for your stories", the title, then the two lines of copy) over the title screen's `LightRays` without fog. Behind it, the hovered or focused card's screenshot fills the page under a vignette, and the selected layout shows there otherwise. Settings > Appearance > Chat layout changes the same key.

`src/ui/apps/scenes/`: RoleCall's /scenes list, gamified onto the wireframe
(`design/wireframes/soft/scenes-game.html`), and the scene page, ported from the earlier approved
wireframes (`design/wireframes/rc-port/scenes.html`, `chat.html`, and the `scene-*.html` tools,
gathered on `options.html`). Scenes live in the encrypted library's ChatStore.

- **Starting one.** Start Scene sits under every character card in the Library (not personas,
  presets, or books), and again as the "Start New Story" card on a character's own page in the
  list. It makes a scene with that character and the default persona (the `persona.default` pref,
  none when that persona is gone), freezing both at their current library versions, and opens it. The scene keeps the character's signature color, which tints its rail tile, rows, card and hero.
- **The list.** A cast rail (one tile per character, most recent scene's art, a "now playing"
  marker) and, beside it, a stage panel: Fan Favorites (a sliding carousel of starred scenes, pause
  on hover, still on `prefers-reduced-motion`), This Week / Earlier recent rows, the cut list, Smart
  Folders (Longest Stories, by message count), and story folders with New Folder. The main stage
  opens on "Continue your story" - a hero card for the current filter's most recent scene, beside a
  preview panel that loads its last two live messages (`getSceneTail`, P2 data); the hero's own
  scene is never repeated in the grid below it, which stays selectable when Select mode is on. The
  Your Stage header keeps Select, search, the Trash button, and All Time / Week / Month / Year and
  Recent / Messages filters. Clicking a rail character or a folder swaps the stage for that
  character's or folder's own header and grid (folders keep the plaque's filters out; a folder's
  color is a deterministic hash into the deck palette - `SceneFolder` stores none). Each card's take
  strip shows up to 5 pips (then a "+N" count) and the active take's own name ("Director's Cut" for
  the original, the scene page's own rule). A card's right-click menu (the shell's) renames it,
  stars or unstars it as a Fan Favorite, moves it to a folder (a picker dialog - the shell's menus
  have no submenus) or cuts it; Select cuts several. Cut scenes go to the Trash for 3 days: they
  list after Earlier in the stage panel, with the time left and Restore, and the Trash button opens
  the Library's Trash, where they sit beside deleted pieces. No tabs: Bunzai has no group scenes.
  Below a 700px pane, the rail and panel become a drawer toggled from the header. The overview
  header controls wrap within narrow panes so Select and Trash stay visible.
  The main scene-card grid, cast rail, recents and cut rows, folders, and Fan Favorites navigation
  dots use measured windows. Keyboard Tab continues through each window as rows enter it.
  Deferred Tab jumps cancel on another Tab, pointer interaction, focus departure, or viewport disposal.
- **A scene that is not there.** Opening a scene id this library does not hold (a remembered or handed-off id that this library does not hold) answers 404. The page does not strand: it returns to the list, shows the toast "That scene is not in this library.", and forgets the remembered id. Any other failure (busy, network) keeps a card with Try again (primary) and Back to Scenes (quiet), drawn with the button family. A scene whose character was deleted before it froze a copy (only pre-migration-22 rows; no current path creates one) answers 410 with code `cast_missing` from open and tail; the list marks it `castMissing`, its preview skips the tail request, and the page says why and offers Move to Trash (the soft-delete path) instead of Try again.
- **The scene page.** The header (back, name, tagline, the take pill), then the messages as RoleCall
  shows them: every message, the greeting included, runs through the full macro engine each time it
  is shown, against the scene's frozen cast; each bubble's random seed follows its global live-message
  ordinal, so resolving macros or prepending older pages does not reroll already shown bubbles
  (ADR-012 amendment).
  The page first opens at most 60 transcript rows, with only each message's selected swipe text;
  older rows load from an exclusive sequence cursor as the reader reaches the top, with global
  message numbers and the scroll anchor retained. Alternate swipe text loads when browsed. Macros
  keep whole-scene counts and ordinals; visible macros that ask for older message text trigger
  version-checked reads in batches of at most 60, and the page shows the stored text while those
  dependencies resolve, with an explicit retry when a dependency read fails. Rendering keeps
  offscreen bubbles content-visibility eligible.
  Until the first send an opening-message picker chooses among the greetings; the first send saves
  the chosen greeting and the message, as one write. Saved messages offer Edit and Copy; the unsent greeting offers Edit and Copy. Editing the opening message (RoleCall edits it before the first send too) opens the greeting as written, macros unexpanded; Save keeps the trimmed text for that greeting only (an empty Save is ignored), Cancel drops it. Like RoleCall's first_message_override it is kept on the scene (`chat.opening`, ChatStore rule 34, through `POST /api/chats/opening`), so a reload still has it, and the first send saves the chosen greeting's edit as message 1 in place of the card text; the card is never changed. Under 1024 px, RoleCall's own breakpoint, a message's action bar is not hover-only: a tap on the message opens it under the text with 44 px buttons and no fade, a second tap closes it, and a tap on a button, link or the edit box is not a tap on the message. Copy turns into a check (copied) or an X (failed) for 1.5 s. The edit box grows with its text: Esc cancels, Ctrl or Cmd+Enter saves, and ArrowUp in an empty composer edits your last message. The
  scene's art comes from its frozen copy, so editing or deleting the card leaves the scene as it was.
  In the RoleCall chrome (the default theme) a wing opens beside the chat and pushes it aside over 300ms, a press outside the panel (not on the rail, a dialog, a pop-out or the drag edge) closes it, and there is no blur or Scene Paused mark; every wing has an 8px drag edge on its chat-facing edge (`wing-resize-edge.tsx`, a labelled separator with an accent line on hover and drag) that works from 360 to the least of 1600 and the scene less 80, with the arrow keys (24px a step), Home or a double click to go back to the wing's own width (Booth 550, Cast 1000, World 1258, Prompting 1000, Final Cut 1120, Props 1120, AI 720, Stage 800, Context 880, the rail's 50px inside it), saved once per wing when the pointer lifts as the viewer's pref `scene.wingWidth.<wing>`. The rail shows every label when the pointer is over it, a wing's long help after half a second on it, and a just-opened wing's label for 1.4 seconds. Other themes keep the pause. Cast holds the character and persona editors (below); Control Booth is RoleCall's quick-access hub (`scene-booth-wing.tsx`, parts `scene.booth` and `scene.booth.status`): the hero ("Scene control surface") and three status tiles, Preset, Narrator (the model's display name) and Story Director (On or Off) ("No preset" and "Unset" when neither is chosen, "Not in your library" when the preset is gone), and, last, RoleCall's Narrator section (`scene.booth.narrator`, `props/story-director/director-booth.tsx`): the Story Director row ("Scene direction and narrator context") with its switch, which is the Props wing's own (it adds or removes the `story-director` Prop), and, while it is on, the personality picker, the Story Director Model with its Reasoning, and RoleCall's runtime box (`scene.booth.narrator.runtime`): the switch "Update trackers automatically" with one quiet line ("Every N replies.", "Every reply." when N is 1, or "Trackers change only when you edit or Refresh them.") and "Change in Story Director", which opens the Props wing at the Story Director's settings, then DM Temperature and Auto-retry, the same values as the Props wing's. The Booth has no tracker list and no call budget. The model row is a protected control. It only composes: each row is its home wing's module and writes through that wing's own `ctx.api.setScene*` setter, so the Booth holds no copy of scene state. While a reply is being written it says changes apply from the next reply. Under the tiles sit the loadout buttons and the receipt banner (`scene.booth.loadouts`, `loadout/loadout-bar.tsx`), placed as RoleCall places them. Save this scene as a loadout opens a dialog with a name (40 characters at most, "My Loadout" by default), New loadout or Update existing, and "What to include · N of 9": the nine settings a scene carries today (preset and block switches, model and connection, samplers, scene note, lorebooks, guides, persona, backdrop, props), in RoleCall's groups, with All current, Writing only (the five live writing settings) and None. The ones the scene holds start ticked and the rest read "Not set on this scene"; an unticked setting is left out of the loadout, a ticked empty one saves as "clear it". Update existing opens with the chosen loadout's own settings ticked and replaces it. A refused save (the 101st loadout) is said inside the dialog. Change setup opens the "Change the setup" sheet: each saved loadout with Apply and Review changes (what will change, stay as-is and stay protected, from the same plan the apply runs), the active one marked by its id, and Save current setup. Apply writes each setting through its own wing's setter in a fixed order and stops at the first one that fails; nothing is rolled back. The receipt banner reads from the library file, so it is still there after leaving the scene or reloading: "<name> applied · N settings · receipt LD-xxxxxxxx · undo Nm", or "partly applied · A of T settings" naming what applied and what did not, or "could not be applied" with no Undo when nothing was written. Undo apply puts back each setting that is still as the apply left it, leaves the ones changed since, and is offered for 15 minutes. Apply and Undo are off while a reply is being written. The per-setting Replace, Merge or Keep current choice, the Settings section and starting a scene from a loadout are not built yet. Lorebooks (`scene.booth.lore`) lists the books the scene reads with their tokens and entries and a power switch each; the switch is the World wing's own writer (`use-scene-lore.ts`), so what is switched here reads the same there. Adding and removing books stays in the World wing. Narrator Model (`scene.booth.model`) shows the scene's model by display name with its connection and stated window on a 40px tile, and a dropdown (capped at 16rem and scrolling, opening under the button) with a Provider filter whose chips count their models, a search and the models grouped by connection under sticky heads; the list and the pick are the AI wing's own (`use-scene-models.ts`, `setSceneConnection`). A connection scenes cannot use reads "Setup Required" and cannot be picked. Under it sits RoleCall's Fallback Model control (`scene.booth.fallback`, `booth-fallback-row.tsx`): Off (the default; a failed reply fails as it did) or Custom (a model you pick, with the same dropdown), saved as the per-user pref `scenes.fallbackModel`. When the scene's model fails with a "try again later" error before any text or reasoning arrived, the chosen model answers once and the take's meta names it; a Stop, a refusal, a failure after text started, or a fallback equal to the scene's model never switches (turn-loop rule 14). RoleCall's Auto mode is not offered, as Bunzai has no helper model. Active Preset (`scene.booth.preset`) is a card with the preset's name and the tokens of its enabled prompts, and opens Prompting; with none it reads "No preset selected. Choose in Prompting". Generation (Quick) (`scene.booth.generation`) is RoleCall's QuickSlider list (Temperature, Max Tokens, the Context card with its Tokens/Messages switch, Top P, Top K, Frequency and Presence penalty, then the Prompt Post-Processing card), always open, on the Prompting wing's own debounced writer (`use-scene-preset-own.ts`), so a slider moved here is the write the Preset tab would make. A large model window with Context tokens at it shows RoleCall's amber Context maxed warning; an unstated window shows none. The character card (`scene.booth.navigator`) shows the scene's character, tagline and up to three traits; Change Character opens the Character Library (search, "Start scene" or "Start fresh scene") and starts a new scene with the pick, never changing this scene's cast. Scene Readout (`scene.booth.readout`) shows, centred in RoleCall's order, the take's message count, the Tokens figure and the average reply time, the mean of the last 20 replies' stored generation time (a dash when none was timed; RoleCall shows a constant 1.2s); under it the Context bar (`scene.booth.context`) is the Context wing's own Context Pressure meter (`context/pressure-core.ts`: the same figures, window, thresholds and Context Target), so the two never disagree. The Tokens figure is the last request's size from the Context wing's trace (the provider's count, else the assembler's with a tilde, a dash before any reply). A Chat Summary row (`scene.booth.summary`) sits under Generation (The Context wing, below). Generation also carries the sampler bar's Context Mode and Max Messages. Runtime Setup (`scene.booth.runtime`) holds Narrator Tool Access ("Off means the writing model receives no tools. Director and Compendium helpers still work separately."; off by default) and, only while it is on, Max tool rounds (a number 1 to 20, default 8, "rounds"), then the Last Message as User switch; all three are the scene's own prompting settings (`setScenePrompting`, ChatStore rule 37) and the next reply reads them (turn-loop rule 18). Stage holds RoleCall's Appearance, Gallery, Music, Spotify and Wardrobe tabs (The Stage wing, below).
- **The Context wing** *(added 2026-10-12, RoleCall's right-context group, `context/context-wing.tsx`; pending author review)*: FoldoutTabs under the crumb "Tools / Context" with two tabs, Prompt Inspector (the default) and Memory. The wing opens at 880 (RoleCall's Memory tab jumps to 800; Bunzai keeps one width) and resizes like every wing (above). The Prompt Inspector has the sub-tabs This turn, Next send and Lore & state, and a Review tile that opens the scene inspector's review. Every number is the assembler's own: one request build (`studio/scene-turn-build.ts`) serves a send, the forecast and the trace, so nothing is a second estimate. This turn (`this-turn.tsx`) pages Earlier turn and Later turn over the take's replies with Calls, Sent, Received and Turn time tiles and the calls grouped Before the reply and The reply; provider counts read Exact and the turn's own estimate reads Estimated. An opened call shows Request, Tools, Route, Time and Raw JSON with a Copy request button, and a reply whose raw text was not kept says so and shows sizes only. Route lists every attempt in order (connection, model, how it ended, the provider's status, code and a bounded message) and says when the Fallback Model answered after the scene's model failed; it reads the `route` record the turn stores (`scene-turn-trace.ts`), which a reply from before it was kept does not have, so it shows no Route tab. Time draws a lane per timed part (the whole reply, the native reasoning, the thinking the reply's own tags held, each tool call) against the whole; the trace keeps lengths, not start times, so these are lanes of duration and not a waterfall. Next send (`next-send.tsx`, route `getSceneForecast`) builds the request a send of the composer's draft would produce, with Copy, a search over role and text and RoleCall's empty, error and no-match words; what a forecast leaves out (the Compendium's recall, prompt regex) is said under the blocks. Lore & state holds State, Lore, Macros, Sources, Flow and Compose over the one request, plus the context-pressure bar. State lists the scene's variables by scope; after a reply its tiles add Mutations Last Render and Macro Errors (from the macro pass the reply stored), and opening a variable lists its own history over the take's replies (`GET /api/chats/variable-history`, read from the `variables` record each reply's trace stores, newest 400 replies, "(not set)" and "(deleted)" for the ends). Macros (`tab-macros.tsx`) shows RoleCall's Macros / Tokens Added / Errors tiles, a search and a row per macro that ran, the hotspots first, with how often, the tokens it put in and a fold with what it produced; the failures are listed above (`{{lore}}` and the other names the second pass fills in are not failures). Its data is `AssemblyResult.macros` and `.changes` (`core/assembly/macro-report.ts`), a report of the one write pass the request was built from, with values cut to 240 characters for the report only. RoleCall's per-source chips and character ranges are left out because the pass does not know which block a macro sat in. Memory (`memory-tab.tsx`) is RoleCall's chat summary: ChatStore rule 45 (migration 41) keeps a sealed `chats.summary_json` cell with the settings and the last error, and the take's text is the `summary` scene-state slot ([scene-state.md](scene-state.md)): generated pieces are rows keyed by the version of a reply they end at, written on that version in this take, so a new version, a cut or a choice of version of that reply takes its piece along, and the person's own text is a separate row written as an edit of the newest message (it survives choosing another version of it and covers every piece written before the save); `summaryOf(branchId)` reads the text those rows make; `{{summary}}` and `{{chatsummary}}` expand to the take's text, hide-covered hides only messages below the summary's `through` point and the newest `keep` always stay, and the writer runs server-side in the scene lane after a reply, with a backfill that splits long histories. Outside the wing: the Scenes list card previews its take's summary (`SceneSummary.summaryPreview`, 180 characters, two lines) and its search also finds scenes by what their summaries say (`GET /api/chats/summary-search`, asked 250ms after typing stops, never for a word under two characters; a failed ask keeps the title matches and says so); the Control Booth has a Chat Summary row (Runs and AI Context tiles, the Automatic summaries and Include in AI context switches over the Memory tab's own writer, Open Memory) and its Scene Readout has RoleCall's Tokens figure, the last request's size from the trace (the provider's count, else the assembler's with a tilde, a dash before any reply); Settings > Memory & Summaries holds the summary settings a new scene starts with (one sparse pref, `scenes.summaryDefaults`, copied onto the scene by `startScene`; the couplings are `core/summary/couplings.ts`, shared with the Memory tab; the summary model is chosen per scene, not as a default). Left out, each because Bunzai has no source for it: Est. Cost (no price source anywhere: Kit's model listing and the stored generation carry no prices, and a made-up table is a wrong number), start times for Time (the trace keeps durations only), the wire bodies of provider calls, and RoleCall's Preset Dashboard and Tracker / History toggle.
- **The Stage wing** *(added 2026-10-12, RoleCall's right-stage group, `scene-stage-wing.tsx`; pending author review)*: FoldoutTabs under the crumb "Tools / Stage",
  tabs in RoleCall's order (Appearance, Gallery, Music, Spotify, Wardrobe), each shown only while it exists: Music appears once the Mood Music Prop is on, Spotify once the Spotify Prop is on, Wardrobe always (RoleCall kept it behind its Understudies beta; Bunzai has no tiers). One width for every tab: it opens at 800px on a wide scene (the full pane on a narrow one) and resizes like every wing (RoleCall resized the wing per tab).
  A tab is a `StageTab` (`stage-tabs.ts`) in its own file, so the tabs do not share edits. **Appearance** (`stage-appearance.tsx`) is RoleCall's Stage settings panel: the hero ("Scene presentation / Appearance"),
  the Chat Theme cards (Basic, Full Stage, Immersive; `scenes.chatTheme`) and five collapsible acts, folded per user (`scenes.stageActs`; a closed act shows a one-line status).
  Every setting is a per-user preference saved the moment it is touched (RoleCall's are per chat); its key, default and range live in `stage-look-core.ts`, an out-of-range
  value reads as the default, and Reset writes null. A setting at its default paints nothing, so a theme's own look shows until one is chosen; what each paints is in
  `stage-look-style.ts`, gated on flags on the scene root and as specific as a theme variant, so a setting beats the variant. **The Message**: Message Bubble Opacity 0 to 200%
  (`scenes.bubbleOpacity`, read by the core bubble and the bubble and vn-box variants; prose and screenplay have no box), Message Spacing 0 to 48px (`scenes.messageSpacing`),
  Show Avatars (`scenes.showAvatars`, undoes every layout's portrait room) and Show Timestamps (`scenes.showTimestamps`). **The Type**: Message Text Size 10 to 24px, Message Font
  (OpenDyslexic, Lexend, Atkinson Hyperlegible, Serif, Editorial, Monospace, all bundled under the SIL Open Font License), Message Text Color for Character, User and Dialogue
  (the house colour picker; Dialogue wins over a speaker's tint), Line Spacing 1.0 to 2.5 (Immersive reads 1.85 until one is chosen). **The Stage**: the Backdrop row and the
  Chat Accent Color row, described above. **Motion & Signals**: Auto-Scroll Always, Smart or Never (Never leaves the reader where they are; Jump to latest is its indicator),
  Typing Indicator (the "Starting..." line), Streaming Fade-In (the reply bubble fades in), Response Chime (one tone when a reply finishes while the tab is away), Auto-Open Reasoning
  and Cap long reasoning. **Chrome & Device**: Compact Mode (density 0.7), Collapse Wing Panels with a Single or Segmented edge indicator (scenes 1024px and wider; hover or focus
  slides a rail back in) and Show Wing Labels on Hover. Chat Theme: Basic hides the left wings, the readout and the vignette and keeps the AI and Stage buttons (Bunzai has no
  settings sheet); Immersive letterboxes the scene. Not drawn: Bubble Style, Layout and Header Size (the theme's `scene.message` and `scene.layout` variants own them, and the Message
  act's closed status names the two it picked), Grouped Alignment and Composer Debug Tools (nothing reads either in RoleCall), Phone Controls (the pane's container queries own
  narrow layout), Chat Input Resize (the composer), RoleCall's 37 hotlinked preset backgrounds, AI Generate and the admin upload. There is no Saving state: a preference saves
  optimistically and a failed save shows in the status bar.
  **Gallery** (`stage-gallery.tsx`) is built (see Stage Gallery below; it shows "No images in this scene yet" only for a scene with no art). **Wardrobe** (`stage-wardrobe.tsx`) is a mount point, hidden until built.
  **Music** (`stage-music-panel.tsx`, RoleCall's MoodMusicWingPanel) plays the sound files in the person's own packs: a track is a pack item whose media type is audio, a pack
  stands where RoleCall has a category, and RoleCall's hosted catalog is not carried. Top to bottom: the now-playing block with Play or Pause, Next (the next track in that
  pack, wrapping) and Stop and a 0 to 100% volume (saved as the app preference `scenes.musicVolume`, 60% until moved); the "Add Personal Track" form (choose files, or paste a
  direct https audio link, which the studio fetches once and keeps in the pack, with an optional title; with several packs a segmented control picks which one); then the tracks
  by pack, each row with its pencil (rename, "Edit Personal Track") and trash (remove from the pack). One audio element plays one looping track, and the browser loads it from
  `/api/asset/<sha>` (which answers Range requests, so a long file can be sought); a play the browser refuses shows its message in amber and stays paused. There is no crossfade (RoleCall has none). Not carried: the Story Director's
  `set_mood_music` driver and its mood chip (the Story Director does not drive music yet), Suno links, tags, "Notes for the AI", and the shared community library (off in RoleCall). The
  **Mood Music Prop** (`props/mood-music`, off by default, switched in the Props wing like TrackHare) shows the tab and draws the **mini player** above the composer (RoleCall's
  48px bar: tile, track and pack, Play or Pause, Next, and a chevron that opens this tab), once a track is set. It is not a pop-out: RoleCall's mini player does not float.
  **Spotify** (`stage-spotify-panel.tsx`, RoleCall's SpotifyWingPanel) controls the Spotify app the person already has open, through the local server: now playing (160px art
  over https only, track, artists, a click-to-seek bar with the clock), Previous, Play or Pause and Next, the device volume when the device has one, and a "Devices (n)" section
  that moves playback to another device. Playback is read every 5 seconds (devices every 30) while the page is visible. Controlling playback needs Spotify Premium; without it the
  tab says so. Not carried: the Chat Integration section (Mood, Tools and Hybrid feed on the Story Director). The **Spotify Prop** (`props/spotify`) shows the tab and the mini
  player; RoleCall's "Off" could be undone only from inside the tab it hid, so here the Props wing's row is the switch and is always there. The account is connected in
  Settings > Spotify. The page never holds a token: it sends commands to `/api/spotify/*`, which are host-only (a remote or LAN device cannot drive the owner's Spotify).
- **The Cast wing** *(added 2026-10-05, wireframe design/wireframes/features/cast-wing;
  pending author review)*, RoleCall's left-cast group, with FoldoutTabs over Character, Persona and
  Participants (blurb: "Character and persona"; only Participants carries RoleCall's "Registry" subtitle). On a desktop pane the wing opens at RoleCall's 1000px and resizes like every wing; the portrait column is its 380px. Both editing tabs are a hero card, a tall portrait
  column and a scrolling form with a pinned footer, and both edit the Library piece through the
  Workbench's own draft and save path: Save writes the Library card or persona, then moves this
  scene onto the saved version (ChatStore rules 13 and 26); other scenes show Update available.
  What the page does not show (settings, variants, escrow, the rest of the card) is carried
  through a save untouched. **Character:** the casting card, Color Palette, Description, Personality,
  Scenario, First Message, Example Dialogue, Advanced (system prompt, post-history instructions,
  creator notes), Content Rating (All Hours, Late Night, After Dark, each with RoleCall's tone), Tags
  (an Open Tagsheet button with RoleCall's count line and the tags as chips; opening it shows them in
  place, to add and remove) and Lorebooks, in RoleCall's order, with the portrait's change-image
  button, a V-version badge and the card's alt-art looks; picking a look is saved on the scene and the
  turn prompt uses it (rule 27). The footer button reads Save Draft while there are edits (RoleCall's
  owner label), then Saved. **Lorebooks** counts the books the card links (Creator Recommends, each a
  switch) and the ones this scene added (Your Added Lorebooks, each a switch with a remove), and Add
  Your Lorebook lists the Library; these are the scene's own lorebook choice (ChatStore rule 20), saved
  at once through the World wing's writer, never a card edit. Open Full Editor and "full editor" open
  the card in the Workbench, where its bundled books are changed. The named colors (Hair, Eyes, Skin)
  reach a request as XML tags (`<hair>Silver (#d9c8ff)</hair>`, the persona's own tag builder, `paletteTagLines`)
  at the end of the description the model reads, unless a preset block names `{{palette}}` itself, which then
  gets the JSON rows and no tags (persona-position.test.ts, card-palette.test.ts). RoleCall sends them only
  through the macro.
  **Persona:** the Starring line (emoji picker, name, tagline, pronouns, height, age), Appearance with
  its colour palette and the signature colour's name, Personality with Traits (a "+ Add" box), Quirks,
  History, Prompt Injection, the linked lorebook, the Pass ticket that opens the Casting Call, and RoleCall's three stats (messages,
  scenes, day streak; ChatStore rule 28), with a Default persona button that writes the setting and
  is never pressed by a swap. **Casting Call:** search (from four personas), portrait tiles, the
  default mark, the Lead Role card, Clear role and Cast; casting is confirmed and runs on this scene
  only. Each user message keeps the persona that wrote it, and the transcript draws a "you now
  play X" line where it changed (`scene.cast.line`). Parts: `scene.wings.tabs`, `scene.cast.character`,
  `scene.cast.persona`, `scene.cast.hero`, `scene.cast.portrait`, `scene.cast.identity`, `scene.cast.footer`,
  `scene.cast.swatches`, `scene.cast.theme`, `scene.cast.rating`, `scene.cast.tags`, `scene.cast.lorebooks`, `scene.cast.variants`, `scene.cast.revert` (the quiet
  back-to-version line), `scene.cast.starring`, `scene.cast.emoji`, `scene.cast.injection`,
  `scene.cast.persona.stats`, `scene.cast.preview`, `scene.cast.default`, `scene.cast.new`, `scene.cast.picker`,
  `scene.cast.picker.color`, `scene.cast.confirm` and `scene.cast.participants`. Swapping, saving and switching a look all wait while a reply is being
  written, and say why. **Participants** is RoleCall's Participant Registry (see Cast: Participants below).
  **Prompt Injection** opens with a status line: the scene's preset is scanned with the assembler's own
  test (`personaMacroBlock`, core/assembly/preset.ts) and, when a block that is on already carries
  `{{persona}}`, it says "Auto-injecting via <block>" and the four stops (World, Character, Scene,
  Depth) are shown but cannot change; otherwise it says "Choose where your persona appears in the
  prompt". The Depth stop has RoleCall's Message Depth slider (0 to 20). "Custom wrapper text
  (optional)" is prepended to the injected block. **Live Preview** is the persona block `assemble()`
  itself sends for the draft (`personaBlock`, core/assembly/persona-preview.ts: the scene's frozen card,
  no preset, macros and wrapper expanded), headed "@ <stop>" or "via {{persona}}", with the scene's
  own token counter (`countText`) under Tokens. The assembler reads the stop and depth (RoleCall
  stores them and ignores them; this is a deliberate deviation). World puts the persona first in the request,
  Scene right after the scenario block, Depth before the message that many back (default 2, the stop's role,
  system when unset), through the same placement the lore uses (`core/assembly/persona-place.ts`); the
  trace names it "Persona". Character, no stop, and the stops this version does not move leave the persona
  in the preset's `{{persona}}` block, or the block the assembler adds when the preset has none. A preset
  block that already carries `{{persona}}` always decides, which is why the stops are locked then. The
  Live Preview shows the same block at the stop, so it matches the request.
  Left out on purpose: the persona's image generation, RoleCall's override, republish and fork
  routes for cards, its Publishing Controls card (a local library has nothing to publish, so only the content rating stays, titled Content Rating), its visibility status, the Tagsheet modal's categories, and the preset block's category (a Bunzai block has none, so the preview header does not name one).
- **Cast: Participants** (`scenes/cast/cast-participants-tab.tsx`, RoleCall `ParticipantRegistryPanel.tsx`). A hero ("Shared registry", "Participant Registry"), the Registered, NPCs and On Stage counters, **Reconcile recent scene** (a slider of 1 to 500 newest messages, default 12, and Reconcile), then Main Character, Player, Cards and NPCs, each row a swatch, an editable name, MAIN and kind chips, the Ping (`@Name`), Color and Scene lines, and the actions: Anchored to the scene card (the scene's character, which Unset Main cannot move) or Set Main or Unset Main, Colors (up to three stops, + Gradient, Clear) or Uses Card Gradient, a Scene select (Present, Background, Absent), and Delete. The card and the player are read from the cast and stored only once changed; NPCs default to Background. **Delete retires** (the participant is kept and a Retired section lists it with Restore); the character and the player have no Delete, where RoleCall's is undone by its next roster read. **Add participant** (`cast/add-participant.tsx`, below the NPCs; also the footer of the Messenger Cast member list) opens a small form for a name, an optional note and Present, Background or Absent, and sends one add run with its own run id through the same writer as Reconcile; a name already on the roster is refused in the form, and the store refuses it too. **Reconcile** asks the scene's model (one JSON answer, one repair, per 12,000 characters of the selected messages), lists the new names it found (RoleCall's candidate rules and duplicate ladder; a retired NPC is not proposed again) and stores nothing until you tick names and press Add selected; the run has an Undo that retires what it added. Colour editing and per-speaker quote colours need the **Dialogue Colors** Prop (RoleCall's Character Voices colours; off by default): while it is on each quote in a reply takes the colour of the participant named by RoleCall's three patterns (a name and a speech verb after the quote, before it, or a name and a colon), else the main character's, with the palette hash as the default colour; the colour is held to the theme's text floor and a gradient draws its first stop. Left out on purpose: Roster Director (Bunzai has no agent that maintains a roster), the Voice line and editor and the speech-routing words in the hero (text-to-speech is out of scope), Suggested Main Slot, model-labelled speakers (`label_speakers`), Cancel on Reconcile, and group participants. Scene presence is stored and counted but nothing in 1.0 reads it, as in RoleCall's solo chats outside TTRPG mode. Evidence: unit-proven and JSDOM-proven; not live-proven. (ChatStore rule 41.)
- **Deleting messages.** A message's trash button opens RoleCall's menu. "Delete this message" cuts
  it at once; "Delete this & all after" asks RoleCall's "Cut from here?" first, which Shift skips. A
  cut leaves a restore line where it was, one for each run of its messages (store rule 11), restorable
  for 1 day (the Trash's window for cut messages); a
  "from here" cut restored after new messages were sent comes back as its own take. Menus close on
  Escape or a press outside them.
- **Removing a version.** On a reply with more than one version, More ends with "Remove version N of M" under a rule,
  in the danger tone (approved wireframe `rc-port/scene-version-remove.html`; RoleCall's "Delete version n/m" deletes for
  good after a confirm). It cuts the version showing at once, with no dialog, through `POST /api/chats/cut-version`
  {chatId, messageId, swipeId, expectedVersion}: the counter drops to M-1 and a toast offers Undo (`restore-version`).
  With one version left the row reads "Remove this version" and is disabled (a reply keeps at least one version), as
  it is while a reply is being written. The version waits in the Trash until restored; restoring puts it back in
  its place and does not change the version showing.
- **Hide from AI.** RoleCall's eye in a message's action bar (after More, before the trash; "Hide from AI", or "Show to AI
  (currently hidden)" once hidden) toggles ChatStore rule 30 through `POST /api/chats/hide`. A hidden message stays on
  the page dimmed to 30% with an amber "Hidden from AI" line under the bubble and is left out of the prompt (`loadTurn`); a SillyTavern chat imports its
  hidden lines this way.
- **Undo last edit and Edit history.** Every saved message's More menu (it also holds Branch from here, never on the first
  message) opens by reading that version's earlier texts through `GET /api/chats/swipe-history` (`swipeHistoryOf`,
  guarded by the shown take and version like `/api/chats/swipe`; it answers the `swipeId` and the texts, oldest first, from
  ChatStore rule 5). "Undo last edit" puts the newest earlier text back and "Edit history (n)" opens a list over the bubble,
  newest first, with the text now on top and a Restore on each earlier one (rc-port/scene-history.html; RoleCall has no list,
  only a 12 second in-memory undo for toolbar edits). Both items are disabled until the count is read and on a version that
  was never edited. Undo and Restore save through the ordinary `POST /api/chats/edit` at the shown version, so the text they
  replace joins the list and either can be undone; the "Edit undone" or "Earlier text restored" toast offers Redo for 8
  seconds. The list opens below the bubble when there is no room above it. There is no "edited" mark (RoleCall has none).
- **Compare versions.** On a reply with more than one saved version the counter gains RoleCall's Compare button (between the
  count and the next arrow; `SwipeCompareModal.tsx`, opened from `EditableMessage.tsx:1964-1972`). The dialog shows two panels:
  the left on the version the reader was on, the right on the next one (the previous when the current is the last). Each
  panel has its own previous and next arrows, "Version N", the time, the model ("Unknown Model" when the version has none)
  and a Generation Details fold (preset, temperature, top P, top K, min P; "No generation details available" when there are
  none), and a notice when both panels show the same version. Like RoleCall it only shows; there is no way to pick a version
  inside it, the message's own counter does that. A panel opens one version at a time through `GET /api/chats/swipe`, at the
  take and version the page shows, and a version already read is not read again. The text is shown as stored, not
  macro-expanded (RoleCall does the same).
- **Search in the scene.** Ctrl+F (Cmd+F), also while typing, opens RoleCall's search panel at the top of the transcript
  (`ChatSearchOverlay.tsx`, `useChatSearch.ts`): a "Search script" field, the position and previous and next buttons
  (N/M), Newest or Oldest, the filters All, the character, the persona and Thinking with their counts, and for each match
  the speaker, the time, a 50-character context with every word marked, and Hidden or thinking tags. Two or more
  characters start it, after a short wait. Every word must be in the message (any order, ignoring case); words are the
  query split on spaces, 2 characters or longer, at most 8. Up and Down step through the results (wrapping), going to
  each one as they land; Enter or a click goes to the one chosen; Esc, or a press outside the panel, closes it, and Esc
  closes it before it stops a running reply. It searches the whole take through `POST /api/chats/search` {chatId, query}
  (ChatStore rule 35: the store walks the take, opening only the shown version of each message; the text is encrypted at
  rest, so nothing readable is indexed and nothing but the 200 newest hits is sent, each with its context): a hidden
  message is found, a cut one is not, and above 200 matches the panel says so. RoleCall's "Load All Messages" button
  has no counterpart because the search already covers the whole take. Going to a hit that is not on the page loads the
  pages between it and the loaded ones in one step (the same guarded loader as "Load older messages"), scrolls it to the
  middle and rings it for 2 seconds; a far hit therefore puts the messages between it and the tail on the page. Two
  RoleCall faults are not copied: its mark covers only the whole query as one string, so a query of words that are not
  next to each other marks nothing, where here every word is marked, and its `*(action)*` reading printed the closing bracket
  twice. **Jump to latest** is RoleCall's square icon button, centred above the composer (`SceneJumpToLatestButton`): it
  shows whenever the reader is more than 64px from the bottom, except while a reply streams to a reader who is
  still within 160px of it, and takes the reader to the bottom.
- **Styled cards in messages.** A message may carry its own `<style>` and the CSS-only card pieces RoleCall renders (radio
  tabs, flip cards, `:hover`, `:checked`, `:target`), through the one message pipeline (`prose-core.ts`, `message-html.ts`,
  `message-css.ts`, `prose.tsx`). A `<style>` that closes is lifted out of the text (one that never closes, or one shown in
  a code fence or quote, stays text) and scoped with the theme-mod CSS tokenizer, never a regex and with no new dependency
  (RoleCall scopes with postcss, `sanitizeHtml.ts:244-345`; SillyTavern prefixes `.mes_text`, `chats.js:536-626`). Every
  selector starts at that one mounted message's root, so a rule cannot reach another message, the composer or the protected
  layer; `body`, `html` and `:root` mean the root itself and may only paint it; classes take the same `custom-` prefix the
  HTML gets; and ids, `for`, `name`, `#fragments` and keyframes are renamed per mount, so two copies of one message (list
  preview, compare, swipe preview) never share a radio group (RoleCall hit this too, `sanitizeHtml.ts:143-165`). Properties
  are the inline allowlist plus position, transform, transition, animation and the 3D flip set; `position: fixed` becomes
  `absolute` inside a root that clips its own paint (`contain: paint`, `isolation: isolate`), as RoleCall does
  (`sanitizeHtml.ts:321`). No `url()`, no `@import` (SillyTavern drops it, `chats.js:605`, and the app's own CSP would block a
  font stylesheet anyway), no `@font-face`, and an animation may only name keyframes the message defines. A sheet over 64,000
  characters or 20,000 tokens, or one that does not parse, is dropped whole and the message HTML still shows; a rule that
  cannot be scoped, or that nests, is dropped alone. `nav`, `label` and radio or checkbox `input`s are allowed and nothing
  else (RoleCall allows any input `type`, `sanitizeHtml.ts:445-491`); `data-*` is not allowed (RoleCall allows it,
  `sanitizeHtml.ts:539`, but the app finds its own controls by `data-` attributes). A message with a stylesheet merges its
  HTML blocks into one card so sibling selectors keep their siblings, and a `#fragment` link points at an id of the same
  message. Remote images stay blocked.
- **Takes.** The take pill (Director's Cut, or the take's name) carries a count of the scene's takes
  when there are others, and its tooltip and label read RoleCall's sentence ("You are on the Director's Cut,
  the main take. 2 other takes to switch to."; with no other take, "Branch from any message to make
  another one."). It opens RoleCall's Scene Takes: the original take; on a take that forked from another
  take, a Parent Branch row; then the alternates (on the original, its takes; on a take, its siblings),
  each with its date, `msg N` (where it forked) and message count, rename in place and delete ("Delete
  this take" to the Trash; Shift skips the dialog), with the current take's own sub-takes nested under it.
  The footer's "View Full Branching Tree" opens the Branching Tree (`scene-tree.tsx`, part `scene.tree`;
  RoleCall's `/scenes/branching-tree`): "Full conversation timeline with all branches" as a nested
  list, 40px per level, each row a title ("Main Timeline" with a MAIN chip, else the take's name), "n
  messages" and "Branched at msg N", a Viewing chip on the open take, rename (pencil) and delete (trash).
  A click switches to that take and opens the scene on it. Delete is the store's soft delete (the Trash
  keeps the take 3 days) and the page offers Restore at once, where RoleCall's is permanent after a
  browser confirm; a take whose parent was deleted stays on the tree under the original, where RoleCall
  loses it. The tree reads and changes takes only through the scene's own routes (`/api/chats/take|rename-take|delete-take`,
  ChatStore rules 6 and 12), and `listBranches` reports each take's `forkPosition`. More on any message
  but the first holds Branch from here, which opens RoleCall's "Fork this scene" (a name, "Take N" by
  default); Shift starts the take at once. Compare takes, which RoleCall does not have, is the tree row's detail: the compare button on a row picks it, the same button on a second row opens Compare takes (`scene-tree-compare.tsx`, part `scene.tree.compare`, over `GET /api/chats/compare-takes`), which counts the messages the two takes share and lines up the rest by position, marking the words that differ with the same word diff Final Cut uses. It is read only and switches nothing.
- **The latest card.** When the Library holds a newer version of the scene's character, RoleCall's
  gilt Update available badge shows in the header and on the Cast wing, over a line saying
  which version plays. Update, after its confirm, moves the scene onto the newer card and keeps the
  old one: the Cast wing then offers Back to version N (store rule 13). Messages never change. A card
  that left the Library leaves the scene on its own copy, and the Cast wing says so.
- **The AI wing's Generation tab** (`generation/generation-tab.tsx`, part `scene.generation`; RoleCall's right-wing AI > Generation, `SamplerPanel.tsx`): the hero ("Narrator output controls", "Generation"), "N parameters enabled" with Reset, a search ("Search parameters by name, description, or alias...", matching the name, description and alias of every card; while it is typed the callout, Thinking in Replies and Custom Request Parameters hide and the matching cards show flat), then the groups in RoleCall's order. **Core** (`scene.generation.core`): Temperature, Top P, Top K and Max reply length, each a card with its parameter key and RoleCall's footer, "From preset" or "Changed for this chat" with Reset to preset, or "Not set: the provider decides" where neither the preset nor the scene sets a value (RoleCall shows invented defaults there). They are the scene's own sampler overrides (ChatStore rule 19), the same values and the same debounced writer (`own.edit`, which applies each change on the latest values) as the Prompting wing's Preset tab and the Control Booth, so a change in one reads in the others (RoleCall keeps a second store for this panel, flaw F1); a scene with no preset says to choose one in Prompting. Reset clears the Core overrides, Reasoning Effort and every switched-on parameter below, and never touches library preset text. The "Two kinds of thinking" callout, then **Reasoning**: Reasoning Effort (Auto, None, Minimal, Low, Medium, High, X-High), the scene's own setting (`prompting.reasoningEffort`, rule 37), sent when a reply is written by the connections that take it: Anthropic (a thinking budget as a share of the reply length on Claude 3.7 and 4.x models, adaptive thinking with an effort on Opus and Sonnet 4.6 and later), OpenAI (`reasoning_effort` on o-series and gpt-5 models only), OpenRouter (`reasoning.effort`) and Google (Gemini 2.5 and 3 models). Other connections ignore it and the card says so; Auto sends nothing. As RoleCall does, a Claude model that thinks by default and can be told not to is sent `thinking: disabled` when no level or budget is set, because an omitted field leaves the choice to the model. A level other than None is also Enable Thinking, the switch Clear Thinking hangs from. **Reasoning continuity (advanced)** (`prompting.continuity`): the signed thinking blocks of earlier replies go back to the model that wrote them, over Anthropic connections only and only while Reasoning Effort has thinking on (RoleCall's legacy flag turns thinking on by itself; here it does not); every other connection is never sent them, and the signature is kept with the reply (`generation.reasoning.signature`). **Thinking in Replies**: Start Reply With (the scene's own text, `prompting.prefill`, replacing the preset's prefill) with its role (assistant prefill, user hint or system note; a user or system text is sent as its own final message to any model, and Claude 4.6 and later, which refuse an assistant prefill, get RoleCall's warning with "Ignore for Claude" and "Send as user message"), the common tag shapes, and Catch thinking (`prompting.capture`): Auto catches the preset's own markers, the Start Reply With tag (even when only its closer comes back), the built-in thinking tags, tag names that look like them, a tag that never closes, a Thinking: heading followed by a Response: heading, thinking that runs into the reply with no space after a reply-planning opener (once the reply is finished), and Smart Recovery; Only these catches exactly the picked built-in tags and the person's own opening and closing text, closed blocks only; Off catches nothing. Smart Recovery asks the scene's own model, once, for the first words of the visible reply when the last reply (or two of the last eight) had thinking and this one has none; only a verbatim, unique answer sets a boundary, kept with the reply (`generation.thinkingEnd`), and RoleCall's helper model is not used because Bunzai has none. Catch thinking changes how every reply of the scene is shown (the reasoning blocks, the Find bar's thinking marks, Expand as character), never the stored reply. "Let the model see its old thinking" (`prompting.keepThinking`, off by default): off, an earlier assistant reply's thinking is taken out of the history the model reads and of what history macros read, so the Prompt Inspector and the Tokens view show the request as sent; a person's own messages are never cleaned (RoleCall cleans every role). "Show Prefill in Chat" (`prompting.showPrefill`): a reply shows the Start Reply With text it was written after, in front, while it streams and after it is saved (RoleCall shows it only while streaming), kept as `generation.prefill` and only when it was sent as the assistant's own opening. After Thinking in Replies come **Nucleus Sampling**, **Repetition Penalties**, **Output Constraints** and **Advanced** (`generation-params-groups.tsx`, mounted through `generation/params-panel.tsx`), each a collapsible with "N/M enabled" and a line of purpose, a card per parameter with its switch, and a "Not sent to <connection>" marker for a connection that does not take it, then Custom Request Parameters and RoleCall's closing note. Their switches write `ChatPreset.samplers.params`, and the count above is the sum of all of them. Streaming Responses is not drawn.
- **Replies.** A scene answers through one of Kit's saved connections, picked in the AI wing
  (`scene-ai-tabs.tsx`, `scene-ai-wing.tsx`; RoleCall's right-ai wing, opening at 720px and resizing like every wing, "Tools / AI" over
  two cards, MODEL and GENERATION; the Generation tab is described below).
  The Model tab is RoleCall's ModelSelector: the AI Brain hero ("Select AI Model") with a close
  button, a search, the pills "+ Connect Provider" (opens Kit's connections in Settings), "All
  Providers" and one per connection, Currently Selected with its Active chip, Favorites, then each
  connection's models ("Model from <connection>", with the connection's stated context window as a
  chip when it states one; there are no Fast or Vision badges, as Kit's listing carries no such data).
  A connection scenes cannot use yet is greyed with the reason; one whose list fails says so inline
  with Retry and still offers its saved model, and the others are unaffected. Each connection's list is
  read once and kept for five minutes (also for the Control Booth's pickers), search and the pills
  only filter what was read, and a long list draws only the rows on screen. A pick is the scene's
  (`setSceneConnection`); favorites are the studio pref `scenes.favoriteModels`. With no connection the capsule says so and points at the AI wing. Sending shows RoleCall's
  Starting chip, then the reply writing itself into a glowing bubble; the red square stops it and
  keeps what arrived (so does Esc, unless a menu, wing, dialog or editor is open and takes the press first). A take that ends on your
  message, which a stop with no text or a cut reply leaves behind, offers Ask again on that message. Every saved message has a meta row under its bubble (it shows on hover, and always on the last reply): the
  time ("Today at 3:05 PM", or "Oct 4, 3:05 PM"; `scenes.showTimestamps` in the app preferences turns it off, on by default; under RoleCall's chrome, `html[data-chrome="rolecall"]`, the time is printed in 9px at the foot of the portrait instead, as RoleCall's ImmersiveMessage does, and a user message has no meta row), and on a
  reply the model, how long it took and the provider's own finish reason as a chip (length amber, content_filter and error red, tool
  calls and stop sequences grey, anything else muted), then the version counter. Any reply with several versions has the counter and
  browses them, older ones included; picking one moves the take to it. Only the last reply carries Regenerate (its right arrow
  regenerates at the newest version; an older reply's right arrow stops there); the arrow keys move only the last reply. Continue (the play button next to Regenerate, or Ctrl+Shift+C) writes more on the end of the last reply, in the same bubble and the same version; the store keeps the text it extended as an edit does, so More's Undo last edit takes it back, and a model that refuses to resume a started reply (Claude 4.6 and newer, and deepseek-reasoner) is not sent one: it is shown the reply and asked to go on, and what it writes is added on the end after a blank line (unless whitespace is already there). The opening greeting, when it is all a take has (cutting everything after it leaves that), can be continued too; a scene that has not started shows its greeting without a Continue button. A failure shows RoleCall's card with
  the unsaved draft and Retry, which asks again for the same message. If the take changes while a reply is written, the reply waits on a card to add at
  the end or discard. A reply a crash cut off comes back kept, with an amber line and Regenerate.
- **Reasoning.** A reply's thinking shows as up to two blocks above its bubble, never merged: the provider's native reasoning
  first ("Backstage - Native Reasoning", "Reasoned for 8.4s"), then thinking the model wrote inside the reply's own tags,
  `<think>`, `<thinking>` and `<thought>`, or the scene preset's own reasoning markers ("Behind the Scene", "Thought for 3.1s").
  Each is collapsed to a snippet by default, opens from its header button, remembers that choice per version for the session, and
  has a Copy button. While a reply streams, native reasoning opens by itself with dots and a caret (`scenes.autoOpenReasoning` in
  the app preferences, on unless set to false); `scenes.capLongReasoning` (off unless set to true) holds an open block to 300px with
  its own scroll; the Stage wing switches all three. A reply with thinking and no text says "No reply text" in its bubble and opens its blocks.
  A reply that is only native reasoning is stored as an empty message with its reasoning and times, and the next request leaves it out, as
  RoleCall leaves an emptied reply out; RoleCall itself refuses such a reply, so this is a deliberate difference. A continue that adds nothing is still refused. The times are stored
  with the reply (`Generation.reasoningMs`, `tagThinkingMs`); an import or an older reply has none and says "Native reasoning" or
  "Thought" with no number. The look is the `scene.reasoning` theme surface (src/ui/apps/scenes/variants/scene.reasoning); the Stage wing's Appearance tab switches its preferences.
- **The backdrop.** The Stage wing's Backdrop row (where RoleCall keeps its background picker, the Stage settings panel's "The Stage")
  shows the scene's picture or video and Change, or Pick when it has none; the picker is a dialog with None first, the chosen pack's
  pictures and videos (a pack choice when the library holds more than one, a name filter), the overlay darkness (0 to 95%, RoleCall's
  "Overlay Darkness", 60% until moved), a blur (0 to 20 px, off until moved; the picture is drawn past the frame so the blurred edge stays covered), a video's speed (0.25x to 2x, RoleCall's "Video Speed") and Add image or video, which puts
  new files into that pack through the pack editor's own staging (eight to a save). The pack is RoleCall's saved-backgrounds library:
  adding to it is "Save to library", removing is the pack editor's Remove. A pick is saved at once to this scene only (ChatStore rule 36:
  a pack, an item, the dim and the rate) and None undoes it. The picture covers the scene and is centered, under the messages and above
  the page's own backdrop; a video loops muted and holds still while the tab is hidden. The overlay is the theme's own surface color
  rather than RoleCall's black, so a light theme stays light and its text keeps the contrast the theme chose; a theme's `scene.backdrop`
  slot paints over it. With no pick of its own a scene shows the card's pinned background at the card's overlay, as RoleCall seeds a chat
  that has none (`useCharacterLoad.ts:556-577`); a pick wins. A pack or picture that has left the library is said so in the row and the
  theme's own look shows.
  **Links.** RoleCall shows a typed URL straight from the browser (`BackgroundMedia.tsx`); the page policy here lets nothing load from
  another origin, so "Add from a link" has the studio fetch the https picture or video once and keep it in the pack
  (`server-asset-fetch.ts`: public addresses only, no login or odd port in the link, three redirects each checked, 10 MB for a picture and 32 MB for a video, 30 s, local
  studio only). RoleCall's YouTube refusal is kept; a Vimeo page is not a file, and its iframe would need a looser page policy, so it is
  refused too. A zip of pictures, or a dropped folder that holds only pictures (a SillyTavern `backgrounds` folder), imports as one pack
  (`image-pack`). Not ported: favorites and a per-item overlay in the saved library, which the pack item shape has no place for.
- **The preset.** The Prompting wing's Preset tab is RoleCall's preset panel on your library: pick a
  preset (or none, which sends RoleCall's default order), then its quick sampler bar and its prompt
  list, grouped with a switch per category and per prompt, beside an editor. Switches and sampler
  values set here belong to the scene, marked with a dot, and each sampler resets to the preset's
  value; Context Mode (tokens or messages) swaps the context-size slider for Max Messages (0 to 1,000, default 50),
  whose footer reads "~N tokens (K of T)" from the same window function a send uses; prompt text typed here saves to the preset in the library, so every scene using it sends the
  new text on its next turn. A newer save elsewhere wins, and the wing says so and reloads. "Open in
  Workbench" leads to the full editor. A scene whose preset left the library says so and offers the
  picker; its turns are refused until another is chosen. Above the prompt list sits a collapsed Templates section, RoleCall's
  eight system prompts (Impersonation, New Chat, New Group Chat, New Example Chat, Continue Nudge, Group Nudge, Assistant Prefill,
  Assistant Impersonation): always listed, each showing "empty" or its size and opening into a text area that saves to the preset
  like prompt text, searchable with the prompt search. Today a request sends only Assistant Prefill and, for a continue on a model
  that refuses a started reply, the Continue Nudge; the rest are kept for tools that are not built yet. RoleCall's Behavior section
  (wrap in quotes, continue prefill, names) is not drawn: nothing reads it.
- **Script Sheets** (RoleCall's single-instruction writing setup, its own kind: `entities/scriptsheet`, editor
  `_shared/script-sheet-editor.tsx`, part `script-sheet.editor`). The Preset tab's picker lists every writing setup the
  library holds, presets and sheets together, with a sheet marked "(Script Sheet)" (`_shared/writing-setups.ts`; the
  Messenger's Writing page and a character's starting setup use the same list). Choosing one records its kind with its
  id. The picker starts with **Write a Script Sheet** ("Your instructions in one prompt"), which opens the sheet editor:
  - a name ("My Script Sheet" by default) and one instruction box;
  - **Save & use Script Sheet**, which saves the sheet to your library and then chooses it for the scene. If choosing
    fails, the sheet stays saved and the button offers **Use saved Script Sheet**. Saving again after an edit updates
    that same sheet; it never makes a second one (`new-script-sheet.ts`).

  A scene whose setup is a sheet opens the same editor, with the sampler bar, in place of the prompt list. Its save
  (**Save Script Sheet**) goes through the Preset tab's one writer and its revision, and a conflict keeps the draft and
  says so. Block and template edits do not apply to a sheet, and the Messenger's block switches say so. Going back with
  unsaved changes asks first, and Ctrl+S saves. Context macros are refused as you type (`core/preset/script-sheet.ts`).
  The Booth, Generation and the other readers see a sheet as the preset it sends.

  In the Library a sheet sits in the presets' deck, shown as **Writing** ("Presets and Script Sheets"), whose count
  reads in pieces and which offers both "New preset" and "New script sheet". On the Workbench a sheet opens in the same
  sheet editor (`script-sheet-bench.tsx`, the scriptsheet kind's `editor`), as RoleCall opens it from its Library. Its
  description and samplers sit above it and save in the same revision-checked patch. The Workbench's guards own
  Ctrl+S, the unsaved mark on the tab and autosave, and a sheet that breaks the rules is not saved. **Open as preset**
  makes a new preset from the saved sheet (its blocks, samplers and words) and opens it.
- **The preset tab's layout** *(added 2026-10-24, plan 19, doer 5; unit-proven, not live-checked)*: the list and the editor are RoleCall's split.
  Every group starts folded (Uncategorized included; a search opens what matches and has a clear button), the Templates section scrolls
  with the list rather than sitting above it, and the footer reads "~N tokens (estimate)". The grip between the list and the editor
  (`split-grip.tsx`, a labelled separator) drags the list between 160 and 520 (opens at 220); the width is the viewer's own pref
  (`prompting.listWidth`), saved once when the pointer lifts, with arrow keys (16px) and Home or a double click for 220. Once a
  prompt is open a button folds the list to a 48px rail of one glyph per prompt (RoleCall shows the first ten; here every prompt
  is listed); the expand arrow brings it back. The editor has RoleCall's header (back, name, size, fullscreen); fullscreen and the macro
  preview's expand open over the whole scene (`fullscreen-layer.tsx`, portaled into the scene root, not the page body). The Macro Preview
  (`macro-preview.tsx`) shows only when the text holds a `{{macro}}`, display only (nothing is evaluated), and drags taller between 80 and 640 (opens at
  160, `prompting.previewHeight`). A sampler is a card with a "?" for its help, a coloured value you click to type (Enter keeps it held to the range
  and step, Escape drops it) and the slider. RoleCall's prompt-name editing and its Model type filter are not carried: the name belongs to the Workbench.
- **Choices.** A preset that declares choice groups gets a slim "Choices" row above the sampler bar (`scene-choices.tsx`, part `scene.choices`; RoleCall's `ChoiceGroupsSection`): "n of m customized" and an Open walkthrough button. The first time such a preset loads for a scene a small dialog offers the walkthrough once ("This preset has options and a guided walkthrough. Set it up now?", Use defaults or Walk me through; remembered per scene and preset). The walkthrough (`scene-choice-walkthrough.tsx`) is an optional "About this preset" step from the preset's readme, one question per group (option cards for a select, a switch for a toggle, a text field with suggestion chips for an input, a Read more fold, and an eye on any option that names blocks to read them), and a summary with Change links. Every pick is saved as it is made, so closing keeps the progress; Next waits until a group is satisfied; a select_one advances itself after a pick. The answers are the scene's own (ChatStore rule 42) and decide which blocks a request sends, and the prompt list shows the effective switches. The last button is RoleCall's "Save & done": it also keeps the run's answers as your defaults for that preset (an app preference, `scenes.presetChoiceDefaults`), which a scene reads for any group it has no answer of its own for, new scenes and old alike; the scene's own answer always wins.
- **The World wing.** Its Lorebook tab is RoleCall's lorebook panel on your library, drawn to RoleCall's layout (sizes and spacing in px from its source, colors as theme roles so your accent and theme apply; type below 12px is raised to 12px). A header row holds a back button (once a book or the picker is open), the book icon, "World Info" or the open book's name, and an inline stat line ("· 1 book · 213 entries · 92.6k tok"; inside a book just entries and tokens, counted by the same estimator the rows use). Two panes swap, never three. With no book open, "Active lorebooks" and its count sit on the left: each book is a card with a dot for on or off, its name, its entry count and where it came from (the character's own books and your persona's arrive switched on and can be turned off without unlinking; a book the scene added can also be removed), with power and trash buttons on hover. The right says "Pick a lorebook" ("No lorebooks linked" with none). The dashed "Add Lorebook" button at the foot opens a popover with "+ New Lorebook" (name it, Create: the same empty-book factory and save call as the Library's own "New lorebook", then it joins the scene and opens) over My Library; the header's library button opens the same list full pane. A book already in the scene is listed but cannot be added twice, and each row's entry count comes off the library listing, so no book is read to draw it. Picking a book replaces the list with the entries panel: "+" (a new entry, RoleCall's "New Entry": selective, no keys, depth 4, one sortOrder past the highest) and open in the Workbench (on the selected entry), a search over titles, text and keywords, then the collapsible Constant and Selective groups in sortOrder beside the editor. The list is virtualized, so a 200-entry book mounts about a dozen rows. Each row shows the title and "~tokens", dims when disabled, and its "..." menu offers Open and edit, Disable or Enable entry, Move up and Move down (within its own group, swapping sortOrder with the neighbor it passes, both in one write) and Delete entry (a confirm dialog; the library keeps versions). When the take's last reply has a lore trace, a fired entry is marked with why (always, the word it matched, sticky, or matched but cut for space) and a footer counts what made it in. The editor opens beside the list: a dot (blue constant, green selective), the on switch, the title, the token estimate and a close button; the keywords box (three chips, then "and N more"; Enter adds a word, and /pattern/flags becomes a regex trigger, refused with the reason when it will not compile); the content with its macros row and the house Expand control (RoleCall's maximize icon sits on the label row, here the shared Expand sits on the box); and the "Show advanced settings" card, closed until opened and then remembered across entries (`scenes.loreAdvanced`). Open, it adds the header's Type, Preserve, Order and Scan boxes, Simple or Advanced keys (the entry's percent, or each key's own percent and cooldown, edited in place), the logic between the two key boxes and the secondary box, "+ Condition" (only the special keys a turn evaluates: recency, message count, random chance, generation type, emotion), the seven Injection cards (World, Character, Scene, @ Depth and Append with their depth and role, Top, Bottom), Timing (Sticky, Cool, Delay), Recursion (Normal, Prevent, Delay), Group with its weight, and the Character Filter (Whitelist, Blacklist, None, names and #tags). "Order" is the entry's sortOrder, the field Move swaps and the engine places by. RoleCall's Order box wrote `priority` (its placement and budget key at once) while its Move wrote sortOrder, which its engine does not place by; here placement is sortOrder and the budget cut is `priority`, which this wing does not edit (the Workbench does). The book is read without its escrow (`getLightEditableEntity`) and a save sends only what changed (`patchEditedEntity`): the one edited entry, or the swapped pair. Typed edits wait two seconds after the last keystroke and flush when the entry, the book or the wing closes, and save as an autosave; adding, toggling, moving and deleting save at once as manual saves, so the library keeps a version to recover from. All of it goes through one queue and the book's revision, so a fast second action is never lost and a conflict reloads the book and says the edit was not saved. Below the card sit RoleCall's Side Effects (Add Effect; each row a Set, Append, Increment, Decrement or Delete of a named variable, local or global; "Only on first trigger" and "Clear when deactivated"), the Character Filter, and Cross-Entry Boosting (type another entry's name, or its id, and Enter; the amount from 0 to 1 and the "boost probability of listed entries by N%" line). Side Effects run on a reply, over the scene's own variables, before any macro resolves (`{{getvar}}` in the same prompt sees them); they write nothing for a draft or a turn cancelled at the Prompt Inspector, and a new version of a reply starts from the scene's variables as they were before the one it replaces (the local ones are rebuilt from the shown history, [scene-state.md](scene-state.md); the library's global ones are put back from the replaced reply's trace), where RoleCall counts an Increment twice. A boost adds its amount to the chance of each listed entry of the same book that also matched. Preserve (RoleCall's lock, between Type and Order) sets `metadata.preserve_during_standardize`: a Standardize run leaves a preserved entry out of what it sends and never rewrites it, and the entry still fires like any other. Not drawn: RoleCall's Category picker, Plotlight search and Fork have nothing to talk to here. The on switch is square and the Expand control is the house one, where RoleCall's are round and an icon.
- **The World wing, chrome and Compendium tab.** The wing opens at RoleCall's width (1258px, or the whole pane on a narrow one) under the crumb "Scene / World" and two equal cards: LOREBOOK with "N linked" (the books switched on; RoleCall's own count) and COMPENDIUM. The Lorebook tab stays mounted while the Compendium shows, so a pending typed edit is never lost to a tab change. The Compendium (`compendium/`) is RoleCall's living world reference, read only for books: its views read the open book once (`getLightEditableEntity`, no escrow), derives everything from it once (`core/compendium`), and the views write nothing, not the book, not the chat's settings, not a preference. Only the Settings tab and the access chip write, and only the chat's Compendium settings, when you change one. With no usable book it says "No active lorebook to browse." and "Add a lorebook to this chat to see the compendium." Otherwise: the hero ("Living world reference", "The Compendium"), the tab row Dashboard, Browse, Storyboards, Activity and Settings (a dropdown under 512px), and the book bar ("Compendium", the book's name, a dropdown when the scene has more than one book, and an access chip: Read-Only by default, showing the chat's Compendium access; it opens a popover with four choices and saves the pick). Dashboard: the header (crumb, the book's name, a Tree maintenance disclosure (below), "Updated" and the time of the newest filed or restored write (skipped and failed receipts do not count), or "Updated -" before any, "TV Tree · N nodes · depth D", the EXPORT button and the RECONCILE (N) button when a writable book holds one-sided relationships), then World Concepts, the Of Note strip (item, org, event), and the cells Featured Cast (arc dots, relations, memories, cross-refs), Entry Counts, Recent Writes (the entries the receipts filed or restored, newest first, each with its verb and time; "No recent writes yet." before any), Plots in Motion, Threat Radar, TV Tree Structure with OPEN FULL TREE, Historian's Recaps (by Plot), Cross-Reference Graph (a small radial, "N cross-references · tap to explore", and a click anywhere on it opens the explorer below; under 600px the radial gives way to RoleCall's VIEW CROSS-REFERENCES button), Spotlight Location and Featured Creature, each with RoleCall's empty line; a click opens the entry in Browse. Browse: "The Catalogue" (search "Search the codex...", then By Type, TV Tree and Summaries, one virtual list, so a 213-entry book mounts a screenful) beside the entry's page or "Select an entry" (one pane at a time under 600px, with "Back to list"). An entry's page has the breadcrumb (a place walks its parents), the portrait as initials in the type colour (an imported `image_url` is not fetched), the type chip, name, tagline and description, the type's field blocks in RoleCall's order and labels, "Other Fields" for anything authored that no block names, Referenced By for a character, and Linked Entries. Storyboards (`compendium/storyboards/`, `compendium/tabs/storyboards.tsx`) is described under the Props wing below. Settings is the mounted Settings tab below. Activity is the receipts feed (below). EXPORT (`ExportButton`) downloads the open book (the one picked in the book bar) as RoleCall's compendium file, named `<name>__<timestamp>.compendium.json` as RoleCall names it: the server streams it entry by entry (`/api/studio/export-compendium`), the page drains it into a Blob and saves that, and a refusal is said in the status line. The file has no tree (Bunzai derives it) and imports back whole. Standardize is the banner below the header (the Standardize paragraph). Not built here: rename, the star, an entry's "..." menu, edit and delete (they write). RoleCall differences: its Affiliation and Grade tiles read fields its own schema never writes (`affiliation`, `rank`); here Grade reads `rank` else `tier`, and Region / Type reads `type` too.
- **The Cross-Reference Graph explorer.** RoleCall's fullscreen `GraphExploreModal` (`compendium/graph/`), opened from the Dashboard cell. It is a modal in RoleCall (it does not float), so it is a dialog here and not a pop-out kind. Header: BACK, "Lorebook · <book>", "Cross-Reference Graph" and CLOSE; left column: Find Entry (a match count, or RoleCall's example line), Entry Types with a count each, Connection Types (Relationships, Affiliations, Location Links, Participation, In Summaries, with RoleCall's dashes) and Display (Show orphaned nodes, Show edge labels); the graph; a status bar (entries, nodes and edges, how many are visible, the selected node, zoom, and "SCROLL TO ZOOM · DRAG TO PAN · CLICK NODE TO INSPECT"). The graph is every typed entry as a ring in its type's colour (sized by how often it is referenced, with initials and, zoomed in, its name) and a line per resolved link in its kind's colour; a name that resolves to no entry and a self reference are not drawn. Drag the background to pan, scroll to zoom about the pointer, the +, - and FIT buttons (steps of 1.3); hovering or selecting a node lights it and its neighbours and dims the rest. Drag a node to move it (RoleCall's `enableNodeDrag`): the node follows the pointer at the current zoom, its links follow it, and a drop leaves it where it was dropped (RoleCall frees the node on drop and its physics lets it drift; here nothing is pinned and there is no physics, so it stays); the move is for this opening only, since RoleCall keeps no positions either, so closing the explorer or a new book revision puts every node back where the layout settled it, and the layout is never computed again for a drag. A drag that moves is not a click and does not select. A node takes keyboard focus (Tab), and Enter or Space selects it (RoleCall's canvas has no keyboard path). A click only selects (RoleCall's too): the right panel shows its type, name, total connections, a count per connection kind, Connected to (a click selects that node) and OPEN IN CODEX, which closes the explorer and opens the entry's page in Browse. A click on the empty graph deselects. Differences from RoleCall: all eleven entry types can show (its list stops at nine, so creatures and powers were silently never drawn); the layout is settled once per book revision with `core/lore/web-layout.ts` (fewer steps for a bigger book, never fewer than six) and cached by the revision's graph, so the filters, search, selection and camera never lay it out again and a hidden type never moves the others (RoleCall restarts a physics simulation); an edge kind RoleCall does not name (a possession, a family tie) still draws under "In Summaries", as there; the "Layout settled" light and the loading line are not built (the graph is already computed and nothing moves after it settles), and dragging a node does not tug its neighbours (RoleCall's physics keeps running while it moves; here only the dragged node moves); type is at the 12px floor, so names show from 100% zoom, and a selected, lit or searched node always shows its name. Evidence: unit-proven and JSDOM-proven; not checked in the running studio (to look at: a 400-entry book's first open and the camera's feel, the node colours on the dark and light themes).
- **The Compendium Settings tab.** `CompendiumSettingsTab` (`compendium/tabs/settings/index.tsx`) is the World wing's Compendium > Settings tab, RoleCall's Settings page (`CompendiumSettings.tsx`): an eyebrow, "What Compendium remembers" in the display face, Essentials and Advanced, and section cards with a dot, an uppercase title and a blurb; square corners, theme tokens and the scene's accent, type raised to the 12px floor. Essentials: Compendium (a switch RoleCall lacks, off until you turn it on; while off nothing is read or sent), Model (the scene's own model until you pick another from the AI wing's list, with a way back), Books in this chat (a switch per book, Access of Read and write, Read only or Write only, Make default, and "Make a book for this scene", which makes a library lorebook named "<scene> Compendium", adds it to the scene, grants write and makes it the default write book) and Before a reply (Recall from Compendium, what it should prioritize, and a Guide from your Guides list whose current text goes first). Books start read only, where RoleCall starts them read and write. Advanced: Retrieval tuning (max and minimum entries, entry detail level, context messages, collapsed depth, multi-book display), then Narrator lookup (one switch, "Narrator explore tool", off by default; it says when the scene's Narrator Tool Access is off, since the narrator then receives no tools). The book bar's access chip (`access-chip.tsx`) shows the open book's access and offers RoleCall's four choices (Read + Write, Read-Only, Write-Only, Disabled) with their copy, through the same writer. Showing the tab writes nothing; every row writes its own field (`POST /api/chats/compendium`, `setSceneCompendium`), and a refused save is said in the status line. Filing's rows are drawn because the filing pass reads them: After a reply (File lasting changes, What should it preserve? with a Guide, How often every N of your turns, and When to file, defaulting to On your next message with Right away and After 2 to 5 more messages as the other choices), Output language (blank follows the narrator) and, under Advanced, What Compendium may file (a switch per entry type; none on files nothing). Advanced also holds Standardization defaults (batch size, model source, auto-retry, original content kept and locked on, Revert Last Standardization on the open book), each read by the run. Under Advanced it also holds Tree and entry constraints and Tree building (below), Historian summaries (Interval, Context overlap and "Summary-aware context truncation", off by default; see the Historian paragraph below), Import chat history (below) and Diagnostics (a "Narrator tool calls" row states the Narrator explore tool and Narrator Tool Access and warns when the tool is on without access; `Run Diagnostics` lists PASS, WARN and FAIL rows by category: the books in use and write access, a tree per book, total and empty entries, near-duplicates by RoleCall's trigram rule over the first 500 entries of a book, entries missing from a built tree, the Historian interval, the recall token budget (RoleCall's "Retrieved lore token budget": the lore share, a quarter, of the window a turn of this scene fits into, worked out by the turn's own window functions with the preset's Context tokens, warning under 512 tokens), and recaps with no plot; RoleCall's summary-token check is not ported (RoleCall stores the summary budget and never reads it); it writes nothing), beside Standardization defaults. Not drawn, because nothing reads it yet: Keyword hint matching and Ignore keyword matches, Condition evaluation reasoning, Search mode (recall is Collapsed only), reasoning effort and the maintenance model. 
- **Standardize.** The Dashboard's Standardize banner (`compendium/standardize/`) shows while the book holds classic entries that a run would convert (no type, not retired, not under an entry's Preserve lock; switched-off ones count), in RoleCall's words: "Standardize Lorebook", "N classic entries waiting to convert", START (RoleCall's "STANDARDIZE & BUILD TREE", without the tree, which Bunzai derives) and the run's controls: Batch By Entries or Tokens (with the average tokens per entry), Entries Per Batch with ALL or a Token Budget with 32K, 100K and 200K, Parallelism (concurrent batches), Tool Loop Cap (model rounds per batch) and the model it will use. The controls write the scene's saved Standardize settings (the ones Settings > Advanced shows); Batch By and the token budget are the banner's own, as in RoleCall. START is blocked in words when the Compendium is off or the book does not allow writing, with the button that fixes it (Turn On Compendium, Enable Read + Write). One run works at a time per book, in the background on the server: the banner becomes the progress drawer (batch, "Currently processing", a bar, OK, CONSUMED, NEW, DEDUP and FAIL counts, a live log, CANCEL), the page asks for it every second only while it works, and a reopened tab or a second window finds it. While it runs a notice under the tab row says "Standardization in progress. Edits are paused to avoid clobbering work in flight", and Reconcile, Undo and Revert are refused by the server, not only disabled. A finished run leaves a card: Standardization Complete (rewritten, consumed, new with dedup, failed, where the entries went, the warnings), Standardization Stopped after Cancel (how many were not reached; everything written is receipted and a second run continues), or Standardization Error with its reason and log; each can be dismissed. REVERT (in the banner, on the Complete card as REVERT RUN, and in Settings) takes back the book's Standardize writes from the receipts: "N rewrites restored, N splits retired, N consumed restored", with merges undone, and a list of any entry left as it is because it changed since (Revert Complete) or the reason it was refused (Revert Failed). Differences from RoleCall: splits are retired where RoleCall deletes them, nothing is stamped into a book, there is no Clear Lock (the lock lives only as long as the run), no confirm dialog (a revert only gives back what the receipts hold), and Standardize needs the Compendium switched on. A source larger than about 20 KB of UTF-8 text (about 7,000 Japanese characters) cannot fit a receipt and is left classic with that reason. Evidence: unit-proven and JSDOM-proven against a scripted model; not yet checked in the running studio.
- **Compendium filing, Activity and Reconcile.** After a reply the Compendium can file what lasted into the scene's books (`studio/compendium-filing.ts`). It runs only with the Compendium and "File lasting changes" on, and writes only into books whose access is Read and write or Write only (read only is the default, so a new scene files nothing until you grant write; with no writable book the pass is recorded as skipped and no model call is made). It asks the scene's model (or the Compendium's own) once for a JSON plan, checks each item alone against its entry type (a bad item is rejected and named, the rest go on; an unreadable answer gets one repair call), then sends one revision-checked patch per book through the same save the Lorebook tab uses. It adds and merges (arrays append, objects merge, scalars replace) and never removes an entry; an alias files into the entry it names, and an untyped entry is never rewritten. If you edit the book between the pass's read and its write, the pass reads it once more and retries when every entry it touches is unchanged; if a touched entry moved, that book is not written at all and the receipt says so. By default a reply is filed when you send your next message (RoleCall's write delay of 1); Right away files each reply as it lands, a continue files nothing, and a regenerate first takes back the filings of the version it replaces and files the new one only under Right away, and every filing is a receipt (`filed`, `partly filed`, `nothing to file`, `skipped`, `failed`, `undone`) with the values Undo needs. Cutting a message or a version, or regenerating a reply, takes back that reply's filings (an entry you edited since is skipped and named; a created entry is retired, never deleted), and restoring a cut puts the reply back without filing it again. The Activity tab (`ActivityTab`) lists the receipts newest first under ALL, ENTRIES and TOOLS with a card each (verb, Error chip, phase, model, entry chips, Details, Undo, File again), reads "No activity yet" before any, and Clear feed hides everything older without deleting a receipt; a receipt whose stored cell cannot be read shows as Damaged and the rest still list. A Standardize run's receipts are their own card, Standardized ("Standardized 2 entries (1 merged, 1 new, 1 consumed)": the entries typed in place, then what else the run did, each entry chip saying typed, merged, created or retired) with a layers icon and no Undo, and the undo of one is a Reverted card ("Reverted 3 entries", or "Reverted 3, some left as they are"); neither is worded as a filing. Each entry the recall pass retrieved is a PRE card ("Searched", RoleCall's pre-gen row): the entry's title, its book, Retrieved, its tokens, the model, and a "Why this entry" that opens the selector's reason (shown here only, never sent to the narrator); a pass that picked nothing says "Pre-gen retrieval found no relevant entries for this scene" once, a failed one is an Error card with its reason, and a skipped one adds nothing. Each tool call the narrator made while it wrote the reply is a LIVE card (amber chip, "Searched"): "Retrieved N entries during generation" with the entries as chips, or an Error card ("Lookup failed: <reason>"); Details show the arguments, and the model chip is the narrator's. They are read from the newest five replies' traces (`getSceneTrace`) and listed under ALL and TOOLS; an unreadable trace is said on the feed instead of showing none. As in RoleCall a skipped, failed or nothing-to-file filing is in neither ENTRIES nor TOOLS, only ALL. The tabs move with the arrow keys, Home and End. Historian runs are Summarized cards in the HIST phase and chat-history imports are Ingested cards, each with Undo. RoleCall's LIVE phase is not drawn because nothing produces it here. The feed has RoleCall's pop-out: it is the first registered pop-out kind ("Compendium Activity", see Pop-outs below), so the Pop out button next to Clear feed floats the same feed over the scene, the Activity tab then reads "Activity feed is floating" with Bring back, and the floating copy reads the receipts and traces itself, so it keeps working with the World wing shut. RECONCILE (N) (`ReconcileButton`) opens RoleCall's modal for the one-sided relationships of every writable book: MIRROR, MIRROR GROUP, MIRROR ALL and KEEP (saved on the entry, so the count stops coming back), each one revision-checked, receipted and undoable from Activity. The Dashboard, Browse and Recent Writes re-read the book, and Activity re-reads the receipts, when the library reports a change to one of the scene's books (the same change notification the wings use, no polling), so a filing, an Undo or a Reconcile shows without reopening the tab. Evidence: unit-proven and JSDOM-proven; not yet checked in the running studio.
- **Compendium tree: build, constraints and moves.** A typed book's TV Tree is derived from its entries and stored nowhere; a model-built tree is an option on top of it. The Dashboard header's "Tree maintenance" disclosure has `Repair tree from entries` (`Repairing...` while it runs), which asks the Compendium's model (else the scene's) to sort the book's entries into categories using Tree building's Granularity, Entry detail level and, for a book too big for one call, Placement mode, and stores the result with the scene (ChatStore rule 40), never in the book; `Undo last build` shows the layout before it, or the derived tree when none is left, and layouts are never deleted. The TV Tree shows the stored layout when there is one: an entry the book gained since the build sits under "Added since the last build", one it lost drops out, and recaps and arc overviews stay the live Narrative branch. Right-clicking a branch offers Lock branch, Forbid branch and Reorganize on next rebuild; right-clicking an entry (in the TV Tree or By Type) adds Move to..., which opens a searchable picker and pins the entry under another entry in a "Pinned" branch (applied at once, over the derived and the stored tree alike). A rebuild keeps the choices even when the model ignores them: a locked branch returns exactly as it was, a locked entry stays in its branch, a forbidden branch is dissolved into its parent, a forbidden entry is left under Unsorted, and Reorganize is for one build and clears itself. Dragging an entry onto a branch files it there (a new layout Undo can take back); with no built tree it says "Tree not built yet - build one first". Settings > Advanced lists everything saved under "Tree and entry constraints" (Branches and Entries, with Locked, Forbidden, Reorganize Pending and Pinned chips) with an X that clears an item. A model answer that cannot be read after one repair call stores nothing and leaves Reorganize flags in place. "Refine entries during build" (Settings > Advanced > Tree building, off by default, RoleCall's `tv_tree_refine_entries`) lets a build change the book: after the layout is made, the model reviews each branch that has no branch below it, three at once, and may split an entry that covers several topics (a new entry beside its source, in the same branch) and merge entries that say the same thing (the kept entry takes the merged text, the other is retired, never deleted), at most five operations a branch with the merges first, as RoleCall does. It reuses Standardize's working book, receipt budget and commit loop, and writes a receipt of kind `refine` (Activity: "Merged/Split", with Undo, which gives every original back exactly and retires each split; Standardize's Revert never touches it, and `Undo last build` takes back only the layout; after Undo of a refine receipt a merged entry is live again but sits under "Added since the last build" until the next build). Only live classic entries take part: typed entries keep their data as the authority, an entry under Preserve, a locked or forbidden entry, and a locked branch are left alone, and an entry the person edited while the model worked is left as theirs and named. It needs a book that allows writing, the Compendium on, and no Standardize run on the book; otherwise the tree is still built and the notes say "Refine entries was skipped: ...". A refine that cannot be read or written never fails the build. Differences from RoleCall: it sends each entry whole where RoleCall shows 200 characters and still lets the model write the whole entry (which can overwrite a long entry with what the model saw), an entry takes part in one operation (RoleCall lets a kept entry be split too), the build log is not in the prompt and node summaries are not regenerated afterwards (Bunzai has no node summaries to regenerate), and a merge carries the retired entry's keywords onto the kept one (deduped without regard to case, recorded in the receipt so Undo restores both), where RoleCall drops them. Differences from RoleCall: the choices live in the scene, not as flags in the book; a move by drag is deterministic, not a model call; and a pin applies at once, not on the next rebuild. Evidence: unit-proven (core, studio with a scripted model, both ChatStores) and JSDOM-proven; not yet checked in the running studio.
- **Compendium Historian and Import chat history.** The Historian (`studio/compendium-historian.ts`) runs after the filing pass for the same reply, so a reply held back is never summarized: every Interval (20) of your turns it reads from Context overlap (10) messages before the last recap's end, at most 12,000 tokens a run, and asks for one JSON answer (one repair call) of recaps, each belonging to a plot (a missing plot is made), and each plot's constant "[Arc] <plot>" overview, then writes them as one revision-checked patch with a receipt that shows in Activity as a HIST card ("Summarized") with Undo; cutting or regenerating that reply takes it back. "Summary-aware context truncation" (Settings > Advanced > Historian summaries, RoleCall's `tv_smart_context`, off by default) makes the assembler send the scene's live recaps in place of the oldest messages they cover: a message goes only when a recap's turn range really covers it, from the front and stopping at the first uncovered one, the newest 10 messages always stay, and the greeting and the message being answered are never touched. Each recap is its own system block headed `[Summary: <title>]` after the greeting, and a recap the lore engine already placed is not sent twice. Only books the Compendium may read are used (a Write only book's recaps are not), and a recap with no text covers nothing. The Tokens sheet lists each as "Summary: <title>" under Chat history and its header names the messages replaced ("1 message, messages 2-11 replaced by summaries"). A recap's turn range counts the take's live messages when it was written, so cutting a message inside an already summarized range shifts the later ones by one until the Historian writes again (a known limitation). RoleCall counts `2 x` the last summary's turn number against a list the budget has already trimmed; here the recap's own message range decides. Evidence: unit-proven and JSDOM-proven; not yet checked in the running studio. Import chat history (Settings > Advanced) has Cross-chunk continuity, Ingest model (Compendium model or Scene model), Tokens per chunk (1000 to 32000, 6000), the Search, Facts and Narrative phases, Run Range From and To (of the take's message count), `Ingest Messages` (`Ingesting...`) and `Cancel`, and a progress drawer listing each chunk. It needs a book that allows writing. A run reads the chat in pages of 100 and cuts it into chunks as it goes (never the whole chat in memory), asks the model once per chunk, and writes each chunk as one patch with an `ingest` receipt (an "Ingested" card in Activity); a chunk whose answer cannot be read after one repair call files nothing and the run goes on. Cancel stops between chunks or mid-call; a call waiting on the model holds nothing, so replies and filing carry on. Undo this ingest takes back every chunk, newest first, skipping any entry you edited since. Search shows the call the entries that exist, Facts allows the ten fact types, Narrative allows recaps and plots. RoleCall runs these as tool loops in one conversation; here each chunk is one answer. The run's state is kept by the running studio, so Undo this ingest works until it restarts (Activity's per-chunk Undo always does). Evidence: unit-proven and JSDOM-proven; not yet checked in the running studio.
- **The Props wing.** Each prop declares what it reaches (`reach`: none, the person's model, or the internet; `writes`: whether it writes library data) and the hover card says so; `props/prop-reach.test.ts` fails when a prop's own files use any of the named model or network calls (the tracker generate kit, `proposeTrackerItem`, `proposeTrackerRefresh`, the link and Spotify contract calls) and it declares less; it does not detect a call it does not name. RoleCall's StageProps panel (`StagecraftManagerPanel.tsx`, `StagecraftExtensions.tsx`), opening at RoleCall's 1120px and resizing like every wing (`props/props-wing.tsx`, `prop-row.tsx`, `prop-tile.tsx`, parts `scene.wings` and `props.tracker`). The hero reads "Scene Augmentations", "StageProps" and RoleCall's subtitle, with a Tooltips On/Off switch at its corner: a per-user app pref (`scenes.props.tooltips`; RoleCall keeps it in the browser's localStorage) that shows or hides the hover cards. A hover card (`props/prop-tip.tsx`, RoleCall's RichTooltip) opens 220ms after the pointer or focus reaches a row or tile, never on a touch screen; it is portaled to the page body so no wing edge clips it and `props/prop-tip-core.ts` places it below, above, right or left of the row, whichever has room; Escape, a press elsewhere, a scroll or a resize close it. The peek shows the title and the description and, where the prop has bullets, a line saying so; "?" on the focused row opens the same card with the bullets and a close button. The fold says "N active". "Built-In Props" lists one row per registered Prop in RoleCall's catalog order (Mood Music, then Dialogue Colors, then Bunzai's own): a 32px tile in the prop's colour, its name, a small-capitals line ("Local ambience", "Dialogue color"), a gear while the prop is on (Mood Music and Spotify open their Stage tab) and the switch, which saves at once (ChatStore rule 21). The whole row switches the prop; Enter or Space on the row does too, but only on the row itself (RoleCall's row also fires from its inner buttons, so a gear pressed from the keyboard turned the prop off). Mood Music's "Show Music tab" sub-row hides the Stage tab and keeps playback (a per-user pref, `scenes.stage.musicTab`). Switching a prop on also draws its own element on the stage, outside every wing. Under the rows RoleCall's two boxes, which it draws inside its Story Director drawer and are drawn here under the rows: **Storyboards** (Quest Board, Cast, Map, Renown, with RoleCall's card text, a Live or Off chip and an "N/4" count; Calendar stands dimmed with "Soon" and the reason, because its state exists only in the Story Director's journal) and **Legacy Trackers** (Combat, Stats, Inventory, Knowledge, Party, Corruption, Bonds, Events, Cycles, Spellbook, Memories and Creature Codex, "optional"), each module a tile; a module with sub-features (Knowledge, Cycles, Spellbook, Creature Codex) shows one dot for each on its tile and, while it is on, RoleCall's switches under it. "Coming Soon" holds RoleCall's three inert rows (Immersive Weather, VN Additionals, Web Search). The **Story Director** row (tier "Story engine", id `story-director`, `props/story-director/`) is the first row with its own settings under it, panel and stage button; see the next entry. Not carried: the Interpreter, Scene Frame, Character Minds, Dramaturg, Lore Capture, TTRPG Mode, Carrot Kernel, Rabbit Response Team.
- **Tracker Props.** The twelve legacy trackers (`props/trackers/`, core `core/trackers/`) are RoleCall's immersion modules as Props with id `tracker-<module>`; a tile's gear opens the module's panel in place of the list, under a "Props" back button, docked through `PopoutSlot` so its Pop out button floats it like any pop-out. The frame (`TrackerFrame`, RoleCall's `ImmersionPanelWrapper`) has the "<Label> module" hero with RoleCall's description, a `~Nt` token chip, the panel's own buttons, Panel AI settings and Pop out. Settings holds **AI Context** (Always Include, Every 2 Turns, Every 5 Turns, Never Include) and **Clear All Data** with RoleCall's confirm ("This will erase all data for this tracker. Are you sure?"), after which an Undo bar writes the replaced state back. The settings carry one read-only line about the Story Director's automatic updates (`props.tracker.auto-update`): "Updates automatically every N replies" (the scene's number, or this tracker's own), "Not updated automatically" (this tracker, or the scene's switch, is off) or "Story Director is off", the last two dimmed, with "Change in Story Director", which opens the Props wing at the Story Director's settings; the controls are only there, so there is nothing here to set to zero. Under the strip, "Updated after reply N" with Undo shows the last update a reply's version made to the module on its own (only the Story Director's round makes one); Undo writes the tracker back to before it, as your own edit on that reply (so it holds through swiping and regenerating it), only while the tracker still holds what the update left, and otherwise says "Not undone: ... was changed after the update, so it was left as you have it."; the line goes when you change the tracker, and a second Undo says there is nothing to undo. It is drawn from the trackers' state at the take's tip (`GET /api/chats/tracker-state`, `studio/tracker-state.ts`), so it appears when the app-wide `scene-trackers` studio event for that chat arrives after the Director's background round (the panels then read the trackers and the Director again; a reload shows it too). RoleCall's "Lorebook" row is not drawn: it saves a lorebook id that nothing reads. A module's state is scene state (ChatStore rule 17, [scene-state.md](scene-state.md)): a change is your own edit on the newest reply, written as the rows or fields it changed (`POST /api/chats/tracker-state`, one step for every module it names, so Cast spends Stats and notes the cast in the Spellbook together or not at all), shown at once and written in order as the change from the data the panel computed it from (so what the Story Director added elsewhere meanwhile is kept, and a change to the very row it changed refuses the write and reads again), and a failed write puts the last saved state back. It stays with that reply through swiping and regenerating it, goes with it when it is cut, and a reply cannot be given one while another is being written. Its AI Context, automatic-update choice and sub-feature switches are the scene's settings for the module (`POST /api/chats/trackers`), kept when the prop is switched off, with its state. **Stats** is RoleCall's Player Stats: the Level and XP card, HP, MP and AP bars with their minus and plus (10, 10 and 1), the shield and currency cards, the survival needs (5 a click), a History tab of recent changes with Clear, and Full Restore. The AP minus spends one and the MP minus spends up to ten (RoleCall's AP minus restored, and its MP minus did nothing under 10). **Combat** is RoleCall's Battle Tracker: Start Combat (one "Unknown Enemy", as RoleCall), an IN COMBAT badge, the round bar with Next Turn, and tabs Enemies (Add New Enemy form, cards with HP bar, threat, boss and a damage or heal box, "Damage (+) or Heal (-)"), Turn Order, Combat Log and Dice (d4 to d100, a custom expression such as 2d6+3, a history); a removed enemy is kept for Undo. **Inventory, Knowledge, Party, Corruption, Bonds, Events, Cycles, Spellbook, Memories and Creature Codex** are RoleCall's panels, each in its own folder with its tabs, filters, expandable cards and empty states. RoleCall creates their items only by asking a model, and so do they: "Add ..." takes a name and a guide and Generate asks the scene's own model once (`POST /api/chats/tracker-item`, the Compendium's one-JSON-answer path with at most one repair), and each card's Refresh does the same for that card. The answer is a PROPOSAL drawn under the form with Accept, Try again and Discard; nothing is kept until Accept, an answer that cannot be read is said in words, and RoleCall's made-up default item is never filed. Delete marks the item and leaves an Undo. Where RoleCall's panel had no way to do a thing the person plainly needs, a button is added: Equip, Unequip and Use, and a currency box, on Inventory; Add Member on an empty Party; Ready now on a cooling spell. The **Spellbook** casts: Invoke (Cast in Tactical Mode, which rolls the spell's dice) pays the cost out of the Stats tracker, starts the cooldown, adds mastery and history, and leaves a note that rides the next reply, shown at the top with a way to cancel it; a cast rides only the next reply (casting on the newest reply and then regenerating it neither carries nor spends the cast), cooldowns count down on the replies after, each countdown stamped with the reply that made it, so a new version of a reply counts once and a cut reply takes its countdown with it. **Refresh from chat history** (RoleCall's `initialize-trackers`): every legacy tracker's strip starts with a Refresh button (RoleCall's refresh-cw icon and tooltip, with the word added; part `props.tracker.refresh`; `trackers/refresh/`, mounted by `TrackerFrame`), and the Props wing's Legacy Trackers box has "Refresh Enabled Boards" (part `props.trackers.refresh-all`). Both ask `POST /api/chats/tracker-refresh` (`studio/scene-tracker-refresh.ts`, pure half `core/trackers/refresh.ts`), which asks the scene's model once about one whole tracker, from its twenty newest messages and the opening one and from the tracker as it is now, and answers a PROPOSAL (`{ chatId, module, proposed, diff, skipped }`) that writes nothing. While it reads, the button is busy, the panel dims click-through under "Refreshing <title>..." as RoleCall's does, and a line offers Cancel. The answer opens a review sheet (part `props.tracker.review`) with Added, Changed and Removed rows, a line "N item(s) skipped: <name> (<reason>)" for entries the model's answer lost, and Accept, Try again and Discard; Accept writes it through the tracker's own `apply` as your own write on the newest reply, like anything you click or accept (label "Refreshed from chat history", so the frame's Undo restores it; an accepted Generate or a card's Refresh of an item is the same), so it stays through swiping or regenerating that reply, Discard writes nothing, and an answer with no change is a line ("<Label> already matches the chat."), not a sheet. A provider failure or an unreadable answer is a failure line with the reason and Try again, never the tracker's defaults. A proposal read for another scene, or for a tracker that changed while it waited, is dropped at Accept; switching scenes drops a held one. Refresh Enabled Boards reads each enabled board one after another ("Refreshing <label> (i/n)", a progress bar, Cancel, which keeps the boards already read for review) and opens one combined sheet with each board's Accept, Accept all, Discard all and, on an accepted board, Undo; Storyboards and Tarot are not refreshed. Stats and Combat now declare that they reach the model. Not built: the Refresh button is not switched off for a scene with no messages (the server answers that case with a line saying so), and the review has no per-row choice, only whole-board Accept. Not built: reliability and truth changes in Knowledge, Strengthen and Weaken in Bonds, Formation and Tactics edits in Party, the Creature Codex Logging toggle, and the Calendar the Cycles lunar block reads (it shows RoleCall's own words for a moon it cannot find). A tracker that is on, and whose AI Context is not Never or not due this turn, adds its lines to the request as one system message headed `### Current Game State (Immersion Trackers)` after the guides (or where the preset's `trackers` marker stands, with that block's role: [entities/preset.md](entities/preset.md)), with RoleCall's lines word for word (prompt assembly step 10b); the Tokens sheet shows it as its own Trackers line. RoleCall's client never sends this block to the narrator (it sends `dm_only`, the worker injects for `always`), so there the trackers change nothing the model reads with the Story Director off; here they do. Evidence: unit-proven, JSDOM-proven, and live-checked in a sandbox studio (the toggle, the Stats and Combat panels, a turn's request carrying the block); the ten item trackers, Generate and Refresh, and the Spellbook's cast are unit-proven, JSDOM-proven and HTTP-proven against a scripted provider, not yet live-checked; the Tokens sheet's new line is unit-proven only.
- **The Story Director Prop (UI).** *(added 2026-10-12, pending author review; live-checked: no)* RoleCall's Story Director (`StoryDirectorWingPanel.tsx`, `FloatingDMActivity.tsx`, `DMPersonalitySelector.tsx`, `StagecraftExtensions.tsx:1028-1219`) as the Prop `story-director` (`props/story-director/`, parts `scene.director*`, `props.story-director*` and `scene.booth.narrator`); the engine and the saved story are ChatStore rule 47. It is on while the Prop is in the scene's Props, and calls the person's model before each reply (reach "model"). Under its row sit the settings: the personality picker (RoleCall's card and list of ten, each in a theme role; a tile shows the personality's picture from `docs/media/dm-personalities/<name>.png` when that file loads and its initials otherwise; RoleCall has pictures for eight personalities (it keeps them in its storage bucket, so they are not in this repository yet and every tile shows initials until the files are added) and none for the Architect and the Oracle), the Story Director Model (the AI wing's picker, unset means the narrator's; RoleCall's amber line when the model reports no tool support; Reasoning with "Auto follows the model default"), the command mode (Tool call or Tagged with the capability badge), and the runtime box (`director-runtime.tsx`, also the Control Booth's Narrator box): the automatic tracker updates (`auto-update.tsx`; plan 17): one switch, "Update trackers automatically" (on by default; off, no tracker round ever runs and only the switch and its line remain, with the rest of the Director settings (Creativity, DM Temperature, Auto-retry, Custom Instructions for DM) unchanged), and, while it is on, "Every N replies" (1 to 99, default 1: the number for every tracker), "Trackers in this scene" (one row for each updatable tracker switched on in the scene, each with its own switch and number, and "Use default" when its number differs from the default; a tracker's switch off greys its number and keeps it) and "Model calls per reply, up to N" (1 to 5, default 1: the model calls the tracker round may spend on one reply, a repair of an unreadable answer included; planning's own call is separate and not shown), then DM Temperature (0 to 2, saved when the field loses focus), Creativity (Subtle, Moderate, Dramatic), "Auto-retry invalid tool responses" and "Custom Instructions for DM" (2000 characters, saved when the box loses focus). Interactive choices is not drawn: it does nothing for the Director in RoleCall. The model row (`director-model`) and Reset DM (`director-reset`) are protected controls. The gear opens the panel in the Props wing (it can also float): a hero ("Turn n" or "Narrative oversight", "Story Director"), RoleCall's turn stepper (Previous and Next turn, "Latest" or "n / total", "Jump to latest"; it steps through the replies of the take that carry a saved story, the newest 150, and hides when there is one or none; an earlier turn is read only: Reset, Mark as Complete, Clear and every Debug edit are off and a line says so), Reset DM (it asks first, new copy), and RoleCall's five tabs with their glyphs, Story (Current Chapter, Chapter History, Current Mood, Suggested Actions as text, DM Intentions), Arcs (Active, Completed and Abandoned, grouped by chapter, with the arc card's description, type, priority, scope, turns, who is involved, stages, planted seeds and Mark as Complete; NEW: the planned next beat), Analysis (Turn Analysis and Pacing Analysis), Activity (All, Turns, Tools, Planning; the Director's tracker updates are "Tracker" lines, under All and Tools; the feed newest first, one line open at a time; Clear hides) and Debug (the spoiler warning and Show Debug Data, then Shadow World with "Plant invisible arc" (title, description, horizon and surface condition; RoleCall's form also has type, scope, status, expected turn, beats, seeds, clues and related arcs, which the edit contract does not carry yet) and DM Notes, Narrative Seeds, the raw hidden data and the last directive; NEW: the size of the story and what was deleted and is kept). Every edit sends the version the panel showed, so a story a turn has moved is refused instead of overwritten, with a line for each edit (RoleCall's "Couldn't save the resolved arc." for Mark as Complete). A first-use strip carries RoleCall's tour text once. The floating activity button (`scene.director.fab`) is RoleCall's: hidden until a line exists, 40px and square, draggable (a per-viewer pref), a badge counting the last five minutes, a border that pulses for six seconds, and a popover of the last ten lines with "View All Activity ->" (which floats the panel on its Activity tab). Not carried: Unpin (Bunzai's wings have no pin), the Tool Calls, Storyboards AI Context, NPC Off-Screen Actions, Parallel Timelines and Memory Updates sections of Debug (nothing writes them), the Chapter Update block, and Orison and the Interpreter. Evidence: unit-proven and JSDOM-proven; not live-checked.
- **Storyboards (the Compendium's tab).** Quest Board, Cast, Map and Renown are dossiers of the open book's typed entries (`core/compendium/dossiers/`: plots, characters, locations, organizations), drawn for the Storyboard Props that are on; with none on the tab says "No Storyboards are enabled for this chat. Turn on Quest Board, Cast, Map, or Renown in Props to use this panel." A tile per dossier (Live on the open one), a strip saying what is sent ("focused sent" or "off") and the scope, then the dossier: a stat row, tabs, and cards. A card opens its entry in Browse, which is where entries are edited. Quest Board has Pressure Board (Critical Path, Active, Blocked, Failed / Abandoned lanes with urgency, progress, deadline, objectives and links, and the failure pressure as one bar), Journal and AI Context; Cast splits the people in the scene from the rest with meters, memories and relationships; Map and Renown list their entries. **AI Context** is RoleCall's panel: Off, Focused, Compact, Radius (3 to 20 lines) and Full, over the exact digest the narrator gets and its tokens. It is the include switch and profile kept in ChatStore rule 43 (Quest Board and Cast start on, Map and Renown start Off, as RoleCall's defaults). A Storyboard that is on and included adds its digest of every book the scene may read as one system message headed `[COMPENDIUM STORYBOARDS CONTEXT]` after the trackers' block, or where the preset's `storyboards` marker stands (prompt assembly step 10c). A Storyboard's gear in the Props wing opens the World wing's Compendium on the Storyboards tab on that dossier. Not drawn, because they read the Story Director's journal or invent data: the Dependency Tree, History, Corrections and Promote tabs, the Relationship Graph, the Atlas, RoleCall's consequence tree and its failure-pressure "ramp" (a series it makes up), and the strip's Events and Last Write. Calendar is not built. Differences from RoleCall: a dossier with nothing in it sends nothing (RoleCall sends its "[USE]" boilerplate), the digest's "[USE]" lines about naming slugs in tool calls are left out (the narrator has no tools), and the block is its own message so the Tokens sheet can show it (RoleCall joins it into the `{{lore}}` text). Evidence: unit-proven, JSDOM-proven, and live-checked in a sandbox studio with a typed book (the gear, the dossiers, the AI Context pills, a turn's request carrying the block).
- **The Final Cut wing: the Final Cut tab.** RoleCall's Final Cut rail ("Rewrites and text cleanup", `StandardLayout.tsx:191`) hosts two tabs, Final Cut and Regex (`left-wing-groups.ts:40-41`); the wing opens on Final Cut, as RoleCall's does (`scene-final-cut.tsx`, parts `scene.wings` and `scene.wings.panel`). The Final Cut tab (`final-cut/final-cut-tab.tsx`, part `scene.finalcut`) is RoleCall's PostProductionPanel: a hero ("The Final Cut"), a master switch, a stats strip (creative passes, Anti-Slop, Editor rules, output safety, user message check), the per-tool card (Rewrite, Expand, Reduce and Correction, each with an optional model, temperature and reply limit), the Output Safety Check, and one card per pass: Anti-Slop (attached sets and banks, a search over banks and banned entries, per-bank depth, Custom Banks kept in the person's library), Scene Editor (profiles and rule floors), Translator, and Your Department (an instruction and Saved Agents from the library), then the Pipeline Prompt Contract, which is built by the same prompt builders a run uses. The master switch, every pass and every setting are the scene's own (ChatStore rule 44, `chats.final_cut_json`), saved after a short pause; Off keeps the settings. After the narrator writes and before the reply is saved, the passes run in order (turn-loop rule 20): a validator pass can Block, Stop keeps the text the finished passes left, and a pass that fails falls back to the text it was given. The reply keeps its original text and each pass's outcome in its trace, so a scissors button on the reply opens Final Cut Activity (`final-cut/fc-activity.tsx`): the overall result, a Changelog tab (each pass's status, time, model, changelog, warnings, rule review and raw reply), a Before / After word diff with Undo, and Rerun, which previews the new text and writes nothing until Apply. Undo and Apply are edits, so Edit history keeps what they replace. With the safety check set to check the person's messages and to Block, an error-level issue refuses the send. Correct and the Rewrite actions in the draft tools read their tool's model and sampler; Expand as character, Spellcheck and Polish stay on the scene's model. Every model pass offers RoleCall's "Apply your AI-output regex scripts to input" (on unless turned off): the scene's text-rewriting display rules run on the pass's input, in the page's sandbox worker only, and a re-run refuses it. The tools card has RoleCall's Custom row too: Correction Tools' Rewrite tab has a Custom button beside Rewrite, Expand and Reduce, which takes a free-form instruction ("How should this change?") for the highlighted passage. A re-run of the passes shows a preview and Apply writes exactly that text, held by the server, as an edit and adds the re-run to the reply's run (ChatStore rule 46); the Activity lists each applied re-run with its before and after and Undo on the latest. Not built: Orison authoring.
- **The Final Cut wing: the Regex tab.** The Regex tab is RoleCall's RegexPanel: a hero ("Text Transformations", "Regex Scripts"), a New Regex Script button that makes an empty set and opens it in the Workbench, and the library's regex sets as a list in the order you last dragged them (an app preference, as RoleCall's `regex_script_order`; sets never dragged follow in library order). Each row has a drag handle (the arrow keys move it too), its name, its description and a rule-count tile; opening it shows Use (Selected once it is on, Deselect to switch it off), Edit (the Workbench) and Delete (RoleCall's "Are you sure you want to delete this regex script?"; the set goes to the library's trash and leaves the scene). The sets you switch on belong to this scene and run in the order you switched them on (ChatStore rule 42); a drag reorders the selected ones with the list. The fold says "n active", counting only sets the library still has. Display and prompt rules run only in the isolated sandbox worker (ADR-009): a display rule dresses what is drawn for stable messages (a live reply shows as written until it lands), never what is stored, so Edit opens the message as written and Copy copies it as the macros made it; a prompt rule rewrites the conversation messages of the request a turn sends, and the Inspector and the Tokens view show the rewritten request (turn-loop rule 19). A worker that cannot run leaves the messages as written on the screen and ends a turn before anything is sent.
- **Prop rail panels.** A registered Prop with a panel and a `rail` declaration gets its own right-rail wing while enabled. The Story Director uses this path. Its wing and the Props gear share the same `PopoutSlot`; the existing wing frame owns resizing and saved widths. Loading, failed and switched-off Props have distinct messages. The pop-out observes its actual scene layer and limits its own width to that layer. Live checks cover the Director rail, floating/docking and a 454px scene expanding to 1200px; no planning turn with a model was attempted.

- **Dramaturg.** An optional scene Prop for asking about the fiction, off by default. Its own rail, Props gear and floating panel show the same conversation. It reads the active scene's card, persona, enabled preset blocks, fired lore and visible messages; six read-only tools can retrieve scene messages, lore and preset text. It cannot write scene messages or change library pieces. The scene model answers unless a protected model picker selects another. Reasoning and temperature are separate Dramaturg settings. Questions stream an answer and read receipts; Stop retains a marked partial answer, and Clear asks first. One sealed record per scene stores settings and up to 200 conversation entries, guarded by conversation revision. An unreadable record reports damage and preserves the stored cell. Runtime ownership, startup cancellation and shutdown use the reusable core. The input estimate includes framing, definitions and tool transcripts on every round, with an explicit reply cap; evidence that cannot fit is refused before model egress. This uses the shared token estimate, not a native-tokenizer guarantee. The client retains at most four scenes within a 32 MiB budget, clears them on library lock or Scenes-app unmount, and rejects stale responses. Focused tests and a deterministic native-provider fixture verify the read-tool answer, saved conversation after reload, floating/docking and narrow width; no real model or packaged release was tested.
- **Pop-outs.** Any panel can be registered to float over the scene as its own draggable copy (`scenes/popout/`, RoleCall's Activity pop-out, `LorebookActivityFeed.tsx:747-842`, made general). A *kind* is `{ id, title, noun, icon, width?, top?, render({ ctx, chat, id, popOut? }) }` (`popout-kind.ts`). `PopoutHost` is mounted once per scene beside the wing panel, so a floating panel outlives the wing it came from (RoleCall's dies with it, which is why its VVS-683 needed an outside-click exemption); it draws each kind it is given once, so there is one panel per kind per scene however many places show that kind. The panel is 380px wide (a kind may set `width`), at most 70% of the scene tall, with square corners and a hard shadow. Drag it by the header (the grip, the title and the accent dot); it stays wholly inside the scene using its real size (RoleCall clamps to a fixed 200px, so a tall panel hangs off the bottom). The header's Dock back and Close both dock it, as in RoleCall. It first opens at the right edge, 100px down (a kind may set `top` so two kinds do not stack), and open state and place are remembered per kind in `ctx.prefs` under `popout.<id>` (written when you open, dock or drop it, never during a drag; an unreadable value reads as closed). A restored open panel does not take focus; one you open does, Escape inside it docks it (unless you are typing in a field), and focus returns to the docked spot. `PopoutSlot` is the docked spot: it draws the kind's content with its Pop out button (`PopoutButton`, which the content draws when `popOut` is given), and while the panel floats it shows the placeholder "<noun> is floating" with Bring back. A kind's `render` is the same content docked and floating and fetches its own data; its context carries `onChat`, so a write it makes reaches the scene. **For prop authors:** a Prop lists its kinds in `SceneProp.popouts` and its own panel in `SceneProp.panel` (`props/prop-contract.ts`; the Props wing opens a `panel` from its gear); they are offered only while the prop is on, and the host finds them through `popoutKindsFor`. A wing registers its kind in `popout/kinds.ts`. First-party only: a kind is a React component bundled with the app, and nothing here loads outside code. Registered kinds include: the Compendium Activity feed (the wing's, see the Activity tab), the panels of Stats (`tracker.resources`) and Combat (`tracker.battle`), and TrackHare's lore trace (`trackhare.trace`, declared in `trackHareProp.popouts`): the TrackHare popover has a Pop out button, the popover then reads "Lore trace is floating" with Bring back, and the floating panel shows the latest reply's fired entries, the entries the Compendium recalled and the Didn't-fire section (the same body as the popover, `hare-hits.tsx`) using the viewer's TrackHare options, with the popover shut; it opens 160px down so it does not sit on the Activity panel. Do not write a second floating panel: the `popoutOutsideHome` guard (`scripts/hooks/single-source-ui.ts`) rejects a drag-and-clamp panel in an app outside `popout/`. Evidence: unit/JSDOM regressions cover shared pop-out ownership; the Director panel has the bounded live checks above.
- **Guides.** The Prompting wing's Guides tab is RoleCall's guided responses on your library. The header says how many are
  on ("Guides · 2 active"); New Guide and a search by title sit above the list, which is grouped by category (Situational,
  Thinking, Clothes, State, Rules, Custom; a group with nothing in it is not shown) with a count on each. A row has a
  switch, the guide's name and a pill for how it is placed (Std, Depth, Append, Macro, Start). The switch is for THIS
  scene only: it is kept on the scene in the order switched on, and a guide on in one scene is not on in another.
  Picking a row opens its editor under the list: the name (Duplicate and Delete beside it; Delete asks first and keeps the
  record in the library), the switch, the role (System, User, Assistant) and category, the content with {{user}} and {{char}}
  chips and a token estimate, the placement (Std, Depth, Append, Macro, Start), and an Advanced fold with the guide's Type
  (Guide, Correction, Spellcheck, Prefill, Custom; only a Correction guide is offered by Correct's Corrections tab, and
  the type changes nothing about how a guide is injected) and "Visible in
  Library" (off hides the guide from the list and leaves it out of every prompt; RoleCall hides it from the list but keeps
  sending it in the chats that had it on, with no switch left to turn it off, so this is not copied). Depth and Append take a number of
  messages back; Macro takes which value it welds onto (Persona, Description, Personality, Scenario, Summary) and which
  side. A new guide starts as a user-role, situational, standard guide. The guides are one sealed document in your library
  (the Library's folder export carries it as `guides.json`). How each placement reaches the request is in
  `src/core/assembly/`, "Guides". Two of RoleCall's quirks are not copied: its user-role standard guide is
  written into the message you send, so it stays in the transcript and keeps riding later turns; here it is added to
  the request only, on the turn it applies to. And its Auto-Trigger switch is not offered, because nothing in
  RoleCall reads it.
- **Scene Note.** The Prompting wing's Scene Note tab is RoleCall's author's note panel: one persistent line of
  guidance, up to 10,000 characters (macros such as {{char}}, {{user}} and {{time}} work), that rides along with the
  prompt on this scene. Position is After Scenario (after the card and preset's leading system messages) or In Chat
  History at an injection depth from 0 to 10 (default 4); Frequency is Every turn, Every 2nd, 3rd or 4th (the first
  turn counts: every 2nd is turns 1, 3, 5) or Never. It is sent as a system message reading "[Author's Note: ...]".
  The depth line says what the request does: depth 0 is right before your latest message, and depth 4 is before the last
  5 messages (RoleCall's panel says 4). It saves one second after the last change and when you leave the tab; a failed
  save says so and keeps the change pending. Tips and examples are under a fold.
- **Writing Tools.** The Prompting wing's fourth tab is RoleCall's Writing Tools panel ("Your turn helpers"): the tools that
  rewrite a reply or draft yours, in groups that open and close (Change the reply, Write in character and Your draft), each with its
  name, a chip for its keyboard shortcut when it has one, a line on what it does, and the prompt it uses. It lists only tools that
  are built: Regenerate, Guided re-roll, Continue, Correct, Expand as character and Polish Input. Continue
  shows its Continue Nudge Prompt as an editor, "Used when the model cannot take a started reply" (RoleCall shows the field and never
  sends it); it is the same field as in the Preset tab's Templates, saved through the same writer, so the two never disagree. Without
  a preset it says "Choose a preset to edit this prompt." Every tool also has a collapsed "What this sends" with the words of its
  request that no preset field edits. The tool list is one table (`writing-tools-core.ts`); the composer "+" menu and the message menu read it too, so a name, a sublabel or a shortcut is written once.
- **Composer.** The capsule's `+` button ("Open tools menu") opens RoleCall's tools list under "Change the reply": Regenerate ("re-roll last AI message"), Guided re-roll, Continue ("extend last reply") and Correct ("fix last AI message in place"), then "Write in character": Expand as character ("turn your outline into a full in-character message", with an inline 1ST / 2ND / 3RD pill) and "Input": Polish Input ("spellcheck what you typed"), the built rows of the writing-tool table, then a "Debug" section with **Prompt Inspector: Off** / **On** (RoleCall's Debug row; it flips the per-user pref `scenes.promptInspector`, stays open to show the new state, and is never disabled). With it on, every turn (new reply, Regenerate, Guided re-roll, Continue) pauses before anything is written or sent and opens a "Prompt Inspector" dialog with the exact request, one editable box per message, and an "about N tokens" chip; **Send** (or **Edit and send** once a message changed) goes on as the same turn, **Review later** (also Esc, the X, or a click outside) dismisses the dialog while the turn stays paused behind an amber "Turn paused for Prompt Inspector" pill that reopens it with your edits, and **Stop turn** (or the scene's own Stop) ends the turn with nothing kept (turn-loop rule 16). When the reply may call tools (the scene's Narrator Tool Access is on and the connection takes them, turn-loop rule 18), the tool definitions the request will carry follow the messages, one read-only box each, labelled "tool: <name>"; Regenerate and Continue call the same handlers as the last reply's buttons. A row that cannot run now is disabled with its reason as its title ("A reply is being written.", "Pick a connection first.", "There is no reply to continue."); Regenerate or Guided re-roll with no reply past the greeting answers "No AI message yet to re-roll." in the status line. Ctrl+Shift+R regenerates and Ctrl+Shift+C continues, and unlike RoleCall's they also fire inside the composer (there the browser would reload the page) and are never typed text; they stand down in other fields, while a menu, wing, dialog or editor is open, or a reply runs. The unsent draft is kept per scene in the app prefs (`scenes.draft.<scene id>`), saved a second after typing stops and when the scene closes, and emptied when the message goes. **Guided re-roll** (the `+` row, or More > Writing tools > Guided re-roll on the take's last reply) puts the composer in steering mode: a ribbon reads "Steering <name>'s last reply" with "Your next send becomes the regen instruction. Empty = re-roll without instruction." and a Cancel button, Esc also cancels, the box asks "Tell the AI how to retake the message, or hit send with no text to re-roll without instruction…", and Send becomes a re-roll. The box has its own text, so the unsent draft is untouched. The send asks for a new version of the last reply with the instruction (turn-loop rule 15); the version remembers it, and its More menu then says "Edit guided re-roll" and offers the old instruction back. An older reply answers RoleCall's branch-required line ("That reply has later messages beneath it. Create a branch...") in the status bar instead.
- **Draft tools.** Expand as character, Polish Input and Correct ask the scene's own model for text and put it where you can
  review it; none of them sends anything, adds a message or a version, or changes a variable. **Expand as character** (the
  `+` row, whose pill segment picks the perspective at once and whose row body picks 1st; or More > Writing tools > Expand
  as character on a reply, which opens expand mode: the same pill over the composer, using no message's text) writes your next
  message from the take so far: the composer's text is the outline (it may be empty), and the answer lands in the composer for
  you to edit and send; Cancel clears it. A strip above the composer says "Writing as <persona>" while it runs. The
  request is the scene's own prompt (preset, guides, scene note, lorebooks) ending in the preset's Impersonation Prompt, or
  RoleCall's default when that is blank, then one fixed line for the perspective ("Write in first person (I, we).", "Write in
  second person (you).", "Write in third person, by name."), then your outline as a hint. It uses the preset's samplers and
  window; only the reply length is capped at 2,000 tokens, and the prefill is the preset's Assistant Impersonation, never its
  character-voice Assistant Prefill. **Polish Input** (`+` > Input) is RoleCall's spellcheck prompt on your draft, told it is
  the player's own draft written as your persona (RoleCall calls it the character's); it makes minimal changes, replaces the
  composer text, and shows Polished with Show diff, Revert and a close, or "Nothing to fix." when it changed nothing; with
  nothing typed it says "Type something first to polish." **Correct** (`+` > Change the reply, on the last reply; or More >
  Writing tools > Correct on any message, opening on the passage you had highlighted in it) opens Correction Tools:
  Spellcheck (RoleCall's prompt, in the character's voice), Corrections (your Correction-typed guides; "No correction guides
  available" when there are none) and Rewrite (highlight a passage, then Delete, which never calls the model, or Rewrite,
  Expand, Reduce on only that passage). Each shows the result beside the original, and Apply edits the version being shown in
  place (no new version), through the same edit route as the pencil, so Edit history and Undo last edit catch it. The editors
  use RoleCall's fixed prompts and temperatures (0.2 to 0.4) rather than the preset's samplers, because a creative sampler
  would make a proofread wander. All of them use the scene's model, and a failure says why and changes nothing. The
  request is `POST /api/chats/draft`.
- **The Messenger layout** *(added 2026-10-24, RoleCall's Discord-style chat appearance, `messenger/`; approved wireframe `design/wireframes/rc-port/messenger.html`; pending author review)*: the scene page reads the saved chat layout from the app preference `scenes.chatLayout` (`chat-layout.ts`). `messenger` draws the Messenger; any other value, or none, draws Full Chat as above. The Messenger puts the same transcript, composer and takes pill inside RoleCall's shell (`DiscordChrome.tsx`, `discord.css`): a rail with the Chat button and one button per program, a sidebar (Browse Characters, RECENT CHARACTERS, the active-feature pills, your persona and a gear), a header (a menu button on narrow panes, Back to Scenes, the character, the takes pill and the Update available badge) and, when the character has art, a portrait that opens the Stage Gallery's viewer. Messages are an avatar and a name over plain text with no bubble, and the time sits inline after the name (`scene-bubble.tsx` renders a `.spk-time` sibling after `.spk`, hidden in the other layouts; `messenger-chat-style.ts` shows it inline and hides the under-avatar `.pstamp`, as RoleCall's `.message-header` and `.message-timestamp` do). It has its own fixed palette (the `--msg-*` tokens) and no wings, rails or backdrop.
  - **Programs.** One per wing tab, in RoleCall's order and with its titles (`messenger/programs.ts`): Control Booth, Characters, My Persona, Participants, Lorebooks, Compendium, Generation (the preset), Guides, Regex Workshop (the Final Cut wing's Regex tab), Scene Note, Writing Helpers, Add / Remove Features, Final Cut, AI Connection, Samplers (the AI wing's Generation tab), Control Panel, My Pictures, Music and Spotify while their Props are on, Wardrobe, Context Inspector and Memory. A Prop with a panel (Story Director, the trackers) gets a program while it is on and appears as an active-feature pill; Regex (N) is a pill while the scene has regex sets on. A program draws the wing's own panel on the tab it names (`WingPanel` with `tab` and `bare`; the wing's tab strip is hidden), never a copy.
  - **Library trackers in the Trackers panel.** *(added 2026-10-28, pending author review; live-checked: no)* The Trackers program (`messenger/panels/trackers/`) also shows while the scene links a library tracker (`ChatPrompting.trackers`), not only while a built-in tracker is on, and counts both; the linked trackers lead the list as cards (`library-draw.tsx`) and the built-in ones follow. A card has the tracker's name, a Library tag, the reply that last changed it ("reply N", N as the Messenger counts messages) and its fields drawn by type (`library-core.ts`): a number with a top (its own `max`, or another field named by `maxField`) is a bar with "7/20", an open number is the number, a choice is pips with the current one lit, yes or no is one pip, text is the quoted text, and a list is item tiles with a count (the row's first number field). A number that is another field's top is left to the bar that shows it. A field's or tracker's icon draws only when the build ships it (`knownIcon` in `_shared/ic.tsx`); an id it does not ship draws no icon and no error. Fields and tiles sit in windowed lists. Clicking a card opens it, with a back arrow: "Reply N changed ..." (read from `GET /api/chats/tracker-changes` for that reply), every field editable (drag a bar or type a number, pick a pip, switch yes or no, type text; for a list, pick an item to edit its fields, add one by name, remove one), "Edit tracker" (the piece in the Workbench) and the hint that a change stays with the reply. The values come from one read for all linked trackers, `GET /api/chats/library-trackers?chatId=` (`studio/scene-trackers.ts`): each tracker's body, its value at the take's tip as the prompt reads it, and the reply that last changed it, from one pass over the take's tracker deltas; nothing is read while no tracker is linked, and the panel reads again when the scene page publishes a newer take version (`scene-signals.ts`: a reply landing, a swipe, a regenerate and an edit of a message each move the branch version; the chat's `updatedAt` moves for neither a swipe nor a regenerate, so it is not the signal; TrackHare's trace follows the same version). Reads and edits are ordered: a read that started before a newer read, or before the latest edit began or landed, is dropped, so a slow read never puts back what an edit changed, and a read dropped because of an edit is followed by one fresh read once the edits settle, so what is shown is always a read that started after the last write. The summary counts only the trackers that drew. A person's edit is `POST /api/chats/tracker-edit` with `{ chatId, branchId, messageId, trackerId, update, expectedVersion }` (`studio/tracker-edit.ts`): the update is the `update_trackers` tool's own shape (`row`, `remove`, `set`), turned into deltas by the same core code (`applyTrackerUpdates`: the same clamps and the same top rule, a number out of range is held inside it and never refused) and written as message-level deltas on the tip message (`recordMessageDeltas`), so it wins on that message and survives swiping and regenerating it ([scene-state.md](scene-state.md)). It answers the trackers as they now stand, or refuses whole with a sentence: the scene does not link that tracker (400), the take or scene is gone (404), or the take has moved on since the panel read it, which includes the message no longer being the tip (409, "The scene moved on since this was read, so nothing was changed. Try again."; the version the panel read and the values it read (`expect`, built from the state it read at each slot and path, never stored) are the write's own guard, `recordMessageDeltas(..., { expectedVersion, expect })`, checked inside the store's write; a person edit does not bump the version, so a second window's edit of the same field is refused by `expect` while an edit of another field lands; the panel reads again and shows the current values). A bar follows the hand while it is dragged (the pointer is captured, so a release outside the bar still counts) and writes once when the drag ends, whether it is released, cancelled by a touch scroll or loses focus, with the shown value (a key step or a typed value writes when it is made); a bar is dragged only over whole numbers, and any other number is typed, which takes any value. While a reply is being written here the edit controls are disabled under the line "A reply is being written. Edits wait until it lands.", and the server refuses the edit too (409, "A reply is being written, so nothing was changed. Try again when it lands."; the same registry of running turns that Stop uses; a turn is registered from the moment it is called, before its state is read for the prompt, under its own key so Stop is unchanged, and released however the turn ends), because the turn's own whole-row update would overwrite it. The route resolves the tracker from the scene's whole linked list the way a turn does, so it refuses exactly the trackers the turn leaves out (gone, unreadable, or another linked tracker with the same name). "Add or remove trackers" lists the library's trackers with their shape as text ("record, 3 fields"), a check for each that writes `ChatPrompting.trackers` through `setScenePrompting` (the last uncheck clears the list), a linked id the library no longer holds (listed so it can be unchecked), and "New tracker", which saves a blank tracker and opens it in the Workbench. The pane also shows "Per reply ~N tokens", the sum of the linked trackers' estimate from the tracker editor's own Prompt rail (`trackerPreview`), and a Built in group: the built-in tracker Props with an "On" mark, each row and "All N built-in trackers" opening the existing Props door (the page's Manage features), with no switch of their own. The Trackers program is reachable while the scene links a library tracker, a built-in is on, or the library holds any tracker (read from the piece store the app keeps current from the studio's change events, `use-library-has-trackers.ts`, so a tracker made in the Workbench shows without a reload), so the first one can be added and unchecking the last does not strand the person. Not built: the wireframe's cost bar (only the figure), "added by reply N" on an open list row (the read gives the reply that last changed the whole tracker, not each row's; it would need a scan per row), and the reply numbers counting only assistant replies (they count live messages). Evidence: unit-proven and JSDOM-proven; not live-checked.
  - **Tools on the Control Booth.** *(added 2026-10-28, pending author review; live-checked: no)* Under Narrator Tool Access and Max tool rounds, in both layouts (`booth-tools.tsx`, part `scene.booth.tools`, drawn by `ToolAccessRows`), the scene's linked tools (`ChatPrompting.tools`) are tiles in a windowed grid: an icon for what the tool does (dice for "roll the dice it gives", a table for a dice piece, a variable for a formula, a note for "just note it"), the name, the action in plain words, what its definition costs on every reply (`workbench/pieces/tool-cost.ts`, the same count the tool editor's rail shows as "Adds to every reply") and a switch that links or unlinks it through `setScenePrompting`. A tool unlinked here stays as a dimmed tile until the Booth is closed so it can be switched back on; a linked tool the library no longer holds says "Not in your library" and can still be unlinked. A "Per reply" line sums the linked tools, with a bar showing the share of the scene model's context window they take when that window is known (no limit is drawn, and without a window there is only the sum); while Narrator Tool Access is off no tool is sent, so the line says "not sent" with no figure or bar and the tiles stay. A tool's cost is read again when the piece store says the tool changed (an edit in the Workbench), a read is not thrown away when the list changes while it is out, and a tool that cannot be read because of a network or server error shows that plain sentence (only a 404 says "Not in your library"). "Link a tool" lists the library's tools with a check each; "New tool in the Workbench" saves a blank tool and opens it there. Nothing is read while no tool is linked. There is no count and no cap. Tile rules are in `booth-tools-core.ts`. Evidence: unit-proven and JSDOM-proven; not yet checked in the running studio.
  - **Change visuals under a reply.** *(added 2026-10-28, pending author review; live-checked: no)* In the Messenger only, each finished assistant reply shows what it changed in the library trackers the scene links, each tracker in its own style (`transcript/use-reply-notes.tsx`, `reply-changes.tsx`, rules in `reply-changes-core.ts`; the tracker editor's "Show changes on replies as" picks it, see the tracker page). Chips are one badge per changed line: a number with a top shows a small bar, "7/20" and its delta signed and colored up or down, a choice or text shows its new value, a yes or no shows the field (or "not" the field), a list row shows its name with the change in its first number field (a plus or minus sign for an added or removed row); a click opens that tracker in the Trackers panel (`messenger/program-open.ts` asks the Messenger for the Trackers program, `panels/trackers/open-tracker.ts` leaves the tracker for the panel, which takes the request once). A card is a small card per tracker, one row per changed line with the new value and the old one under it ("was 10"). A toast tracker draws only a marker, "3 changes", that opens the shared notice again; the notice itself shows once for a reply that has just landed live, driven by what the turn itself committed: the turn's own done or stopped event names the message and version (swipe) it saved (`CommittedTurn` in `use-scene-turn.ts`; null for a turn that saved nothing), and the first read at a version newer than the one the turn ran on settles it, whatever the outcome. It fires only when that read shows that exact message and version as the tip and the tip has toast-style changes; a regenerate counts (a new swipe), and so does a Stop that kept a partial reply. A continue keeps the same message and version, so it fires only when the tip's toast-style changes differ from what was drawn when the turn began (compared structurally, so key order never matters). A turn that ends while no changes are read (Full Chat, the scene switch off, no tracker linked) is settled the same way, so switching to the Messenger or turning the setting on later never toasts a reply that landed earlier. A cut, a swipe, an edit, a turn that saved nothing, a committed message that is no longer the tip, or a read that fails never fires it, and it never fires on load or scroll (`use-reply-notes.tsx`), says "Reply N changed hp 10 → 7 and mood calm → hurt." with an Open button for the first changed tracker, and dismisses itself; it has no animation, so reduce motion needs nothing. Hidden draws nothing. The changes come from ONE `GET /api/chats/tracker-changes` for the range of messages the page holds (never one per message), read again whenever the scene page publishes a new take version (`scene-signals.ts`; a swipe or regenerate moves it where the chat's `updatedAt` does not); the blocks already drawn stay until the new read lands, and nothing is read while a reply is streaming or while the scene links no library tracker. A chip's delta is shown at the precision of the two stored values (a whole number never grows decimals). Swiping a saved reply to another version selects it (`selectSwipe`), which moves the take's version, so that version's changes are read and shown (proven against a real store). The one exception is browsing versions of a reply while a turn is still answering: that version is only previewed, not selected, so no changes exist for it yet and none are drawn until the turn lands. The scene's switch, Settings > the scene's Features > "What each reply changed" ("Show what each reply changed", "Tracker changes appear under the reply that made them."), is `ChatPrompting.trackerChanges` (absent is on, only off is stored) and turns all of it off; the style is not a scene choice, each tracker keeps its own. The read gained `bars` (for each changed number with a top, its bottom and the top it had when the message left it) so a chip's bar is true for old replies too. Evidence: unit-proven and JSDOM-proven; not yet checked in the running studio.
  - **The out-of-time line.** *(added 2026-10-28, pending author review; live-checked: no)* When a macro ran out of the prompt budget while a reply's prompt was built, the reply says so in one line under it: "1 macro ran out of time building this prompt ({{tally}}). Prompt Inspector" (`reply-changes.tsx`), where Prompt Inspector opens the Context wing, whose Macros tab already lists the error. The data is `Generation.outOfTime`, a list of `{ macro }` that the turn writes with the reply (`outOfTimeOf` in `core/assembly/macro-report.ts`, from the macro report's errors that carry the budget message; one entry per macro name, absent when none ran out), so the Messenger never loads a trace to draw it; the field is bounded only by the hostile-input ceilings (`SANITY_LIST` entries of `SANITY_TEXT` characters, refused as unusually large), and the stored name is the macro's name, never its source. The macro report names the macro but not the block of the prompt it sat in (card, preset, lore), so the line names the macro alone, and a run stopped before a macro was named says only how many. It shows for a finished reply of the version shown and does not depend on the change switch. Replies written before this field existed show no line. Evidence: unit-proven and store-contract-proven; not yet checked in the running studio.
  - **Time budgets.** *(added 2026-10-28, pending author review; live-checked: no)* Settings > You > Studio > "Time budgets" (`settings/user/budget-rows.tsx`) has two boxes in seconds: "Tools, per reply" (`scenes.toolBudgetMs`, how long all of a reply's tool calls may take; when it runs out slow tools are told to stop and the reply goes on, tracker updates always land) and "Building the prompt" (`scenes.promptBudgetMs`, how long macros may take while a request is built; one that runs out is left out and named under the reply). A box shows the saved value, or the default (5 and 3 seconds) when nothing usable is saved, and saves when it is left or Enter is pressed: any positive number is accepted in milliseconds (no ceiling), and an empty box, words, zero or a negative number saves nothing and the box goes back to what is saved (`budget-core.ts`). The studio reads the keys as before (`ui/server-scene-readers.ts`).
  - **Tab and dialog.** A rail button opens its program in place of the chat. The gear opens a dialog with the section list on the first program that is not My Persona, and the profile opens My Profile; Escape, the close button or a press outside returns to the open tab or the chat. Programs already opened stay mounted, hidden and inert, so their drafts survive, and so does the chat; behind the dialog or the drawer the floating pop-out panels are inert. Panels that ask for a wing (the composer's Open AI wing, the Booth's rows, a mini player's chevron) open that wing's first program.
  - **Recents.** Each character's newest scene, newest first, at most 40, from the Scenes list; a row opens that scene. While the list loads or fails the current scene stays reachable; a failure offers Try again.
  - **Narrow panes.** Under 640px (the pane's width, a container query, not the window's) the rail and sidebar are a drawer behind the menu button: Tab stays inside it, Escape closes it and focus returns to the menu button. Under 1024px the portrait moves into a 128 by 144 corner of the header.
- **Not yet.** The composer's Prompt Inspector row, and RoleCall's branching-tree page.
  In the temporary browser Studio every scene route answers that it needs the installed app.

### Stage Gallery

The Stage wing's Gallery tab (`stage-gallery.tsx`, parts `scene.stage.gallery` and `scene.stage.gallery.grid`) ports RoleCall's Image Gallery
(`ImageGalleryPanel.tsx`): a two-column grid of square tiles, a hover strip, an enlarged view with Download and Close, and an empty state. RoleCall
lists the pictures in a chat's messages; Bunzai messages carry none, so the Gallery lists the scene's art instead: the scene's own portrait of the
card (from the snapshot the scene froze), the card's extra art and pinned background and the persona's portrait (read from the library as they are
now; one that was deleted is simply not listed), and the pictures of one pack, the scene's backdrop pack or else the first, with a pack choice when
the library holds more than one. Only art the library holds is listed, never a link. All, Cast and Pack tabs filter the grid, and the count
counts pictures ("6 images in this scene"; RoleCall's tab chip counts messages). Tiles ask for a 256 thumbnail and never the full picture, and the
grid is windowed by the shared virtualizer, so a pack of thousands mounts only the rows in view; this replaces RoleCall's 60-per-page "Load more".
Use as background, in the enlarged view, hangs the picture behind the messages through `setSceneBackdrop`: a pack picture is the backdrop as it
stands, and cast art is first copied into the scene's backdrop pack (else the library's first) through the backdrop picker's own add path, adopted
by hash when the library already holds it and uploaded otherwise, and reused if that pack already holds the same picture. A copy that fails sets no
backdrop and says why; with no pack in the library it asks for one. The scene's overlay darkness carries over, a video speed does not. RoleCall's
generated "Received" images and its Sent filter are left out. The tab strip shows no count chip for Gallery: the strip's `meta` is synchronous and the count needs the library, so the panel states the count itself, and `useStageGallery` returns the `items` a strip chip could count.

### Stage Wardrobe

`stage-wardrobe.tsx`, part `scene.stage.wardrobe`: RoleCall's WardrobeWingPanel. It hangs every message theme the scene's regex sets carry on a rack
(`core/regex/wardrobe.ts`): a theme is a display rule whose replacement opens with a `<style>` block. An **outfit** is a theme anchored on a
`[KEY: NAME]` tag; it is paired with the option of the preset's select_one or select_many choice group whose id or label carries NAME, and its chip
("In rotation" / "Resting") writes that choice answer for this scene, so the preset's own engine decides who takes the stage on the next reply.
Outfits nothing claims are listed as Loose garments ("No caster found") with no control. A **standalone dress** is a theme alone in its set; its chip
("Worn" / "Hang it") switches the set on or off for the scene (ChatStore rule 42). Any other theme is a companion prop: counted, never controlled.
The look itself is drawn by the scene's display regex in the sandbox worker through the message's own scoped style path, so a worn dress dresses
messages like any set and the words are never touched. States: "The wardrobe is bare" (with a pointer to the Final Cut wing), and "This chat's preset
could not be read" when the preset is gone. RoleCall lists only the scripts the chat has selected, so a dress it just hung vanishes on the next load and
cannot be worn again; Bunzai keeps the scene's rack (`Chat.regex.rack`, ChatStore rule 42): hanging a dress moves its set from the sets that are on to the rack in one
write, wearing it moves it back, and a set on the rack dresses nothing but is still there after a reload. RoleCall's footer line "Nothing here is read, stored, or sent to the model"
is not kept, because a roster change is a real choice answer that is sent.

### Scene theme variants

A theme picks one variant for each of six scene surfaces, and the host draws it; a theme never supplies CSS or markup.
`scene.layout` (stage-column, vn-stage, chat-thread, manuscript), `scene.message` (prose, vn-box, bubble, screenplay),
`scene.composer` (prompt-line, command-box, chat-input, typewriter-line), `scene.swipes` (arrows-count, key-chips,
dots, margin-numbers), `scene.wings` (side-curtain, pause-menu, drawer, marginalia) and `scene.hud` (quiet-line,
full-hud, chips, footnotes). Each variant is one stylesheet at `src/ui/apps/scenes/variants/<surface>/<variant>.ts`
keyed on the root `data-surface-*` attribute, so a variant no theme picks matches nothing. The message, composer, stream
and swipe logic stay in one place; the markup differs in only three spots: the version dots (a pip per version that
jumps to it), a visible label on every wing button, and the HUD readout line (take, message count, model), which
`quiet-line` and an unbuilt pick leave out. Every action, every wing and every control is present under every variant.
Below a 1024px scene container the wing rails become one row of wing buttons under the header (`narrow-rail.ts`, one
rule spliced into the core style and the column-rail variants), so every wing stays reachable on a narrow screen.

## The Workbench room (home by default - the IDE)
Pieces are sent from the Library and open as tabs. The Workbench mounts a writable editor for every
canonical kind that has one: character, lorebook, persona, preset, Script Sheet, regex set, sprite pack, quick-reply set,
HTML document, tracker, tool, dice and formula (prompt formats open read-only). The shell owns tabs,
split view, recents, and focus; each editor owns its unsaved local draft and explicit save flow.
The character editor uses Studio Strip: the character name, version and truthful save state sit above
compact controls. Writing for opens the existing multi-platform lens picker and off-target treatment;
Grid/Steps stays visible; View options holds Bento/Playbill, behavior Workshop and editor scale. Desk/Nodes,
focus, Save and Export keep their existing actions. A compact completion count opens the full checklist.
The same controls wrap to the editor's container on narrow panes. Theme-owned arrangements remain locked,
and the Workbench tour points at Writing for and View options.
Inline prose fields grow and shrink with their text; the fullscreen editor retains its existing layout.
With no open pieces, the room distinguishes a restoring bench, a settled empty bench, and a failed
restore, each a centered `RoomHeader` inside a Panel (kicker "The Workbench · Edit pieces"). A settled empty bench offers Open Library, New pack folder, and New lorebook. When the studio
list cannot be loaded after its retries, the room shows the failure reason and keeps the restore gate
closed; the shell status asks for a reload, and the empty in-memory list is not treated as a restored
workspace.
Editor loads include a revision of the complete canonical entity. A save replaces that exact revision
atomically; a newer disk write leaves the draft dirty and reports the conflict instead of overwriting it.
The studio API also exposes an explicit light editor read (`light=1`): its wire type is untrusted,
omits escrow, keeps canonical media as blob sentinels plus stable asset references, and materializes only
legacy blobbed authored text needed by the editor. Scene body reads normalize authored sentinel escapes
back to canonical text. A separate read fetches one escrow entry by format id when a lens needs it. The
patch endpoint accepts a `PiecePatch` and expected revision; stale patches return HTTP 409. Its narrow
native operations own lorebook Marinara folder-parent edges and character Risu named assets; generic
native-format edits may still update unrelated raw fields. The Studio stamp remains store-owned.
Editors adopt these paths individually, so the complete-entity load and save remain the active
behavior until a caller switches.
Authenticated local NamedAsset uploads stream into encrypted temporary staging and are accepted by a
patch only with the server-minted ref from the same API session. Supported uploads are PNG, JPEG, GIF,
WebP, SVG, AVIF, BMP, MP3, WAV, OGG, M4A, AAC, FLAC, MP4, WebM, MOV, MKV, TTF, OTF, WOFF, WOFF2, and
CSS. A picture is capped at 10 MiB (the one interim image limit, `core/media/image-limit.ts`), other files at 32 MiB each (SVG 4 MiB, CSS 2 MiB), eight staged refs and 128 MiB total, with
ten minutes of staging. SVG accepts a strict inert element/attribute subset; namespaces, active
elements, CSS, and external references are refused. CSS is kept as data. Expired grants
are pruned on a timer and before admission; locking or closing the encrypted library aborts in-flight uploads and
revokes staged refs. Failed temporary-directory removals remain in a bounded retry queue, count
against the 128 MiB staging budget, and block new uploads when all 16 directory slots are occupied.
Remote and LAN uploads are refused. `POST /api/asset/adopt` {assets} mints grants over pictures the library already
holds (copying a Sprite pack onto a character, or a character's faces into a pack): no bytes cross the wire, up to 512 grants
and 512 MiB, session-bound, ten minutes, revoked by a lock, and a patch that spends one re-reads the picture and checks
its hash. They are counted apart from uploads, so a 40-picture pack copies whole; inline small pictures travel as
themselves. A whole-piece read (`GET /api/studio/get`) of a piece over the cold-read budget answers 413 in plain words.
`GET /api/studio/risu-assets?kind=character&id=...` returns a
pinned list of native Risu asset names, extensions, MIME hints, and opaque refs without opening their
payloads. The store refuses raw Risu parts above 2 MiB, more than 1,000 rows, or projected metadata
above 256 KiB instead of truncating the list. Workbench named-asset editors use this projection.
Authenticated native and Pocket asset routes support bounded GET and metadata-only HEAD; live
portrait URLs pin revision and write identity, while stored chat portraits pin their snapshot version.
Remote and LAN library reads remain read-only. Asset caches coalesce bounded in-flight deliveries
and clear plaintext on library lock. These paths are source-reviewed; live proof remains pending.
SpritePack gives each active pack group a keyed editor lifetime; late picker, sheet, and attach updates
are applied only while their initiating group remains active. Its Default, Replace, and Remove actions
wrap within narrow sprite cells.
Large editor collections use the shared measured-row helper: both lorebook TOCs and cards, regex
rules, quick replies, preset block lists and previews, sprite choices, and named assets. Their
existing selection and mutation callbacks remain authoritative; the shared owner keeps row identity
through immutable edits and reorders. Grid editors restore the focused control and text selection
after responsive reflow, and Tab traversal continues through each measured window.
- Open pieces are shell-owned (`AppContext.workbench`: pieces/active/send/sendMany/remove/isOpen/
  focus/onChange) so tabs persist across app switches; the "on the workbench" marks in every Library
  view read the same state. `send` (single) and `sendMany` (batch) share one follow path so the
  dialog always reports the true count opened.
- Sending honors the FOLLOW setting (`workbench.follow`): "ask" pops the dialog ("N items were
  sent to the Workbench. Follow?" Yes/No + "Never ask me this again"), "always" jumps there,
  "never" stays with a status note. Changeable in Settings.
- `workbench.open` opens a piece AND lands on its editor with no follow prompt - the path every
  create button uses ("New persona" etc.): the click itself already says where the user is going,
  the same reasoning that lets "Open beside" skip the prompt. `send` stays the ask-me path for
  Library send flows.
- The manifest flag `editsPieces` marks the room tabs focus into. The home app on boot is the
  user's `homeApp` setting.
- **The recents rail** (a low deck along the bottom - "wanna bring this one up?") offers recently
  imported/opened pieces as one-click sends. Recency is the honest later-of two signals: a piece's
  `importedAt` stamp (set when the piece first arrives, kept across saves) and its last-opened time (a per-piece epoch-ms map
  persisted in settings `workbench.recents`, bumped by `workbench.send`/`focus`, capped at 60).
  Currently-open pieces are excluded. Ranking is pure and unit-tested (`workbench/recents-core.ts`);
  the rail reads `workbench.recents()` off the shell store. The rail collapses from its label
  (hide/show, persisted as `workbench.recentsOpen`) so the editor pane can take the room.
- **Character editor.** It opens in Grid (the bento) unless the person has picked the guided quiz,
  which is remembered (`editor.mode`, also in Settings). The character editor provides:
  a fixed Identity card (name/tagline/full name/title/age/pronouns) plus reorderable prose cards
  (description, personality, scenario, first message, example messages) whose order persists to
  `presentation.fieldOrder` using RC's ids verbatim (cross-app order interop; unrendered ids keep
  their saved positions). Explicit save only: Save button + Ctrl+S, dirty flag, beforeunload guard;
  saving round-trips the WHOLE body so untouched fields (escrow, behavior, media) survive
  structurally unchanged, pinned by editor-core tests. Fields the editor does not write yet stay visible
  in a read-only tail. One `CharacterEditor` stays mounted (hidden via CSS) per open character, so
  its React state IS the unsaved draft across tab switches. Every editor publishes dirty state
  through the shared `useEditorGuards` hook, which also owns Ctrl+S and the window-close warning.
  Closing a dirty tab from the tab strip, keyboard, editor back button, or context menu opens one
  shell-owned Discard changes / Keep editing dialog; only explicit discard unmounts the draft.
  Pure logic in `workbench/editor-core.ts` (tested), the React component in
  `workbench/Editor.tsx`. Lorebook, persona, preset, regex, and pack pieces dispatch to their own
  writable editors from `workbench/index.tsx`. Quick-reply sets have their own editor for set name,
  button label, hover title, hidden state, and inert message or slash-command text; they never fall
  through to the character editor.
- **Preset editor.** Canonical `body.groups` render as a depth-first category tree. A group carrying
  `parentGroupId` is indented beneath its parent; collapsing a parent hides its complete descendant
  subtree, and the parent count includes every prompt in that subtree. The prompt editor's Category
  menu uses the same hierarchy and shows full paths such as `Astrolabes / Difficulty`, so two
  identically named subcategories cannot be confused. Ctrl+Z undoes and Ctrl+Y or Ctrl+Shift+Z
  redoes recent edits through a bounded delta history. In a narrow editor pane, the prompt list and
  settings stack while the remembered desktop split remains available when the pane widens.
  The list's toolbar has "+ Marker" (`preset/marker-menu.tsx`): every marker slot, SillyTavern's and the feature
  markers (Trackers, Library trackers, Storyboards, Skills, [entities/preset.md](entities/preset.md)), the placed ones greyed
  since a slot is placed once. The new marker lands at the end of the list with its slot as its id when that id is free;
  drag it into place and set its placement in its row like any block.
  Preset settings also list regex and quick-reply pieces from the current studio. Checking a row
  writes only its canonical id into `behaviorRefs` or `quickReplyRefs`; the linked piece stays
  separately editable and the Press resolves it by kind and id.
- **Quick-reply editor.** A quick-reply set opens as an ordered list of labeled messages. Add,
  remove, reorder, label, and message edits stay in the local draft until explicit save, using the
  same revision check and dirty-state guard as the other Workbench editors. Long reply lists render
  a measured window of rows while keeping the focused row mounted.
  Canonical path writes and variant lifecycle/override writes now delegate to the same entity-layer
  operations used by Kit's typed character capabilities, so base and variant semantics cannot drift.
- **Tracker, tool, dice and formula editors.** The four small library kinds open in editors built alike
  (`src/ui/apps/workbench/pieces/`): the shared editor header (the piece's monogram, name, one meta line, save
  state), framed panels, and columns of fields | page | rail that fold by the pane's width. Their save is one
  lifecycle (`use-piece-editor.ts`): the body is a draft over the saved one, a save sends a patch of the edits on the revision
  opened and sends nothing when nothing changed, the conflict bar and the Workbench's save keys, unsaved mark and
  autosave apply, and a draft the kind's strict decoder refuses is not saved and is explained in a sentence under
  the header. Long lists (fields, table rows, glyphs, a tool's arguments) are windowed.
  - **Header.** The tracker and tool headers say where the piece is linked ("linked in 2 scenes", or "not linked to a scene"), from
    `GET /api/chats/linked?kind=...&id=...` (the live scenes whose prompting names it, settings only); a click lists the scene names.
  - **Tracker.** The Identity & settings disclosure (what it tracks, how the AI should update it, shape, icon,
    how a reply shows changes, an optional prompt line with macro chips), then the fields in the **field editor**
    (`src/ui/_shared/field-editor.tsx`, shared with the tool editor): the field list with add, reorder and delete,
    and one field's page with name, meaning, type, icon, and by type a number's From, To (a number, another number
    field, or none) and Starts at, a choice's chips and start, a yes-or-no or text start. The rail's Prompt tab is
    the exact `### Trackers` block at the tracker's starting values with the plain-line fallback and its token
    cost per reply; its Update tool tab is the tracker's line in `update_trackers`.
  - **Tool.** When the AI should use it; what the tool does (roll the dice a field holds, roll a dice piece, run a
    formula, or just note the call); the fields in the same field editor, each with "The AI must fill it". The rail's
    The AI sees tab shows the call name, what it takes as plain lines read off the provider's parameters and the token cost; its Try tab
    fills the arguments and shows exactly the answer the AI would get from the real tool reader and runner. A
    formula tool says it needs a scene and opens the formula.
  - **Dice.** Roll, Table or Pool, each with a one-line roll card using the real piece roll. A table shows each
    row's chance and lights the row the last roll picked; "+ Row" and "Paste a list..." add rows.
  - **Formula.** The formula text in the code editor with macro chips, and a Try it rail: pick a scene, Run shows
    the result, how long it took, or why it stopped, through `POST /api/chats/formula-try` (the scene as it stands, built
    without a connection or a window to fit, then the read-only formula path; nothing in the scene changes).
- Preset, lorebook, quick-reply, regex, and HTML drawing saves use one shared editor lifecycle for
  serialized revision-checked patches and conflict choices. Captured touched occurrence deltas avoid
  rebuilding every sibling item on ordinary edits; structural changes use complete deltas. Lorebook
  body and native folder changes share one bounded chronological undo history. Captures release
  their pending provenance when settled or canceled. Partial bulk failures retain the actual last
  accepted body/revision beside the unsaved draft. Keep Mine compares the complete captured draft
  against the fresh conflicting entity and retains overwrite intent through failed retries.
  These paths are independently source-reviewed; runtime proof remains pending.
  These editors open light entities; lorebook separately reads coherent versioned Marinara folder
  and import-heal escrow entries. Character, Pack, and Persona now open light entities and use
  revision-checked patch saves, bounded history and editor-owned upload grants. Character defers
  native escrow reads and captures named-asset changes with its accepted submission. Complete export
  uses a full read on explicit request. Supporting save/dialog/picker source has been integrated;
  asset route/cache composition is integrated and independently source-reviewed, with no live proof.
  The shared save queue marks timer-triggered autosaves explicitly;
  storage groups them within a fixed five-minute history window. Buttons, Ctrl+S, and Keep Mine retain
  manual version boundaries. These storage and queue paths are independently source-reviewed; runtime proof remains pending.
- **SPLIT VIEW - anything can sit beside anything.** The shell store carries a second visible key
  (`splitKey`, never equal to `activeKey`); "Open beside" on the `entity` menu pins any piece into
  a second pane next to the active one (opening it first if needed - the explicit gesture skips the
  follow prompt). Focusing the pinned piece SWAPS the panes (both stay visible); closing the primary
  promotes the pinned piece; the pinned tab wears an inset accent bar. The pane-key rules are pure
  and unit-tested (`shell/store-core.ts`: `focusKeys`/`removeKeys`/`besideKeys`). Apps read
  `workbench.beside()/openBeside()/closeSplit()` off the ctx. The capability lives in the shell -
  no editor owns it, every current and future kind inherits it.
- **THE FLUID-LAW CONTAINER SEAM.** The workbench stage and every piece pane declare
  `container-type: inline-size`, and the editor family (Character, Pack, Lorebook, Workshop)
  collapses via `@container` queries against the PANE, never `@media` against the viewport - a
  half-width split, a future drawer, and a phone all compose the same way (design/DECISIONS.md,
  the fluid law). A stage too narrow for two readable panes stacks the split vertically.
- **Lorebook editor.** The
  character editor's sibling: ONE ENTRY OWNS THE SCREEN. `workbench/LorebookEditor.tsx` merges
  one-concept skins (chassis + `lore/entry-page` + `lore/entry-toc` + `lore/entry-rail` + the dial/
  key skins; a class name lives in exactly ONE module). Header: the book's SPINE CHIP (monogram,
  name, entries · ~tokens/budget, a "book rules" link opening an InkDialog with the book form),
  the Writing-for select (presentation only; the book never forks), Save. LEFT: the quiet TOC
  (`entry-toc.tsx`: search across titles+keys, grouped with counts - "Always on" + the rest;
  category folders slot in later - active row wears the accent bar, disabled entries strike
  through, + New entry). CENTER (`entry-page.tsx`): the entry masthead (ENTRY N OF M pager, ~tok,
  On/Off, name in display type, a COMPUTED "Fires on: …" line - never a stored field) and the
  dossier cards: KEYS (primary + "only together with" side by side, AND-any logic select always
  visible, Simple/Advanced tabs in the card head; advanced picks a chip and edits its riders via
  `trigger-editor.tsx`/`trigger-edit.ts`), TIMING & CHANCE directly under Keys (a fold whose
  summary line honestly states what it hides: sticky/cool/delay, recursion segments, group), 
  PLACEMENT (one row of position pills, `position-picker.tsx`), THE PASSAGE (big serif textarea,
  {{user}}/{{char}} inserts, char/~token count), a folded CREATOR NOTE card, and PLATFORM CARDS -
  the character editor's native-fields doctrine applied to lore: ONE FILE PER PLATFORM under
  `lore/platforms/` (sillytavern/rolecall/novelai/risu; registry.ts is the one stated seam;
  platforms with no long tail have no file - deny by absence), each rendering a platform-NAMED
  folded card surfaced only by its Write-for lens (Bunzai shows them all; RoleCall has no lens -
  the Bunzai card covers its wire). The lens select lists each platform separately - SillyTavern,
  Chub, and Lumiverse are three lenses on the codec-grounded ownership matrix
  (`core/lore/platform-fields.ts`), never one smushed tab. RIGHT
  (`entry-rail.tsx`): the fine print - Order & survival label/value rows (order, priority, always
  keep, chance, speaks-as, scan depth, whole-words/case tri-states, move/copy/delete), the
  sample-match try-a-line, and quiet health tips for the focused entry. Session is pure and
  unit-tested (`lore/session.ts`: one focusedId; TOC click and pager both go through
  `selectEntry`). The RC codec (`formats/rolecall/lorebook.ts`) remains the field-coverage
  checklist; token estimates are the core's honest gauge (`estimateEntryTokens`/
  `estimateBookTokens`, ~4 chars/token, always rendered with "~").
- The bottom app dock collapses only through Hide dock, leaving a visible Show dock edge pill. Hiding lasts for the session only: every launch starts with the dock showing. Focus follows the visible control and returns to the active app when expanded.

### Editor theme variants

`editor.frame` (two-pane, tabbed-menu, card-stack, long-form) rearranges the character, persona, sprite pack,
HTML doc, preset, lorebook, regex and quick reply editors. Each editor declares its sections and passes them to
the shared `EditorLayout` (`src/ui/apps/workbench/layout/`): two-pane shows a section list beside one section,
tabbed-menu shows a numbered menu above one section, card-stack stacks every section as a card, and long-form runs
them as one document with a contents margin. Closed sections stay mounted, so unsaved input survives switching.
Picking a regex rule or lorebook entry opens its page section. With no pick, each editor keeps its own layout; the
character editor's Bento and Playbill choice is shown but disabled while a theme frame is active. `editor.fields`
(labeled-rows, stat-sheet, cards, form-on-paper) styles every field drawn through `EditorField`; the header name
is excluded. Stylesheets live in `src/ui/apps/workbench/variants/<surface>/<variant>.ts`.

### Nodes view

A Desk / Nodes switch sits in every editor's header and in the empty room; the choice is remembered
(`workbench.view`). Nodes (`src/ui/apps/workbench/nodes/`, wireframe `design/wireframes/features/nodes/`)
draws the open pieces on a pannable, zoomable canvas with three layers you can switch on and off. Desk and
Nodes share the same open pieces, and every Desk editor stays mounted while Nodes shows, so unsaved drafts
survive the switch. The recent rail stays visible in Nodes view, since it is how more pieces come onto the
canvas.

- **Links.** Wires come only from stored reference fields (`LINK_PORTS` in `core/links.ts`, read from each kind's `links` in its kind.ts): a character's
  and a persona's lorebooks, a character's and a preset's regex sets, a preset's quick-reply sets. A piece
  referenced by two others is one node with two wires; a referenced piece that is not open is a faded node
  with Bring up. Dragging a port onto a compatible node links it; selecting a wire and pressing Delete, or
  Unlink in the inspector, removes it. Each change reads the piece fresh and saves only that field
  (`nodes/link-write.ts`), the same save the editor makes. A piece with unsaved Desk edits cannot be changed
  from Nodes: its ports are disabled until it is saved or discarded. A revision conflict saves nothing and
  says so. Characters have no stored sprite-pack reference, so there is no pack wire.
- **Pipeline.** A preset on the canvas opens into every block in build order (`buildOrder` in
  `core/preset/build.ts`; off blocks struck through) with per-block tokens. Clicking a block switches it on
  or off and dragging one onto another reorders it, each a single preset save through the preset editor's
  own helpers; a move that would not change the build order is refused with a sentence. Marker blocks take
  derived wires from the context character, persona and a Lore pass step. The Request node picks a scene
  and, with several presets on the canvas and no scene, which preset to build from; with a scene its totals
  and Preview come from the scene forecast, otherwise from a dry run of the canvas pieces that is labeled an
  estimate (empty slots show their placeholder and count as nothing). Feature placement controls
  (Trackers, Library trackers, Storyboards, Skills) appear for markers actually placed in the canvas presets.
  **Feature placements** reveals the remaining controls when you want to add a marker; they are hidden by default
  and excluded from Fit and the minimap while hidden. An unplaced control has no wire to the Request: it is an
  available placement, not evidence that a feature contributes to the request. These controls never enable a feature.
  A placed control names every preset marker it wires to. It reads the marker the assembler fills (the slot's first
  switched-on marker in the preset's order) by the preset's own switches, not a picked scene's.
  Its **Place in preset** port is a piece node's port and draws a wire with the
  same drag as a link: released on a block of any preset, it puts the marker at that block's place in the list, as
  dragging a block there does, taking its placement, depth and order and switched on (added when the preset has none).
  Its wire to a marker selects like a link's, and Delete gives the feature its own spot by switching the marker off,
  kept for the next place. While its wire is drawn, the block it would land on is lit (the topmost preset under the
  pointer wins). Each is one preset save through `nodes/preset-write.ts`, refused when the blocks changed
  since they were drawn or the preset has unsaved Desk edits.
- **Board.** Notes and frames anywhere on the canvas; a frame moves what is inside it and a note can be
  pinned to a node. Board items belong to the workbench (settings), not to pieces, so exports never carry
  them. Pictures are not offered yet: an upload is only kept when a piece saves it.

Positions, zoom, layers and the board persist in `workbench.nodes`, saved after a short pause and only when
something changed; board items that fail to parse are kept and written back untouched. Tidy up lays the
graph out again; Fit frames everything. Below 768px the canvas is look-only.

## The Press room (batch export - the staged set prints)

Installed-host exports share `studio/exports.ts`: each Press run and single-piece export gets a fresh
`<studio>/Export/<timestamp> <label>/` folder. Files stream separately, create-only; a duplicate name
receives a numbered suffix. Requests rejected before file creation never remove an earlier artifact.
Incomplete exclusive writes are cleaned by their writer, and success follows file-content sync.
Remote and Browser Studio exports keep browser downloads. A failed folder copy is reported as incomplete;
the download remains available. JanitorAI and Saucepan appear as export targets through their format folders.
The header reads "The Press" (kicker "Convert files"). Each staged bundle or solo is a Panel with its piece kind's deck edge; an empty queue is a Panel reading "Nothing staged".
The staging grammar applied to export: the Library browses, pieces get STAGED for the Press
(right-click "Stage for the Press", or the room's own left rail of unstaged-piece stamps), and the
room works only its staged queue - no studio browser inside. The queue is shell-store state
(`pressQueue` + `ctx.press`), so it survives app switches.
- **Bundles** (`press/press-bundles.ts`, pure + tested): a staged piece with LINKS travels as a
  bundle. A character's `body.knowledgeRefs` lorebooks ride along; a preset's `body.behaviorRefs`
  regex sets and `body.quickReplyRefs` quick-reply sets ride the same way - the promise the preset
  schema has carried since `behaviorRefs` landed, which the Press simply never read, so a preset's
  regex left the building alone and the export looked "stripped". Riders resolve against the whole
  studio by kind AND id (even when never staged), are droppable per run ("drop from this run" /
  "ride again"), and staged pieces already riding a bundle are not doubled as solos. Everything
  else rides solo.
- **Readiness on every card** (`press/readiness-core.ts`, pure + tested): characters are read
  against the run target's coverage claims (`/api/coverage` carries - the same ground truth as the
  editor lens): "8 of 23 filled - empty: nickname, personality, +12 more" with an
  open-in-the-editor fix link. Lorebooks get the can-it-ever-fire check (`lorebookKeyGap`: entries
  with no triggers and not constant). No claims = an honest nothing, never fake green.
- Export results keep the same distinction: undeclared target coverage reports loss as unknown
  (`counts.dropped: null`) instead of presenting an empty confirmed-drop list as zero loss.
- **One target per run** (`press/press-core.ts`: `groupPlatforms` folds extension-map hosts -
  Marinara/Chub print characters as a CCv3 card, their native character file), per-card filename +
  flavor (.json/.txt/.md only where the wire format is text), skip rows declared before the run,
  per-row honest results (printed with carries / skipped with the reason / failed with the error).
  A run that printed several files hands over one zip; a run that printed exactly ONE hands over
  that file bare, under its own name - a zip with one thing in it was ceremony plus an unzip.
- **A Sprite pack prints by reference.** The row never opens the pack: the server lists its pictures from the
  light read and writes the ZIP one picture at a time (`ui/_shared/pack-export.ts`, shared with the browser
  Studio), so the server holds about one picture at a time (a picture over the image limit refuses the print, the archive itself has no cap). The tab drains the answer into a Blob as it streams (`ui/_shared/download-sink.ts`), never one array, and a save streams that Blob into the file the person picks where the host has a save picker. Repeated names stay separate
  files (`core/media/pack-zip.ts`), and a picture that cannot be read fails the row with its name instead of
  handing over a short archive.
- Deferred, stated: delivery ledger + saved jobs, drag reorder, rehearse-bytes drawer, offer-rail
  readiness dots.

## The Agent window (the model, standing on the screen you came from)
Light themes use the shared readable Kit palette. Speaker labels use foreground roles separately from decorative spine fills.
Choice panels support arrows, digits and Enter, while active editors retain keyboard ownership. App-switch digits yield to those panels and dialogs.
The docked room is one Panel under a `RoomHeader` ("The Agent"): the kicker shows the connected model with a live dot (or "no model connected", plus a note when the studio folder is not watched), and the lede names the screen it stands on. The header folds away with the band. The floating Kit panel keeps its own head and Kit's terminal palette.
A conversation with whatever model the vault has, holding the real tool belt. The window has **no
provider and no tools of its own**: it asks the loopback server, which asks Kit - one vault, one
egress ledger, one Gate. See [kit/README.md](kit/README.md) for the belt itself.
- **The Gate opens a protected modal.** Before an agent write, a host-owned, dark-ground
  alert dialog opens in the native top layer. The server dispatch loop waits for the person's
  answer before applying the write.
- **It can see the screen.** Each app publishes an `agentSurface` - what the room is FOR, and what is
  worth doing there - and the mounted app adds what is on it right now (`ctx.agent.publish`).
  `surface.ts` joins the two into the brief. That brief is BUDGETED: a describe is truncated at 300
  characters and an action at 200, so a longer one is the same brief with its end cut off.
- **The snapshot travels through the context in BOTH directions** - `ctx.agent.publish` to write it,
  `ctx.agent.current` / `onChange` to read it - and an app must never import `agent/live-state`
  itself. Every app under `/apps` is bundled separately, so an app's own import is a second,
  permanently empty copy of that module: the agent room did exactly that and could not see a single
  publish, saying "no screen has described itself yet" from every screen while the identical
  component in the floating panel worked, because the panel runs inside the shell's bundle. Same
  shape as the `instanceof` split in `_shared/api-fetch.ts`, and just as invisible to a typecheck.
- **A mounted screen is a screen you are standing on.** Only five apps publish live state; the shell
  publishes a bare `<title> is open.` snapshot as any other app mounts, so the manifest's static
  half always has a carrier. Without it the six apps that never publish - Docs, the Macro Lab, HTML
  View, the CSS Workshop, the Apps catalog - left the window with no reading at all and every turn
  went to the model with no screen context. The agent itself is excluded: mounting it would publish
  "agent" over the screen you came from and the window would describe itself.
- **It notices the disk.** The studio-change stream reports the folder rather than an actor, so a file
  the agent wrote and a file dragged in from Explorer arrive the same way.
- **Replies are parsed, not printed.** Kit's own markdown parser draws headings, lists, quotes, tables
  and fenced code, colours a patch as a diff with counts, and offers an ```html block as a drawing
  (see HTML View below). Model output is built from React elements and never from an HTML string -
  there is no `dangerouslySetInnerHTML` in that file and there must never be one.

## CSS Workshop (catalog-only - assisted CSS authoring)
Starters, property knobs, plain CSS source and a sealed preview, for authoring the CSS a card or a
host will carry. Copy or download the result for any host; the room writes no studio state of its own.
The room header ("CSS Workshop") carries only Copy CSS, Download .css, Clear draft and Tour. The Simple / Advanced switch, Import .css and Undo (once there is something to undo) live in the editor's own toolbar (`components/css-workshop/`), under the Targets pack picker; importing a file switches to Advanced. The editor sits in one Panel with the regex deck edge, and each pane (Starters, Assist, Source, Advanced) has its own title.
The preview is the same seal every untrusted-markup surface here uses.

## Help / Docs (catalog-only - the corpus, in the app)
The room opens under a header ("Help / Docs", kicker "The program notes").
The committed documentation corpus as a first-class room, read from the same source GitHub serves, so
the app and the repository can never disagree about what a page says. It reads the generated index
(`docs/generated/docs-index.json`) rather than crawling the tree. Every discovered Markdown page is
listed; until a semantic sidecar and its current independent approval both validate, that page keeps
its structural summary and anchors, while semantic fields remain empty and the docs-index check
reports the incomplete review state.

The room is mobile-first. A narrow pane shows one readable article column with **Browse** and
**Sections** controls that open the shared bottom sheet. At 40rem the catalog becomes a persistent
left rail; at 62rem the current page's heading rail appears on the right. Those breakpoints query the
room's outer container, not the browser viewport, so split panes and phones follow the same rules.
The sheet moves keyboard focus inside, traps Tab, closes on Escape, and restores focus to its trigger.
Modal overlays share `components/dialog-core/`: centered InkDialogs, pane-bottom sheets, fullscreen
editors, and in-stage TrackHare sheets choose a placement while sharing focus trapping and one
topmost-owner Escape rule. Escape reaches the document-bubble boundary only after editor-local
handlers; nested dialogs stack above their parent across placement types, and IME or already-prevented
presses stay with their original owner. The protected library lock/recovery gate remains its own
full-screen boundary.

## The Macro Lab (catalog-only - what a macro actually does)
The header asks "What does this macro actually do?"; the text box is a Panel with the preset deck edge. A dot on a platform in the platform switch marks an engine installed here.
A scratch pad for macro text, and the only surface here that needs no piece open to be useful. Two
halves, kept apart on purpose because one of them is our model and the other is an engine.
- **Reading** (`lab-core.ts`, pure): each `{{token}}` broken out against the chosen platform's catalog,
  nested tokens reported under their container, and a per-token "where else does it work" that asks the
  TRANSLATOR rather than two catalogs - so a name that exists on both ends but means something else is
  a flagged collision, not a clean trip. A token invoking no name is called that, never "supported":
  `isMacroSupported` fails lenient by design so a compatibility check never calls a comment dead, and
  carrying that leniency onto a screen would print a tick beside `{{// note}}`.
- **Resolving** (`/api/macro-lab/*`, host-only): the text is wrapped as a one-block preset and run
  through the platform's REAL engine, so the answer is the engine's rather than ours. Requires a
  checkout, pointed at in Settings > Studio or named by `BUNZAI_ST_ROOT` /
  `BUNZAI_MARINARA_ROOT`; an absent one is a named refusal, never a clean pass. Button-press only,
  one render per engine at a time - SillyTavern's adapter stages a copy inside the user's own
  install, so a mashed button would leave a tree copy per press.
- **Macro bible** - every macro the platform publishes, its own groups and wording, searchable by name,
  meaning or alias, and clicking one INSERTS it at the caret rather than copying it.
- **Operations** - one row per canonical operation, one column per platform, derived from the catalogs
  rather than written down. The EMPTY cells are the content; rows sort gaps-first. A dialect with no
  operation annotations gets no column and is named as absent, because a column of "none" would report
  our gap as the engine's.
- Platforms are `MacroDialect`, which is wider than the write-for lenses: RisuAI and SillyTavern's
  second (registry) engine are reference dialects. `full` is deliberately absent - its catalog IS
  RoleCall's, so it was a duplicate column under a name with no engine behind it.

## HTML View (catalog-only - a drawing at full size)
The header's title is the piece's name ("What the agent drew" for an unsaved reply, "Nothing to draw yet" when empty) and its lede says what the seal allows or what to do next.
Draws one `htmldoc` piece as a whole tab. Reached three ways: opened by id from the Library, handed a
piece by another surface, or handed the raw text of an ```html block from an agent reply. A piece is
carried BY ID and re-read from the studio, so the tab shows what the drawing says now and a reload
costs nothing; only an unsaved reply is carried whole, and the room says so rather than showing an
empty frame.

Everything it draws goes through `SealedHtmlPreview` - `sandbox=""`, `script-src 'none'`,
`connect-src 'none'`, `img-src data: blob:`, DOMPurify. The same component draws the transcript's
inline preview and the Workbench editor's live pane: one boundary at three sizes, so there is no
second renderer to drift. The tab and the editor pane pass `fill`, so the drawing takes the whole
room; the 28rem ceiling on the shared component is for the transcript, where a tall drawing must not
push the conversation off the screen. Either surface goes **Fullscreen**: the browser's own where the
engine grants it, an overlay covering the app where it does not, and Escape leaves both. What goes
fullscreen is the container, never the sealed iframe - being large changes nothing about the seal.
When a document supplies no background, its frame uses the light document surface so default black
HTML text remains readable in every theme.
All CSS works, including a whole document's `<head>` styles - those are
lifted out and re-injected, because sanitizing returns the body alone and the head would otherwise
be thrown away with them. JavaScript never runs and no remote image or webfont loads. Form controls
(`button`, `input`, `select`, `textarea`) are stripped: the same component draws untrusted card
backdrops, where a fake field is a spoofing surface, so a wireframe should draw its controls rather
than use real ones.
See [entities/htmldoc.md](entities/htmldoc.md).

## Settings (drop-in sections)
Settings is built from section modules: one file in `src/ui/apps/settings/sections/` exporting a
`SettingsSection` (id, label, order, `Component: (props: { ctx }) => JSX.Element`);
`sections/registry.ts` is the one stated seam. The rail derives from the registry (`src/ui/apps/settings/
index.tsx`); every control is call-and-response against live settings (theme/accent repaint
instantly). Appearance's house-accent palette labels its theme-aware first color **default**; its Chat layout row (`settings/sections/chat-layout-row.tsx`: Full Chat or Messenger; unset shows Full Chat without saving it) is the studio-wide chat layout, the same key the first-open chooser saves. Shipped
sections: Appearance (theme and house accent), Extensions (package review, access grants, activation and host-rendered contributions), Models (the provider vault),
Connections (MCP in both directions), Spotify (the person's own Client ID and the sign-in), Studio (home app, Library first deck, publish targets, and
the engine checkouts on this machine), Security (the library's lock, and its health check), Backups
(spare copies of the library), Workbench (follow behavior), Memory & Summaries (the chat-summary settings a new scene starts with),
Remote access (tunnel and LAN setup, devices, host controls, and the optional mesh-helper download),
Updates (release checks and version switching), and About.

The room is a `RoomHeader` over a rail and a page. The rail (a `Panel`) groups the tabs into four acts, in this order: Your studio (Appearance, Studio, Workbench, Memory & Summaries), The agent (Models, Connections, Spotify), The vault (Security, Backups) and The house (Extensions, Remote access, Updates, About); a section declares its `act`, and its `order` sorts it inside the act. Each rail entry shows the tab name, a lock on a protected tab, and a one-line status where the section supplies one from non-secret prefs (Appearance: the active theme; Studio: the home app; Workbench: autosave; Memory & Summaries: summaries on or off; Remote access: on or off). The page beside it opens with the act's name, the tab's own title (Appearance is "How it looks", Security "The stage door", Backups "Spare copies") and a lede line. A tab whose form is host-protected then shows the protected lock line, "Protected." and what is protected, with a gold left edge and no frame. Sections are open blocks, separated by rules rather than boxes. In a pane under 56rem (a container query on the room) the rail becomes wrapped chips above the page and the act names are hidden.

Models uses the shared provider vault. Ollama is a keyless native connection with an optional Base URL
(default `http://localhost:11434`) and an 8K, 16K (default), 32K, 64K or 128K context choice. Its installed
models come from that endpoint; changing the address or context cancels the previous lookup. Lookup
failures are visible, a successful retry clears them, and manual model IDs remain available. Saving or
closing the form cancels its lookup. Scenes and Kit send through the same native provider implementation.

Appearance also holds the Stage lights row (`sections/stage-lights-row.tsx`: Moving, Still or Off, pref `ui.stageLights`; see the title screen above) and the installed-theme picker (`sections/theme-manager.tsx`), which reads unified extension metadata and saves only the requested appearance preference. Package review, install/update, operation and appearance grants, enable/disable/revoke, private-data usage and redacted receipt activity are managed in Extensions. Its approval UI shows the host catalog's operation title/effect, requested fields and destinations, concrete resource IDs, session or persistent duration, and budget ceilings derived from the single host preset table; it separates required and optional operations. Effect requests arrive as expiring host-owned tickets with operation-owned review details, targets, and explicit approve/deny actions. Guest contribution descriptors are decoded against the bounded shared contract and rendered with host controls; no extension HTML, CSS, handlers, or remote image URLs are rendered. The Extensions manager refreshes when the shared control revision changes, removing stale contribution actions after changes from another window. Theme selection remains in Appearance; theme package install and scope grants use the same Extensions manager.

Security (`sections/security.tsx`, dialogs in `security-flows.tsx`) is the approved in-between
wireframe 04: the design system's stat tiles under the page head, a mono proof block of what the encryption does
and the one thing it does not, then the password, the recovery words (written, rehearsed, written
anew), the other computers (listed only when there are any, each forgotten after a confirmation),
Lock now (only with a password), the weak-lock notice, and the cleanup-owed card. Its dialogs are the
stage dossier (`src/ui/components/stage-dossier/`): the words shown once and typed back (a wrong
cue is named), the password with the zxcvbn strength meter (a separate `/vendor/strength.js` bundle
fetched only when a password is chosen), and the fresh proof any change asks for while a password is
set. Every call goes to the host-only `/api/library/*` routes.

Security also holds "Check my library" (`sections/health-report.tsx`, words in `health-core.ts`), the health check's
report from the approved wireframe (`design/wireframes/health-check/`). Nothing runs until it is asked. A scan is a job the card
polls: while it runs the card shows a four-segment meter, "N of M parts looked at", and Stop; a clean result says "All well" with how
many rows were looked at; damage is one list of notices, each in plain words with its chip (Needs a choice, Changed, Left over, The
file, Gone), danger plates where content would be lost, and the repairs on offer as buttons (go back to the earlier version, keep
it as it is, set it aside, restore from a snapshot). Set aside asks first, with a preview of what moves, and says it is set aside,
not deleted. Restoring from a snapshot opens a picker of the newest copies. After any repair a result card says whether the item
now checks clean ("Done") or is still reported ("Not finished"); a check that stopped (locked, cancelled) is never shown as clean.
Findings reach the page by words and an opaque id of that scan, never a row key.

Backups (`sections/backups.tsx`, the restore dialog in `backups-dialogs.tsx`, words in `backups-core.ts`) is the approved
wireframe in Security's grammar and inside the same protected dialog layer: the page head ("Spare copies"), tiles (last copy, copies kept,
next copy), a mono proof block (copies are made hourly, encrypted like the library, and sit beside it on the same disk, so they protect
the file and not the machine), a note until recovery words are written ("a copy only opens on this computer"), Back up now, Export library (writes the whole library as a plain, unencrypted folder under `Bunzai exports` beside the studio folder, the same export the `bunzai export` command runs; the Messenger's Data and backups page has the same row), what is
kept (24 hourly, 7 daily, 4 weekly), and the list of copies, newest first, five shown and the rest on request, each named by when it
was made with a chip (Hourly, Made by you, Before a restore). Copies made by you are never thinned but capped at ten ("N of 10"; a new one is refused until one is removed), and copies saved before a restore stay while they hold newer work than the rest; each of those has a Remove button that moves it to a trash folder beside the copies (nothing is deleted). Restore is one dialog: it shows how many chats, cards and messages would
be set aside or rewound, then restores with no "are you sure" gate (the copy it saves first is the safety), then offers Undo
(restoring that safety copy, through the same dialog) or Keep it. While the swap runs it shows one "working" step, not a per-step
checklist. Refusals show a label (No room in the wings, Not this library, Made by another version) over the plain sentence, and say
nothing was changed; a restore is also refused while a reply is open. The done step tells the person to restart Kit or another
program open on the same library, which keeps its own caches. While the library is locked the list shows and Restore is disabled. The routes are `GET /api/library/backups`
and token-checked POSTs `backups/take`, `backups/preview`, `backups/restore`, `export` (one at a time, no path from the page, 423 while locked), `backups/remove` (moves a copy into `library.db.snapshots/trash/`, which frees no space until that folder is emptied by hand), plus `health/scan` (start; `GET` to poll),
`health/stop`, `health/preview` and `health/repair` (`src/ui/server-library-care.ts`, host only; the health routes answer 423
while the library is locked and the page's findings are dropped the moment it locks or is restored).

A restore replaces the library under every open page, so the studio-events stream (`/api/agent/events`) sends a `restored` event and
each page reloads. A window still showing its own restore dialog (or snapshot picker) reloads when the person is done with it, so the
Undo stays reachable.

Before any of this, the shell's library gate (`src/ui/shell/library-gate.tsx`, between the error
boundary and the app) reads the library's status: while it is locked the stage door is the only thing
on screen; while a plain folder is imported, the load-in; once, after an import, "All aboard". An import
with too little free space fails and shows the no-room screen; the app never runs on the folder
instead. Any call
answered 423 announces `bunzai:library-locked` on the window (`_shared/api-fetch.ts`), and the gate
checks again, so an idle lock takes the Studio off screen at the next request. Unlocking elsewhere is
also pushed to the gate, over the same studio-events stream Kit's watcher and every open editor use
for a changed piece: it polls the server only while the load-in is actually moving, or as a fallback
when that stream cannot be reached at all (a remote or LAN session, host-only there).

Spotify holds the sign-in for the Stage wing's Spotify tab: the person's own Spotify app's Client ID (no shared key, no client secret), the exact redirect address to
register (`http://127.0.0.1/spotify/callback`, which Spotify allows because 127.0.0.1 is a loopback address and lets it use any port), Connect, which opens Spotify's sign-in in the
browser and returns to `/spotify/callback` on this app's own port, and Disconnect, which forgets the sign-in on this computer (removing the app's access at Spotify is done
at spotify.com/account/apps). The refresh token lives only in the key vault; the access token only in memory. Playback control needs Spotify Premium.

Connections manages MCP both ways. Consuming: servers this machine runs so their tools join Kit's
belt - add a command, arguments and env (KEY=VALUE lines; values are write-only, listings show key
names), Test spawns a throwaway connection and reports the tool count, and every external tool runs
as `egress`, confirmed at the Gate. The whole `/api/mcp/*` surface is host-only, since an entry is
a command this machine executes. Serving: the card shows the one line that registers Bunzai's own
belt in any MCP client (`claude mcp add bunzai -- bunzai mcp "<studio>"`). The full story is in
[kit/tools.md](kit/tools.md).

Engine checkouts are the one Studio control that is not `ctx.prefs`. A root is an absolute path on
the host's disk, and it decides which folder a subprocess is spawned against, so it is stored in
`engines.json` beside `settings.json` and read and written only over `/api/macro-lab/roots`, which
is host-only whole. A settings GET is not: it is served to a tailed-in or LAN device, and
`/api/version` already withholds the studio path from those same devices for the same reason - a
path carries the owner's username and disk layout.

Paste a folder and press Save: the path is normalized (Explorer's "Copy
as path" quotation marks, a trailing separator) and checked for the engine's own marker file before
anything is written, so a folder that is not a checkout is refused by name rather than stored and
discovered at render time. Saves are serialized - the file holds both engines and a save is
read-modify-write, so two at once would drop one engine's folder. An environment variable outranks a saved folder and says so on the row,
which is what keeps the live render suites pointing where they aimed. Kit reads the same file when a
session is built, so a folder set here is the folder `preset_verify` uses in the terminal.

Remote-access host controls use `/api/remote/*`; release information and version switching use
`/api/updates/*`. Both route families are host-only and remain distinct from ordinary remote-client
content access.

### Settings theme variants

`settings.shape` (program-sections, options-menu, big-toggles, contents-page) arranges the page body, each row with its label and hint, and the segmented control, all reached through `data-sx` hooks. The rail of acts is the room's own and no variant restyles its tabs. The body becomes an open ruled page, a bracketed panel with slot-numbered rows, slab cards with large switches, or the ruled lines of a form. Stylesheets live in
`src/ui/apps/settings/variants/settings.shape/`.

## Shared components (`src/ui/_shared/` and `src/ui/components/`)
Extracted-once UI, layered so a single implementation serves every consumer. The house style below frames every room.

### House style (Premiere)

Every room wears `components/room-header/` (`RoomHeader`): a gold kicker line, the title in the display face, one line of lede, and the room's own actions at the right. Digit runs in a string title are set in the UI face, because the display face draws 1 like a capital I. Press, Settings, the Workbench (its empty bench), Library (the rail head), the Apps catalog, HTML View, the Agent (docked), Help / Docs, CSS Workshop and the Macro Lab each mount one. The floating Kit panel keeps its own compact head.

Groups sit in `components/panel/` (`Panel`): one hard frame with an offset shadow and an optional piece-kind deck color on the top edge. One frame per group: a Panel inside a Panel drops its frame, fill and shadow and keeps only the colored top edge, so boxes never nest. The Workbench editors' head (`components/editor-ehead/`) takes a gold kind kicker and the kind's deck color for its monogram, and sets digits in the mono face.

Colors come from the theme's brand, action and select roles, so rooms follow the user's accent. Monospace is for code, ids and numbers only; everything else is the UI face, and the core `--bk-font-ui` fallback is Atkinson Hyperlegible (a theme's type fields still replace it).
- `components/button/` - the one button family (wireframe `design/wireframes/features/button-family/`), every clickable
  thing in the studio. Actions: `Button` (primary at most once per view, secondary, quiet, danger, link; md or sm; an
  optional leading icon; `block`; `menu` adds a chevron and `aria-haspopup`), `IconButton` (a required `label` that is
  also the tooltip; `size="fab"` for floating actions), `Segmented` (one or several of a few options, `aria-pressed`),
  `Tabs` (a tablist with arrow, Home and End keys, horizontal or vertical; the caller renders the panel), `DocTab` (a
  closable, draggable document tab) and `Chip` (on/off or plain, an optional kind color and count). Rows and surfaces
  (`rows.tsx`, `surfaces.tsx`, `controls.tsx`): `ListRow` (plain, option, tree, picker), `MenuItem` (icon, hint,
  danger, checked), `Disclosure` (section or line, `aria-expanded`), `Tile` (icon, swatch, thumb, app, add), `Card`
  (choice with a "Picked" mark, art, entry, file drop), `Dot` (pager, port, handle), `Toggle` (the on/off switch, `card`
  for a whole-row setting card), `InlineValue` (a value inside text) and `Scrim` (a click-away layer). Colors come from
  theme tokens, so every theme recolors it. Parts take no className or style; per-item data goes through named props or
  `vars` (CSS custom properties only). A state that means something (needs attention, done, destructive) keeps its
  color through `tone` on `Button`, `IconButton` and `Chip` (a quiet icon colors only its glyph), a `Segmented` item
  `tone`, or `variant="danger"`, never through room CSS. Every part carries `data-control` (and `data-kind` where it has kinds), the hooks
  theme variants restyle; the `ui.controls` variants target `Button` and `IconButton`. Lint blocks a raw `<button>`
  anywhere else in `src/ui`, and the style guard blocks CSS that styles the button element
  outside the family and the theme variants.
- `components/swatch-row/` - `SwatchRow` (+ the `HOUSE_PALETTE` constant), the house color-swatch
  row. Preset tiles are the fast path; with `allowCustom` a final `custom` tile opens `PaintPicker`
  (solid mode) for any color. Controlled: `value` in, `onChange(hex)` out. Consumers: setup accent
  step, Settings Appearance, later the editor's per-entity accent.
- `components/color-picker/` - `ColorPicker`, the on-brand HSV surface (saturation/value square, hue
  strip, hex field; no OS dialog). HSV, not hex, is its internal state (hex is lossy at s=0/v=0).
- `_shared/color-math.ts` - the pure color math powering the picker: `normalizeHex`/`hexToHsv`/
  `hsvToHex`/`lerpHex` (fail-closed on garbage; built on `parseHex`, `hexToRgb` and `rgbToHsv` in `src/color.ts`) and `dragFraction` (the pointer-drag fraction math shared by
  the SV square, the hue strip, and the gradient stop rail). Unit-tested.
- `_shared/paint.ts` - the pure Paint model: a `solid | gradient(linear|radial)` discriminated union
  with `paintToCss` and a fail-closed `normalizePaint` (a gradient needs >=2 valid stops). Unit-tested.
- `components/paint-picker/` - `PaintPicker` composes `ColorPicker` to edit a solid color or each
  stop of a gradient. `allow` gates the modes, so the same widget serves a solid-only accent and a
  full linear/radial gradient fill. Solid mode is live via the accent's custom tile; gradient mode
  (stop rail, add/drag/remove stops, linear-angle slider, true-curve preview) is built and
  model-tested, awaiting its first fill consumer (per-entity/pack background in the editor).
- `_shared/ic.tsx` + `_shared/ic-svg.ts` - `Ic`, the one icon door (and `icSvg`, the same glyph as a markup
  string for app marks and library view switches). Icons are named by their real RoleCall ids
  (`lucide:trash-2`, `mdi:drama-masks`); lucide draws stroked, mdi filled, and `fill` draws a lucide glyph
  solid (the Booth bolt, the stop square). The path table `src/generated/ic-glyphs.json` is generated by
  `bun run ic` from `@iconify-json/lucide` and `@iconify-json/mdi` (dev dependencies, data only), cut to the
  ids the source names, with the four glyphs where lucide-react 0.559 differs from the Iconify data
  (`git-branch`, `bookmark`, `coins`, `package-search`) pinned from lucide-react. `scripts/ic-glyphs.test.ts`
  fails on an unresolved id, a stale table, a direct `lucide-react` import, or a hand-drawn 24-unit glyph
  outside the door.

### Control variants (`ui.controls`)

`ui.controls` (quiet, game, sticker, ink) is global, so the shell paints it once into `<style id="bk-controls">`
(`_shared/controls-style.ts`, called by the painter). It sets the button family's shadow offset and frame (through the
`data-control` hook on `Button` and `IconButton`), field frames, and the focus ring. Every element rule excludes `.host-protected`, so the lock, recovery words, Kit Gate and theme manager keep the
host look. The checks every variant stylesheet owes (scoped, square, token-only, focus visible, nothing hidden) live in
`_shared/variant-css-check.ts`; `_shared/variant-css.ts` builds the scoped selectors.

**Room arrangement variants (`app.room`).**

`app.room` (ledger-rail, hud-console, sticker-tray, manuscript-column) arranges the apps that are one room rather than an
editor: the setup wizard (`setup/variants/app.room/`), the Press, the Agent room (docked only; the floating panel keeps the
base arrangement) and the CSS Workshop, each with its own stylesheets under its `variants/app.room/` folder. `ledger-rail`
is the base arrangement and needs no stylesheet. The others move the side parts (the offer rail, the status block, the
actions) and narrow or widen the main column; none removes a part. Hooks are `data-part` attributes (`press.room`,
`press.rail`, `press.offers`, `press.queue`, `press.foot`, `css-workshop.room`, `css-workshop.head`, `css-workshop.stage`)
or the existing global classes. An empty room or empty list marks its message `data-empty`, which the `ui.empty` variants
frame (the Press queue, HTML View, and a Scenes search with no match). The Agent transcript keeps Kit's own look.

## Approved jewel Library and Scenes

The Library and Scenes overview use the approved black surfaces, fine gilded rules and jewel accents
from `design/wireframes/premiere-home/jewel-pages/01-library.png` and `02-scenes.png`. Other proposals
remain awaiting approval in that folder's `APPROVALS.md`.

Lorebooks without artwork receive stable painterly covers from 60 semantic transparent PNG ornaments
and ten painted papers under `docs/media/book-covers/`. The existing lorebook menu adds **Design book
cover**: choose either layer and an editable cover title, or restore original art. These preferences
are local Studio presentation, separate from canonical and escrowed content; exporting a lorebook
does not bake its cover composition into the file. Existing imported artwork is retained by default.
`scripts/book-cover-catalog.ts` derives the catalog from the asset folders.

Scenes keeps **Pictures** and adds **List**, persisted through `scenes.view`. Recent lists have This
Week/Earlier headings; message-ranked lists keep their ranking without date headings. Both shapes use
the existing measured virtualizer, frozen scene art, selection and context-menu owners. Compact rows
retain time, take count/pips, active take and a visible menu, including on narrow panes. The overview
includes the Continue hero, real tail preview and a measured Fan Favorites shelf using star-time order.
The row menu stays above the card's transient Continue overlay and remains separately keyboard reachable.

## Security
The primary listener binds loopback. Optional remote listeners are separate, explicitly enabled
boundaries with join secrets, device approval, and host-only controls. Uploads parse through the same
fail-closed adapters as the CLI (zip-bomb caps included). Scripts inside entities remain data
everywhere. App-manifest SVGs are sanitized before insertion in both the overlay and catalog
(scripts/foreignObject/handlers stripped) because the shell invites third-party drop-ins.


Library, agent mentions, the status bar and Workbench recents share the boot-owned PieceStore.
Initial inventory loading is shared; explicit refresh and recovery can reload it. Accepted receipts
replace addressed summaries, and matching stream echoes clear only their own external-change notice.
Lorebook, regex and persona metadata publish completed reads in batches, fenced by exact summary
identity and library lifetime. Locking invalidates pending reads. These paths are independently
source-reviewed; focused public-boundary fixture results are recorded in delivery evidence, and live proof remains pending.

Paper’s manuscript scene layout keeps a 160 × 224 px portrait in a separate column beside the flexible message body; narrow panes use an 80 × 112 px portrait. The screenplay text fills the available body width without scrolling across the portrait. No decorative margin rule runs behind the text.


The shared scene panel assembler passes the linked session to the rp-core wing in both chat layouts.
New scenes created with the external rp-core integration expose an **rp-core** right wing for
Director and Memory settings and their saved state. Existing scenes retain their previous engine.
The Control Booth character navigator offers **Export scene**, exporting the host transcript and
frozen cast as JSON, rather than the complete rp-core journal. Linked scenes refuse unsupported
legacy transcript and setup mutations; native Ollama and OpenAI-chat compatible providers are
supported. External-core sources live in the `vendor/rp-core` submodule.
