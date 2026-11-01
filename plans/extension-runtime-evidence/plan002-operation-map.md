# Plan 002 operation mapping

This is an implementation map for the current Bunzai extension descriptors and the pinned RP-Core API at
`9cce0552df233c7185329d9cfc5473be67e2e821`. It is not runtime availability metadata. Descriptor
host notes remain the generated authority for what ships.

## Historical public RED and current public GREEN evidence

The baseline failure was captured in `server-chats-core-extension-red.test.ts`: an HTTP-created
Core-linked scene reached the scripted provider without its installed required prompt contribution.
The current regression is `src/ui/server-chats-core-extension.test.ts`; the pending-host-birth overlap
and QuickJS Core adapter regression is `src/kit/extensions/core-scene-guard.integration.test.ts`.
Together the focused current run also checks preview isolation, prompt/event wiring, stale model refusal,
Core append without provider egress, exact mapped edit, legacy behavior, and host creation being visible
but non-writable before its Core header commits. Focused count: see `plan002-storage.md` for the exact
49-test command/result and current typecheck.

| Extension surface | Current owner and gap | RP-Core mapping under review | Exact owner and limitation |
| --- | --- | --- | --- |
| `prompts.contribute`, `prompts.transform` | Shared prompt hook owner executes through RP-Core's required contribution pipeline for linked Core turns and the legacy pipeline for unlinked scenes. | Vendor `HostHooks.appendSystemContributions` adds distinct bounded system messages before canonical budget and shaping; request guard checks every provider attempt. | Required hook failure/cancel prevents egress. Existing non-text blocks are preserved on no-contributor turns; unsupported projections fail closed only when hooks need them. |
| Local prompt preview | Core-linked scenes use the read-only async preview; unlinked scenes use the canonical legacy assembler. | `Engine.previewWithRecordStore` builds from a private snapshot and applies hooks once in the same request builder. | No source journal create/append/link, provider call, or saved draft. The selected narrator is applied only to the private snapshot; extension-owned preview policy must be explicit. |
| `scene.turn.*` events | Core and legacy turn owners emit through the existing dispatcher after the durable event/projection boundary. | RP-Core start/done/failed/stopped map to the existing value-only event payloads. | Content and provider data are omitted; only eligible subscribers receive one lifecycle event. |
| `turns.start`, `turns.continue`, `turns.regenerate` | Shared Core owner handles linked scenes; legacy RoleplayCore remains the owner for unlinked scenes. | Exact linked session, approved connection fingerprint, request/output budget, per-attempt grant/fence checks and cancellation. | Extension-owned runs disable inherited tools and background work without mutating saved config. Compendium/summary follow-ons are refused. |
| `turns.cancel`, `turns.status` | Shared owner records each active actor and run through final projection; legacy owner remains for unlinked scenes. | Core stop/status methods scoped to the package-owned run. | First-party and other-package runs cannot be observed or cancelled by an extension. |
| `messages.send` | Appends a user message in Core or legacy scene storage according to the persisted scene owner. | RP-Core `send()` appends one message; the host atomically projects the exact Core message/sibling identity. | Append-only: never starts a provider turn. Unlinked host/extension Core births fail closed until a committed header is linked or the empty scene is deleted. |
| `messages.edit.preview`, `messages.edit.apply` | Exact mapped Core edit and legacy ChatStore edit are supported. | Stable Core message ID and selected UI swipe identity are validated; atomic projection uses the existing ChatStore edit owner. | Other Core transcript edits remain refused when their mapping or native semantics cannot be proven. |
| `messages.delete` | Legacy scenes use ChatStore; Core-linked scenes are refused. | No Core delete mapping is implemented. | `hide()` is not treated as Bunzai cut/restore. |
| `takes.fork` | Legacy scenes use ChatStore; Core-linked scenes are refused. | No same-scene take mapping is implemented. | RP-Core fork creates another session, not a Bunzai take. |
| `scenes.create` | Desktop and Terminal create/link Core scenes; Browser creates legacy scenes. | Core-capable hosts write an atomic Core birth marker with the ChatStore scene, then create/link the Core header through the scoped owner. | UI loadout defaults and follow-on jobs are not run. Browser is explicitly no-Core; it does not mark legacy rows as Core births. |
| `state.read`, `state.write.preview`, `state.write.apply` | Package-scoped state reads and committed-message writes use the existing encrypted state slots; reply/swipe pending deltas share the Core commit boundary. | Exact turn/package/session/take binding; native append accepts state only with matching successful reply/swipe, and projection repairs exact mapped state after commit. | Continue, first-party, other-package, stopped, failed and interrupted turns cannot receive the pending delta. |
| `scenes.settings.preview`, `scenes.settings.apply` | Core-linked scenes support only connection and backdrop selectors; other legacy settings remain refused. | Connection binding affects the next Core turn; backdrop remains ChatStore UI metadata with revisioned CAS. | No preset/lore/regex/tracker or other native configuration parity is claimed. |

## Durable identity and authorization requirements

- The Core journal is authoritative for linked-scene transcript and turn state. ChatStore is a derived
  UI projection; a projection error after a committed append is recoverable, not a denial.
- Every accepted extension journal mutation must atomically carry an operation identity (or an
  equivalent projection cursor) inside the encrypted Core store. Recovery may repair only an already
  committed operation after revocation. It must never retry an uncommitted guest request.
- `ExtensionCommitContext` is immutable and invocation scoped. The Core RecordStore validates its
  live lease, package principal, operation, exact scene/take/message access and cancellation inside
  the same SQLite transaction as a journal or mapping write. Session mutations are awaited outside
  StageDatabase transactions because the RP-Core RecordStore queues its writes.
- A preview uses a separate read-only API over a versioned snapshot and proves zero `create`,
  `append`, and `link` calls, including for an abandoned-turn journal.
- Collision tests use two independent libraries and same-shaped ids. No engine/session cache or
  package-owned turn map is shared across those stores.
