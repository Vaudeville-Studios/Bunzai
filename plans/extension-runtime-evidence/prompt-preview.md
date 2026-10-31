# Local prompt preview evidence

## Decision

Browser and Terminal prompt preview reuse `assembleExtensionPromptPreview` in `src/studio/scene-forecast.ts`. It reads a stored scene through the canonical stores, replaces only the draft user message, builds the normal request assembly without connecting to a model/provider or applying model shaping/budgeting, and returns bounded value-only messages. `ExtensionService.previewPrompts` then invokes the normal enabled QuickJS prompt hook runner and appends its candidates. This path does not persist the draft or call a provider.

The bounded API exposes stored scene IDs and titles only. The Extensions manager and `/extension prompt [scene-id] [draft text]` TUI command use the same service methods. The result carries the explicit label: “Local prompt preview; no model called; unshaped and unbudgeted.”

## Evidence

- `bun test src/studio/scene-forecast.test.ts src/extensions/runtime/service.test.ts src/ui/server-extension-runtime.test.ts src/kit/extensions/commands.test.ts src/ui/apps/settings/sections/extensions.test.tsx --timeout 120000`: passed on 2026-10-31 (39 tests, 143 assertions for the prompt-focused run excluding the route file; route decoding/cancellation is separately covered in `server-extension-runtime.test.ts`). The service test runs a real QuickJS worker on the Terminal host and verifies a contributed prompt candidate in the returned preview.
- `bun run build:pages`: passed on 2026-10-31 (37 Pages, static Studio contains 12 apps, 4 setup steps, 133 docs).
- `bun run extensions:pocket-browser`: passed on 2026-10-31 in Chrome 149.0.7827.55. The generated Browser artifact loaded the production opaque sandbox frame and QuickJS worker, verified origin/storage/parent isolation, and confirmed zero off-origin requests. That Browser proof exercises the production extension runtime and macro path; it did not invoke a prompt preview because the fixture has no seeded stored scene. Browser prompt preview is therefore composition- and route-tested, but not yet live-proven with a stored scene in the static Pages fixture.

## Limits

The preview is intentionally not a shaped or token-budgeted model request and makes no claim about provider acceptance. It uses the actual stored scene and canonical request assembly, but omits provider connection and model-specific shaping. Browser persistence remains volatile as documented by the host.
