# 004: Restore full remote helper and separate Hoplight/Bunzai launch identity

Status: INVESTIGATING; implementation authorized by owner 2026-10-31.
Base Bunzai: 7588d4bf5c835b4a2176e3ebaf1843f9f5006c66.
Hoplight: inspect and record current clean HEAD before changes.

## Result and evidence

The owner must be able to use Bunzai's complete private-mesh remote flow, with the existing Hoplight Tailscale helper and host-only approval boundary, and launch Hoplight without opening Bunzai. Existing LAN access remains functional. No mesh sign-in, paid service, or real library activation is authorized merely to test implementation.

Root inspected actual shortcuts using read-only WScript.Shell metadata: Desktop and Start Menu shortcuts point at Documents/Hoplight/scripts/launch-hoplight*.vbs. Those scripts select Hoplight.exe, desktop-dev.ts, or vaude-browser.ts correctly. Hoplight desktop-dev treats any busy8321 as its own server; browser launcher accepts any HTTP response under500; runningHoplightAt accepts any /api/version body with string version. Bunzai's renamed runningBunzaiAt has the same weak identity check. Thus rebuilding shortcuts alone is insufficient. Both repos have empty SIDECAR_PINS; Hoplight has a local sidecar/sidecar.exe. Empty pins must never be replaced by invented published URLs or local hashes presented as published checksums.

## Ownership and boundaries

- Product listener identity: src/ui/port-owner.ts and /api/version response owner; callers include CLI, src/desktop.ts, src/desktop-dev.ts, scripts/vaude-browser.ts. Resolve exact response owner by source search.
- Helper: sidecar Go process, src/ui/server-remote.ts resolver/routes, src/ui/remote/sidecar-manager.ts lifecycle, aux-download/aux-install trust boundary, app-data.ts product state paths, release/build scripts. Reuse these owners, no second mesh implementation.
- Source Hoplight C:/Users/chiev/Documents/Hoplight; clean at initial inspection. Bunzai current integration worktree must not be concurrently edited. Create separate task-owned worktrees from reviewed bases and retain all user data/original files.
- Read full AGENTS.md, required vision/architecture/conventions/security/reference docs and accepted ADRs in both repos. Apply vaudeville-systemic-ticket-fix for honest boundary RED/GREEN and independent review.

## Ordered implementation

1. Compare complete helper protocol, resolver, manager, Go source/tests, build targets, release workflows and product state paths. Classify reuse already present versus actual missing behavior. Report source-backed differences before porting. Inspect local binary metadata safely, without signing into mesh or executing it against real state.
2. Capture unchanged failing public regressions with two isolated fixture servers: Hoplight lookup refuses Bunzai and vice versa; generic version-only server is foreign. Test actual launcher selection paths and occupied default-port fallback. Correct one authoritative product identity in each product, ensure launching the second product does not hijack/focus the first. Avoid testing by changing user's port/library. Keep same-product existing-server reuse intentional and tested; consider studio identity if callers require it.
3. Correct browser/dev/packaged callers to use validated identity and bounded port selection. Never accept arbitrary HTTP success as own server. Race/bind failure must report an error rather than claim success. Rebuild task-owned packaged Hoplight if shipping launcher still targets stale binary; do not overwrite the owner's binary until exact path, backup, and tested artifact are ready. Local repair is authorized; Hoplight remote publication is not.
4. Bring Bunzai helper support to parity using the existing protocol and product-scoped state. Build helper with pinned Go toolchain. For source/local use make resolver find the legitimate task-built helper. For releases support actual helper delivery; retain checksum verification before install and atomic writes. A local build is valid local proof but cannot become a download pin until published. Do not publish a new native release or invent a release destination without authorization.
5. Review orphan cleanup carefully: existing manager taskkill /IM sidecar.exe can kill another product's helper. Scope cleanup to the owned process/verified product instance with authenticated state; do not retain name-wide termination. Preserve per-boot proxy secret, loopback/trusted-host restriction, LAN approval, untrusted remote listener limits, encrypted library lock behavior, cancellation/disable, no ambient extension access.
6. Update Remote access UI and canonical reference docs truthfully. Ready local helper must show enable flow; unavailable platforms explain actionable install/build route. Keep off by default, prompt for explicit user authentication. Do not hide failures or state mesh is working from binary existence alone.

## Verification

Record exact baseline/source commit and commands. Use fixture-only tests modeled on port-owner.test.ts, server-remote.test.ts, server-remote-loopback.test.ts, remote/sidecar-manager.test.ts, aux-download.test.ts. Run focused changed/adjacent tests, bun run typecheck, git diff --check, and sidecar go test/vet/build using go.mod pin. No full15k suite, no harness deletion, no weakened hooks. Native launcher proof needs actual built artifact; source-only evidence cannot claim packaged behavior. Live UI through connected browser/native control must show helper available and existing LAN controls intact, without connecting real network accounts. Fresh reviewer audits cross-product identity, process isolation, resolver paths, downloads, and actual artifact evidence. Report any authentication/network verification blocked by lack of user sign-in.

## Delivery and handoff

Freeze source for root review before commits/publication. Keep Plan002 and003 independent. Bunzai Mainstage delivery previously authorized, but do not publish unreachable helper pins or overwrite in-flight integration. Hoplight changes/local launcher repair authorized; publishing Hoplight requires explicit destination approval. Completion evidence states source, integration, live, and packaged results separately and records omitted full-suite/network tests honestly.

## Recon amendment: cross-product private listener collision

The executor confirmed both products bind fixed loopback8788 for the untrusted mesh upstream and construct the helper proxy URL even when that bind fails. Concurrent applications can therefore target the other application's listener; different boot secrets should deny it, but the second app cannot work. Implement ephemeral loopback binding owned by setupRemoteAccess and pass its actual bound address to the existing manager. A boot-owned deferred handler may return503 until initialization is complete; it must not introduce another authentication authority. Add concurrent-instance regressions for distinct addresses, own-secret success, other-secret refusal and independent teardown. Fixed LAN8790 may retain a clear occupied-port failure if it is already honest; never report success or route to a foreign application when binding fails.
