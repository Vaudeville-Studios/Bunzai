# Plan 001: Ship one capability-driven Bunzai extension runtime

> Executor: read this whole document before editing. Execute one numbered work package at a time. Do not replace missing details with a second registry, an unrestricted bridge, or a successful-looking stub. Every work package ends in a test gate. Record evidence in the execution ledger. A 12B model should implement the small steps; a separate reviewer must approve security boundaries, migrations, and release evidence.

- Status: IMPLEMENTED, normal-hook commit authorized after source/verification review. See the execution ledger for measured proofs and remaining manual acceptance checks; the design below is not itself release evidence.
- Requested by owner: a broad extension API, generated permissions rather than a manually maintained list, reuse and consolidation of existing systems, and a complete developer experience.
- Planned at: `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`, 2026-10-31.
- Priority P1; effort XL; risk HIGH; depends on no other plan, but requires all gates below.
- This plan describes intended implementation, not proof of isolation or shipped functionality.
- No source edits, builds, dependency installation, migrations, commits, or deployment were performed to write this plan.

## 1. Intended result and meaning of one system

A developer can build a JavaScript/TypeScript extension, validate and bundle it locally, load it into Bunzai, inspect and approve its requested access, use its commands and panels, update it, revoke it, and remove it. The extension uses a generated SDK. Every privileged request reaches the same broker. The extension cannot receive the Studio bearer token, provider keys, database objects, DOM handles, filesystem paths, or an unrestricted fetch implementation.

One system means one package identity, inspection/install/update state machine, grant authority, operation catalog, invocation broker, audit format, extension manager, and SDK. It does NOT mean one large file, moving pure entity logic into UI, merging Lua and JavaScript interpreters, or forcing every trusted first-party action through third-party approval prompts.

Preserve three distinct concepts:

1. An operation says what can be requested and validates its input/output.
2. An extension grant says which operation, resources, fields, destinations and budgets a particular installed package may use.
3. An action confirmation approves a concrete consequential effect. Possessing an extension grant does not automatically bypass this confirmation.

There must be no second hand-maintained list of operation IDs, permission labels, SDK methods, or documentation. Source-owned descriptors drive those projections. Security policy itself is explicitly authored by trusted Bunzai maintainers, not inferred from an operation name or declared by untrusted package code.

### Completion levels

- Foundations complete: package/grants/broker/engine/storage and hostile tests pass, but no public readiness claim.
- Developer preview ready: all release-blocking work packages and supported-host proofs pass; someone outside the project builds an example from the docs.
- Stable API: a later compatibility commitment after real developer feedback. Do not market this first implementation as a stable API.

The plan includes a broad useful developer-preview surface. A marketplace, automatic remote installation, extension dependencies, arbitrary native code, raw HTML/React injection, unrestricted shell execution, and background activity while Bunzai is closed are outside this plan.

## 2. Baseline, drift check, and workspace protection

Repository: `C:\Users\chiev\Documents\Bunraku-publish`. PowerShell examples assume this directory. Default branch is `Mainstage`. Bun/strict TypeScript, React Studio, Bun loopback host, memory-backed Browser Studio, SQLite-backed desktop, and compiled desktop/CLI artifacts are the relevant environments.

Run first:

```powershell
git rev-parse HEAD
git status --short
git diff --stat fea0b2cb79293745526dec295ae9ddcbf3c6b50b..HEAD -- src/extensions src/entities/capabilities src/kit/capabilities src/kit/tools/safety src/sandbox src/stage src/studio src/pocket src/ui scripts package.json bun.lock
```

Read changed owners and reconcile this plan if HEAD differs. A changed line number is not a reason to reset files. A changed ownership/security contract is a STOP condition until the plan is amended.

At planning time the working tree already contains unrelated Library presentation edits, `docs/reference/ui.md` edits, design studies, media, and `m.png`. Do not stage, revert, format, delete, or overwrite them. Start from a clean isolated worktree/branch when implementation is authorized; do not transplant unrelated dirty changes. Git commits, pushes, merges, publication, and real-user migrations require the operator's authorization for that action and destination. Planning authorization is not implementation/release authorization.

Read `AGENTS.md`, `docs/01-VISION.md`, `docs/02-ARCHITECTURE.md`, `docs/03-CONVENTIONS.md`, `CONTRIBUTING.md`, `docs/reference/components.md`, `docs/reference/ui.md`, `docs/reference/architecture.md`, `docs/reference/glossary.md`, and accepted ADRs. Important constraints:

- Folders are the schema; discover drop-ins and generate imports for packaged/browser builds.
- Pure cores have no rendering, persistence, provider, or framework imports.
- Each authored code file stays at or below 500 lines; split by concept.
- Imported scripts stay sealed. Invocation and bounded isolated execution remain separate from import/conversion.
- A semantic content capability previews; durable apply is separate and revision checked.
- ChatStore owns scenes, message versions, checkpoints and state deltas. Do not add an extension chat journal.
- Reuse Button/Disclosure/Dialog/form primitives, theme tokens, icons and virtual lists. Protected permission/recovery UI remains host controlled.
- Tests use throwaway stores, clocks and providers. Never point a test at the owner's real library.
- Do not remove failing assertions, bypass hooks, loosen CSP, or regenerate security pins to hide a failure.

Some architecture overview prose still describes older storage. For storage changes follow `src/stage/contracts/`, current implementations and storage-specific reference pages; explicitly correct inaccurate documentation in the relevant work package.

## 3. Verified current owners: reuse, adapt, or replace

These facts were code-read during planning. They are not a full security audit.

| Existing owner | Current responsibility | Required treatment |
| --- | --- | --- |
| `src/entities/capabilities/types.ts`, `catalog.ts`, `descriptor.ts`, `index.ts` | Pure semantic operation metadata; effects `read` and `draft`; typed input and previews | Extend with explicit extension exposure metadata; keep operations pure |
| `src/entities/_shared/define-content-capability.ts` | Defines canonical deferred draft defaults | Accept an explicit extension policy; never default existing capabilities to exposed |
| `src/entities/<kind>/capabilities/`, `src/formats/<platform>/capabilities/` | Actual semantic content operations | Reuse implementations; annotate reviewed operations at their definitions |
| `scripts/capability-manifest.ts`, `src/generated/capabilities.ts` | Generate browser/compiled import seam from source folders | Extend this discovery pipeline; do not hand-edit generated imports |
| `src/kit/capabilities/discover.ts`, `runtime.ts`, `adapter.ts` | Kit discovery, progressive exposure, pure previews into drafts | Preserve Kit behavior; extract genuinely shared draft orchestration only when needed |
| `src/kit/changes/session.ts` | Session-local composed change drafts | Reuse after extracting pure shared draft ownership, if it currently imports Kit-only types |
| `src/kit/tools/safety/access.ts`, `risk.ts`, `gate-core.ts`, `gated-dispatch.ts` | Exact-name Kit trust classification, risk decisions, confirmations | Reuse policy primitives where their contract fits; extension resource grants must be additional and unavoidable |
| `src/kit/providers/egress.ts`, `src/ui/server-asset-fetch.ts`, `src/kit/providers/egress-vetted.test.ts`, `src/egress-doors.test.ts` | Vetted user-URL transport, resolved-address pinning, redirect checks and the outbound-door guard | Reuse/extend `guardedFetchVetted`, `pinnedSender` and `VettedDeps`; do not add parallel DNS/SSRF logic |
| `src/extensions/theme-contract.ts`, `theme-appearance.ts`, `theme-css.ts`, `theme-binary.ts`, `slot-registry.ts` | Strict inert theme/package validation, checked CSS/media and static UI slots | Keep these validators and rendering contracts as the appearance contribution of a unified package |
| `src/extensions/theme-lifecycle.ts` | Theme inspection, digest-bound approval, enable/disable/revoke, audit, safe-mode/crash fallback | Extract/generalize lifecycle once, migrate theme state, then remove duplicate lifecycle logic |
| `src/ui/server-theme-extensions.ts`, `src/pocket/theme-route.ts` | Two transport implementations around the same theme lifecycle | Reduce to adapters over one extension service; retain old theme URLs only as narrow compatibility facades |
| `src/ui/apps/settings/sections/theme-manager.tsx` | Theme management and a local `scopeLabels` map | Move permission descriptions to generated catalog; reuse manager controls in one Extensions manager |
| `src/ui/_shared/theme-slot.tsx` | Host renders static images/text in named slots | Preserve static behavior; add a separate checked interactive descriptor variant under the same placement registry |
| `src/sandbox/lua/engine.ts`, `worker.ts`, `protocol.ts`, `run-in-worker.ts`, `limits.ts` | Wasmoon Lua interpreter, value-only protocol, bounded terminable jobs | Reuse transport/budget patterns, keep Lua compatibility API; do not run JavaScript through Lua or copy its Risu state model |
| `src/sandbox/regex/` and `src/ui/sandbox-host.ts` | Regex workers and allowlisted distinct-origin sandbox asset host | Preserve script semantics; extend asset serving for trusted QuickJS wrapper and WASM |
| `src/stage/contracts/state-store.ts`, SQLite/memory `state-store.ts` | Closed document keys, including current `themeExtensions` | Migrate theme registry through an idempotent import into the new extension store; no competing active authority |
| `src/core/scene-state/types.ts`, `src/stage/store/scene-state-rules.ts` | Writer identity comes from trusted store door; slot validation | Add the extension writer only with the real authenticated broker/store path; never accept writer identity from a guest |
| `src/rp-core.ts`, `src/studio/scene-turn-runtime.ts` | One roleplay core and per-store task/turn lifetime | Inject extension hooks into this owner; no alternate turn engine |
| `src/ui/assets.ts`, `scripts/build-desktop.ts`, `scripts/build-pages.ts`, `src/pocket/runtime.ts` | Packaged assets and browser host | Ship the same catalog, wrapper and engine bytes; declare unsupported host capabilities honestly |

Current-state excerpts to recognize before editing:

```ts
// src/entities/capabilities/types.ts
export type CapabilityEffect = "read" | "draft";
// ContentCapability has id/kind/area/action/summary/input/concurrencyKey/preview.
// There is no extension principal or per-resource grant in this contract today.

// src/kit/capabilities/discover.ts
// Runtime discovers ../../entities and ../../formats capability folders.
// Packaged mode uses allCapabilities from ../../generated/capabilities.

// src/stage/contracts/state-store.ts
// STATE_KEYS currently includes themeExtensions, but no extension runtime store.

// src/core/scene-state/types.ts
export type SlotWriter = "turn" | "background" | "person" | "import";
```

`theme-lifecycle.ts` currently snapshots inspected input, issues a one-use challenge expiring after 300,000 ms, compares its digest on install, and records approved derived scopes. `resolve` checks stored digest and scopes. `revoke` empties scopes and disables. Built-in themes have a host-trusted path; they are not evidence of per-install end-user approval for every package.

`gate-core.ts` allows safe operations in locked mode and broad categories in other Kit modes. This policy is suitable for its current agent workflow, not sufficient authorization for an arbitrary extension to read private data. Never treat Kit `full` mode as an extension grant.

`run-in-worker.ts` and `server.ts` currently contain same-origin fallback paths. Preserve compatibility until reviewed, but DO NOT allow new extension execution to silently downgrade to them. The QuickJS guest receives no browser globals even when the trusted wrapper is a browser worker.

`docs/reference/glossary.md` calls QuickJS planned. Historic `.claude/plans/` documents cite `specs/extensions/runtime.md`, but that spec is absent from this checkout. Do not invent its text or claim it is implemented. This plan supplies a proposed build contract; reconcile a recovered owner-approved spec before implementation if one is found.

## 4. Target architecture and fixed ownership

```text
source-owned semantic operations + source-owned host operation descriptors
       | discovery and deterministic generation
       v
one operation catalog --> permission UI + SDK + API docs + catalog checks
       |
package inspection --> installed package/digest + explicit grants
       |
one ExtensionService per open store (trusted host)
       | creates principal, invocation identity and resource snapshot
       v
QuickJS in a terminable worker, with only a value-only bunzai bridge
       | untrusted request {requestId, operation, args}; never principal/grant/token
       v
broker: decode -> resolve -> authorize -> bounded confirmation -> execute -> validate
       |
existing pure preview / content store / ChatStore / provider / host adapter
       |
project permitted result -> bounded reply; authoritative receipt + redacted audit
```

Proposed new files below are design targets, not present files. Prefer an existing owner if subsequent inspection proves it already implements the same contract; record that substitution in the ledger.

| Proposed path | Sole responsibility |
| --- | --- |
| `src/extensions/contracts/` | Versioned package, policy, grants, principal, wire, error, UI and event schemas; pure |
| `src/extensions/catalog/` | Validated composition of semantic capability projections and host operation drop-ins |
| `src/extensions/operations/<domain>/` | Host-owned operation definitions, projection schemas, policy and narrow injected executors |
| `src/extensions/permissions/` | Pure grant matching, widening detection, policy fingerprints and confirmation requirements |
| `src/extensions/broker/` | Trusted request admission, authorization, cancellation and effect execution |
| `src/extensions/packages/` | Inspect/install/update/enable/revoke/remove, import adapters and recovery |
| `src/extensions/runtime/` | Per-store service, per-extension supervisors, jobs and shutdown |
| `src/extensions/sdk/` | Small guest bridge, SDK generation support and developer diagnostics |
| `src/sandbox/javascript/` | QuickJS wrapper, interpreter bridge, promise pump, worker entry and limits |
| `src/stage/contracts/extension-store.ts` | Versioned extension persistence contract; no engine or UI imports |
| `src/stage/store/{memory,sqlite}/extension-store.ts` | Backend implementations and contract tests |
| `src/ui/extensions/` | Trusted worker host adapter, checked descriptor renderer and local confirmation integration |
| `src/ui/apps/settings/sections/extensions.tsx` | Discovered Settings section for the one manager |
| `scripts/extension-catalog.ts`, `scripts/extension-sdk.ts`, `scripts/extension-pack.ts`, `scripts/extension-check.ts` | Generation and bounded local developer tools |
| `src/generated/extension-operations.ts`, `docs/generated/extension-api.json`, `docs/generated/extension-permissions.md` | Generated projections; never independently edited |

Do not add another central list of kinds, settings keys, UI slots, tools, or adapters. Project existing registries through explicit extension exposure rules. A host operation that does not already exist belongs in its real domain first, with an extension adapter afterward.

### Hosts and principals

- The authoritative ExtensionService lives once per opened store. Desktop/loopback: trusted Bun host owns grants and durable mutations. Browser Studio: the same service with memory adapters in the trusted host page. Terminal: the same service with a Bun worker interpreter adapter, not a browser UI dependency.
- Each running package has a host-created principal containing store identity, package ID, installed digest, API major, policy fingerprint, grant revision and run epoch. None is accepted from guest arguments.
- Browser worker messages are bound to the Worker object and the host-created invocation closure. The trusted UI relays them to its already-authenticated server channel with a host-issued run binding. Guest code receives neither that binding nor UI bearer tokens.
- A sibling worker, stale worker, guest-supplied package ID, or copied request ID cannot select another principal. The server validates the run binding against its own service, not a client-provided permission list.
- Remote/LAN guests may not install, approve, edit grants, issue run identities or manage developer mode. Do not execute packages on an untrusted remote device as though it were the local host.
- A locked library suspends runtime admission, aborts work and removes protected results/UI. Close waits for accepted durable work to settle; no late result writes after the store closes.
- Do not claim simultaneous independent desktop/CLI processes are supported. ADR-014 says cross-process ownership is unresolved. Refuse a second runtime owner until real durable leases exist; an in-process singleton does not solve this.

The extension runtime itself needs a fenced ownership lease before activation. WP4 implements one per fixture/library database; WP7 acquires it before creating supervisors. A lease protects extension-owned work, not every existing first-party application action. This does not claim to solve ADR-014's entire desktop/CLI concurrency problem. Browser memory stores have one trusted service owner per independent store and need no invented cross-tab persistence lease.

## 5. Manifest, package and approval contract

Use a strict versioned JSON envelope, retaining the existing inert theme JSON import through an adapter. New packages contain a manifest, admitted local file map and optional license text. JavaScript/TypeScript is bundled before install to one `main.js`. No install scripts, runtime npm resolution, remote imports, native modules, source-tree dynamic imports, or executable engine bytecode.

Manifest fields: schema version; stable namespaced ID; semantic package version; display name; plain-text description/author; supported host API major/range; optional JavaScript entry; requested operation requirements; activation contributions; optional existing appearance contribution; optional declarative settings schema; package-local assets. URLs in author metadata are displayed as text or explicit external links, never loaded during inspection.

Requirements reference exact operation IDs plus resource constraints, purpose text and optional/required status. Purpose text is untrusted and cannot replace host permission descriptions. Required grants can be declined by declining installation/activation. Optional grants can be individually denied; SDK returns a typed denial and the extension must degrade gracefully.

The package digest covers canonicalized admitted manifest, source code, assets, file names and all effective behavior metadata. Reject unknown keys, duplicate/case-colliding paths, absolute paths, `..`, NUL, oversized files, malformed media and undeclared files. Do not allow code hidden in a nominally theme-only package. Appearance-only packages never create an interpreter.

Package updates and development reloads always produce a new digest review. Do not silently execute changed code because permissions look identical. Carry forward chosen settings/data only through versioned validated migration. A package cannot grant itself access, approve its own update or migrate its own grants. Failed update leaves the old version installed and stopped or safely running according to an explicit atomic swap decision, not a half-new mixture.

Static code inspection may suggest missing requirements for literal SDK calls. It is NOT a proof of all possible operations in JavaScript. Computed/dynamic calls are still checked at runtime against manifest requirements and live grants. Never promise that static extraction is complete for arbitrary JavaScript.

Wildcard requests are developer convenience only: expand to a finite exact set at inspection. Bind approval to that expansion and the operation policy fingerprint. New operations, wider output fields, broader resource scope or changed policy semantics never become granted on host update. Require re-review or disable the affected operation. A renamed/split operation must not inherit access accidentally.

Built-in appearance packages preserve their current host-trusted behavior without acquiring runtime authority. Executable examples and first-party executable extensions use the same install/grant path as third-party ones. No `trusted: true` flag in an imported manifest.

## 6. Permission model and generated catalog

### Authoritative descriptor

Every exposed source operation has stable ID/version; title/description; strict input and output schemas; effect; data sensitivity; supported host features; a reviewed extension exposure policy; resource extractor; result projection; budget class; and host implementation binding. Descriptor schemas and executors are host code, never guest-submitted modules.

Keep the existing pure `ContentCapability` meaning. Add an optional extension exposure descriptor with default absence = unavailable. Require explicit review of each exposed capability. `defineContentCapability` must not mark everything exposed through a default. Generate a projection into extension operation IDs while leaving existing Kit names stable. For draft capabilities, require access to the selected content and approved draft fields before producing diffs; a preview can disclose data too.

Host operations live as folder drop-ins. Use one discovery/generator pipeline to compose them with semantic capability projections. Do not auto-expose HTTP routes, store methods, internal tool belts or every reflected TypeScript function. Generate machine-readable catalog, SDK signatures, searchable docs and permission labels from the same validated definitions. Descriptions may share reusable domain-level wording, but cannot be copied into an independent UI map.

### Grant shape and matching

The grant authority records package/digest/policy identity, operation, exact allowed resource selectors, allowed field groups, persistence duration, destinations and resource budgets where applicable. The guest cannot widen these fields.

- Resource selectors: extension-owned namespace; exact content IDs/kinds; exact scene/take IDs; user-picked asset/file handles; or explicitly approved library-wide scope. Do not use arbitrary path strings or broad glob matching.
- `current` and `selected` are resolved by trusted host at command/event invocation and frozen for that invocation. A scene change must not silently retarget an approved write.
- Search, counts, filenames, snippets, errors and events are reads. Filter before pagination/ranking/count aggregation; an unauthorized object must not leak through a total or error distinction.
- Normal reads and own storage can persist until revoked if chosen. Offer once/session/persistent where useful. Concrete deletes, sends, paid model calls and external disclosures have host-controlled confirmation rules that cannot be weakened by an extension.
- Permissions to read and permissions to send elsewhere are separate. Network or model access combined with content access can disclose that content. Explain this combination at approval; confirm sensitive sends with a host summary of destination and data categories. Do not promise automatic perfect data-flow tracking.
- Unknown operation, malformed selector, missing grant, invalid runtime identity or unavailable confirmation is denial. Kit autopilot/full modes cannot bypass this decision.
- Revoke/disable/update invalidates active run epochs and grant revisions, removes subscriptions/panels, aborts queued and cancellable work, and rejects late results. Recheck grant revision immediately before durable mutation or egress admission.
- Serialize effect admission and revocation. An effect admitted before revocation may already have happened and cannot be undone; show it honestly. No not-yet-admitted effect may start afterward. Do not hold a SQLite transaction open while waiting for a network request or user response.

### Broad developer-preview API inventory

All IDs below are proposed extension IDs, not existing API claims. In content rows, expand kinds and semantic capability IDs from the authoritative entity/capability catalog, not this table. Keep explicit operations separate when their access/effect differs. Every implemented row needs input/output schemas, policy, handler, denial tests and documentation before the generator marks it `available`.

| Domain | Proposed operations/families | Scope and special rule |
| --- | --- | --- |
| Discovery | `api.describe`, `api.search`, `host.features`, `permissions.status`, `operations.status`, `operations.receipts.list` | Public API metadata, only this extension's grants and own admitted-effect receipts; no other packages' private data |
| Content discovery | `content.kinds`, `content.search`, `content.list`, `content.summary` | Approved kinds/IDs; metadata is private content too |
| Content reads | `content.read`, `content.fields.read`, `content.links.read`, `content.history.list`, `content.history.read` | Exact IDs and field groups; history separate; no escrow by default |
| Content drafts | `content.draft.<semantic-capability-id>`, `content.create.preview`, `content.duplicate.preview`, `content.draft.inspect`, `content.draft.discard` | Generated reviewed pure operations; extension-owned drafts only |
| Content writes | `content.draft.apply`, `content.trash`, `content.restore` | Expected revision + host preview/confirmation; never raw save/SQL |
| Characters/personas | Reviewed generated identity, greetings, prompts, variants, links, media and metadata capabilities | Use real capability folders; do not create parallel character APIs |
| Lorebooks | Reviewed generated entry, ordering, matching/settings and notes capabilities | IDs/fields scoped; no hidden entry leak in matches |
| Writing | Reviewed preset blocks/settings, Script Sheet, Skill, Promptbook and prompt-format operations | Add missing pure semantic owners first; editing script text never invokes it |
| Collections | `collections.list`, `collections.read`, `collections.create`, `collections.membership.preview`, `collections.membership.apply` | Named collections and visible members; separate read/write |
| Scenes | `scenes.list`, `scenes.summary`, `scenes.read`, `scenes.create`, `scenes.settings.preview`, `scenes.settings.apply` | Explicit scenes; returned DTO excludes provider secrets and private runtime state |
| Takes and navigation | `takes.list`, `takes.read`, `takes.fork`, `ui.scene.open`, `ui.editor.open` | Fork uses ChatStore; opening UI does not grant read access |
| Message reads | `messages.list`, `messages.read`, `messages.versions.list` | Approved scene/take/range; hidden versions require explicit history grant |
| Composer/messages | `composer.draft.set`, `messages.send`, `messages.edit.preview`, `messages.edit.apply`, `messages.delete` | Draft cannot send; host user-action confirmation for sends/deletes |
| Turn control | `turns.start`, `turns.continue`, `turns.regenerate`, `turns.cancel`, `turns.status` | Existing roleplay core; cost/action approval; only permitted/owned work cancelable |
| Scene state | `state.slots.describe`, `state.read`, `state.write.preview`, `state.write.apply` | Extension-owned namespace by default; named shared slots separately granted; real writer door |
| Extension data | `storage.get`, `storage.list`, `storage.set`, `storage.delete`, `settings.read`, `settings.update` | Own namespace only; expected revision; settings schema host validated |
| Prompt assembly | `prompts.inspect`, `prompts.contribute`, `prompts.transform` | Inspect is sensitive; fixed insertion points and bounded text transforms; no replacement turn engine |
| Workflow hooks | `events.subscribe`, `events.unsubscribe`, `commands.register` | Only declared events/commands; payload filtered at delivery and grants rechecked |
| Models | `models.list`, `models.describe`, `models.generate`, `models.cancel`, `models.usage` | Host connection handles, not credentials; per-call token/spend/request budgets |
| Tools | `tools.list`, `tools.describe`, `tools.invoke` | Exact host-reviewed tools; nested broker check; no arbitrary Kit/MCP belt access |
| Diagnostics | `content.validate`, `content.tokens.estimate`, `macros.describe`, `macros.preview`, `regex.preview` | Pure engines where applicable; imported scripts remain explicit sandbox invocations |
| Transfers | `formats.list`, `formats.describe`, `transfer.preview`, `import.preview`, `import.apply`, `export.preview`, `export.write` | Existing canonical hub/adapters; user-selected handles; fidelity report before writes |
| Media | `assets.list`, `assets.read`, `assets.import.preview`, `assets.import.apply`, `assets.attach.preview`, `assets.attach.apply` | Approved assets and selected target; bounded bytes; no arbitrary local URL |
| Playback | `playback.status`, `playback.play`, `playback.pause`, `playback.stop` | User-approved local/media handles; external streaming not automatically included |
| UI contributions | `ui.panel.set`, `ui.panel.remove`, `ui.notice.show`, `ui.dialog.request`, `ui.status.set` | Host-drawn descriptors; bounded; guest dialog cannot imitate permission dialog |
| Appearance | Existing `appearance.palette/type/shape/surfaces/accent/assets/styles/fonts`, static `ui.slots` | Derive scopes from existing validators; no executable power implied |
| Files | `files.pick`, `files.read`, `files.write.preview`, `files.write.apply` | Opaque host-held user-selected handles; create/overwrite separated; no shell/path authority |
| Clipboard/links | `clipboard.read`, `clipboard.write`, `links.open` | Trusted gesture/confirmation; host-supported only; block unsafe schemes |
| Network | `network.request` | Approved exact HTTPS origins/methods, bounded redirects/bytes/time; no ambient cookies/headers/keys |
| Logs | `logs.write`, `logs.readOwn`, `diagnostics.runtime` | Own redacted bounded records; never host secrets or other extension logs |

Do not mechanically fabricate CRUD for every object. Fields with no supported mutation owner are not writable until a domain contract and tests exist. Use `unavailable` entries in the development coverage report during execution, not callable placeholder endpoints. Every operation/family in this developer-preview table is in scope: expand generated semantic families from reviewed real operations and implement the explicitly named host operations in work packages 8-11. An unimplemented operation blocks completion of its work package and this plan unless the owner explicitly amends the scope. The designed host exceptions, such as browser network access in WP10, are allowed only when metadata and documentation declare them unsupported on that host. Never turn an implementation obstacle into an unapproved permanent deferral.

Never expose provider key read/write, OS keychain access, raw database/SQL, arbitrary Studio API fetch, raw DOM/React, process spawn/shell, extension management/grant mutation, host shutdown/remote-access management, security settings changes, or cross-extension storage. A useful plugin API does not require those powers.

## 7. Execution safety, budgets and asynchronous contract

Use QuickJS compiled to WASM for executable JavaScript, inside a terminable worker. Guest source is interpreted in QuickJS, never `eval`/`Function`/dynamic import in Bun or the browser JavaScript realm. TypeScript compilation occurs in developer tooling, never by granting a guest a compiler/process capability.

Official upstream APIs provide runtime memory/stack limits and an interrupt handler, but these are mechanisms to test, not proof of an application's boundary: [QuickJS runtime API](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md). The binding also supports module loading, which this design keeps disabled for guest remote/native imports. Pin a reviewed package/variant only after work package 2 proves packaging, limits and license compatibility. Do not choose Asyncify solely to avoid implementing a bounded asynchronous bridge.

Proposed initial release ceilings, stored once in `src/extensions/contracts/limits.ts`; tests may inject lower limits, never higher release authority:

| Resource | Initial ceiling to validate in spike |
| --- | --- |
| Package bytes/files | 8 MiB admitted bytes, 128 files; `main.js` 1 MiB; existing theme media/CSS limits still apply |
| Guest VM | 16 MiB QuickJS allocation budget; bounded stack; verified WASM memory ceiling no greater than 128 MiB per worker |
| CPU/job | 2 seconds cumulative guest execution per event/job; 10 seconds active VM lifecycle time excluding tracked host waits; 300 seconds absolute end-to-end job deadline including all waits |
| Host asynchronous operation | Default 30-second deadline; provider generation explicit capped deadline up to 120 seconds; confirmation pause capped at 120 seconds; remaining absolute job deadline is always the outer cap |
| Wire | 1 MiB encoded request/result, depth 32; pages/streams for larger permitted data |
| Work | 32 pending requests per extension, 4 active host requests per extension, 4 active guest workers globally |
| Events/UI | 100 queued events per extension, depth 16 / 200 nodes per UI descriptor; explicit coalescing/backpressure |
| Storage | 5 MiB own data per package, 100 MiB installed package total, 100 installed packages; provide truthful capacity errors |
| Logs | 200 entries per package, 2 KiB per entry; audit metadata bounded separately without secrets |
| Network | 4 MiB response, 1 MiB request, 3 redirects, 30 seconds; unsupported browser targets fail closed |

These numbers are proposed bounded defaults, not measured low-end performance claims. Change them once during the spike based on recorded measurements; do not silently weaken limits to make tests pass. Large libraries use projections, pagination and opaque asset handles rather than raising wire limits.

Jobs are event driven. No always-running guest timer API, unrestricted background loop, or auto-launch from imported content. Explicit activation opt-in starts declared commands/hooks. Queued jobs rehydrate from own durable extension data when necessary, not from arbitrary in-memory globals. If the JS engine is recycled between jobs, document that guest module globals are not persistent; provide storage/events instead.

Promise bridge requirements: validate values before crossing; allocate bounded request IDs; create guest promises with explicit disposal; enqueue host replies; pump a bounded number of VM jobs; enforce both CPU and wall deadlines; reject pending promises on cancellation/revoke/close; dispose handles/context/runtime even on exception. Only host-tracked pending requests/confirmations suspend the active-lifecycle timer, never a guest's claim to be waiting. Guest execution and microtasks always consume the CPU budget; the 300-second absolute deadline never pauses. Test a valid 30-second host wait and a 120-second model wait with injected clocks so they do not accidentally hit a 10-second limit, and test an unresolved wait reaches the absolute limit. Timeout aborts every cancellable host request. A host receipt becomes `cancelled-no-effect` only after cancellation acknowledges that no effect occurred; otherwise it remains running, committed or ambiguous as evidence warrants. A guest promise error `CANCELLED` describes loss of that wait, not proof that an external effect did not occur or authorization to retry. Host-owned receipt/audit bookkeeping may settle after the guest VM is gone while the store remains open, but guest follow-on mutations may not. Close drains accepted bookkeeping or records an ambiguous checkpoint before closing; nothing writes after the store is closed or cipher locked. A promise wait cannot leave a forever-live worker or evade job budgets. Never pass host functions/objects into QuickJS except the tiny explicitly wrapped value bridge.

Errors use strict structured codes: `INVALID_REQUEST`, `UNKNOWN_OPERATION`, `UNSUPPORTED_HOST`, `PERMISSION_DENIED`, `CONFIRMATION_REQUIRED`, `DECLINED`, `CONFLICT`, `LIMIT_EXCEEDED`, `CANCELLED`, `PACKAGE_CHANGED`, `RUNTIME_UNAVAILABLE`, `INTERNAL_ERROR`. Host details stay in redacted host diagnostics; guests receive useful bounded messages without paths, keys or unauthorized-object existence leaks.

## 8. Ordered work packages

Every listed new test path is a proposed file the executor must create. Do not run a nonexistent glob and treat zero discovered tests as success. Each gate requires named tests to be present and executed, zero failures, and no new warnings. Existing baseline failures are recorded separately and cannot be silently attributed to this change.

### WP0. Establish a protected, reproducible baseline

Depends on none. No production behavior changes.

1. Save the initial status, SHA and applicable instructions in `plans/extension-runtime-evidence/00-baseline.md`. Record worktree location; never copy secret values or user content.
2. Confirm all current owners in section 3. Use `rg --files` before opening a guessed path. Find callers of `createThemeLifecycle`, `createCapabilityRuntime`, `makeGatedDispatch`, `runLuaSandboxed`, `createRoleplayCore`, `compareAndSave` and scene-state write doors.
3. Run the focused baseline below and strict typecheck. Run the full supported wall once before changes in the isolated fixture environment if resources permit; if not, mark the full baseline unverified, not passing.
4. Create a work ledger using section 13. Assign every WP a status. Record each source revision against evidence.

Verify:

```powershell
bun test src/core/promptbook.test.ts src/studio/book-phase.test.ts src/extensions src/kit/capabilities src/kit/tools/safety src/sandbox/lua/protocol.test.ts src/ui/sandbox-host.test.ts
bun run typecheck
```

Expected: all named suites execute, zero failures; `tsc` exits 0. On the planning checkout, the first two Promptbook suites alone previously passed 21 tests. That is not a baseline claim for the entire command.

STOP if a fixture targets a real home/library, or a current security contract differs from the excerpts. Do not fix unrelated failures in this plan.

### WP1. Freeze the runtime contract and security threat model

Depends on WP0. Scope: proposed `docs/decisions/ADR-015-extension-runtime.md` (use the next free ADR number if the repo drifted), `src/extensions/contracts/`, and tests. ADR status remains proposed until independently reviewed/accepted.

1. Define package/operation/principal/grant/invocation/event/UI DTOs as strict schemas with matching types. Prefer inference from schemas for boundary DTOs; use the existing exhaustive runtime-shape convention when types are handwritten.
2. Define wire messages with version, request ID, operation and arguments. Guest messages have no authorization fields. Reject unknown keys, prototype-bearing objects, non-finite numbers, cycles, functions, typed host handles, excessive depth/size and duplicate outstanding IDs.
3. Define pure policy matching and policy fingerprint inputs. Distinguish current source operation version, installed package digest, grant revision and running epoch. Do not use a package version string as an integrity proof.
4. Write a threat table: malicious installed JS; malicious media/CSS/manifest; sibling extension; prompt injection in content; remote guest; stale worker/update/revoke race; corrupted local package; resource exhaustion; confused deputy through nested tools; trusted host compromise. State that full OS/host compromise is outside what extension permissions can prevent.
5. Record supported hosts and the exact ownership of confirmations, worker channels, durable writes and shutdown. No engine evaluation in the server main thread. Explicitly propose the narrow ADR-012 Decision 4 amendment needed for the new `macros.preview` caller: user-invoked extension preview through the broker, existing closed-world evaluator and budgets, read-only supplied context, no import/save/codec evaluation. Obtain independent/owner decision review before enabling that operation; otherwise it remains blocked, not an implicit reinterpretation of the accepted four-caller rule. Keep all other ADR-012 constraints. Add a caller-boundary regression proving this does not permit evaluator calls from import, save or codecs.
6. Freeze a delivery coverage matrix in `plans/extension-runtime-evidence/01-required-coverage.md`. Every exact host operation in section 6 and every discovered semantic family has: owner, implementation WP, required hosts, required/explicitly excluded status and boundary test. All section 6 rows are required unless the owner approves a specific amendment. Defaults: desktop supports every listed row; Browser Studio supports catalog/content/collections/drafts/scenes/state/prompt/events/media/static appearance/UI/own storage and diagnostics with its documented volatile persistence, but not general network/model/tool/filesystem/clipboard/native playback/host turn-control operations until equivalent adapters are proven; terminal supports nonvisual core operations after its worker/lease gates, while UI/media playback/clipboard and graphical/native pickers return unsupported. Require a deterministic machine-readable fixture of this delivery matrix solely for acceptance tests, not runtime dispatch. The generated source catalog remains the executable authority. Tests compare required entries/hosts to actual exposed implementations and reject unavailable/stub handlers. An owner-approved matrix amendment must change the plan/ledger visibly; a missing implementation cannot silently become optional.

**Owner-approved host amendment (2026-10-31):** Terminal `files.pick` is supported through a trusted focused TUI path prompt, not a graphical/native picker. Only the host receives the path typed into that prompt; the extension receives an opaque handle. This is proven through the app-to-QuickJS test at `src/kit/render/app-terminal-files.integration.test.tsx`, owner test at `src/kit/extensions/owner.test.ts`, prompt test at `src/kit/render/primitives/safety/extension-file-prompt.test.tsx`, and isolated file-action tests at `src/kit/extensions/file-actions.test.ts`. Existing separate read/write grants and file snapshot checks remain required.

**Owner-approved prompt preview adaptation (2026-10-31):** Browser and Terminal expose a host-local prompt preview that selects an existing stored scene, substitutes a bounded draft, assembles the request through the existing `scene-forecast.ts` request builder without connecting to a provider, and then runs enabled prompt contributions through the normal QuickJS service hook runner. The result is labeled “Local prompt preview; no model called; unshaped and unbudgeted.” This is an inspection tool, not a turn, forecast, provider call, or persistence operation. The Extensions manager and `/extension prompt` TUI command are the callers; the stored-scene list is a bounded ID/title projection.

**Host policy correction after source tracing (2026-10-31):** `composer.draft.set` is a visual control for a mounted Scene composer and is required on Desktop and Browser. Terminal Kit's existing unsent input belongs to its agent conversation and has no canonical stored scene ID (`src/kit/render/app.tsx`, `src/kit/session.ts`). A scene-scoped extension ticket must not overwrite that unrelated input or fabricate a scene association. Terminal therefore reports this operation unavailable. This corrects its initial grouping with nonvisual operations; it does not remove the requirement for Terminal's five headless `turns.*` operations or other nonvisual adapters.

**Invocation context boundary (2026-10-31):** Desktop/Browser command menus obtain at most 16 resource references from the existing Library selection or Workbench focus owner, send a strict host context separately from guest input, and freeze/filter it for the activation. Validated host events and prompt hooks derive their exact target context at delivery. The guest receives immutable resource identifiers only; no names, notes or values are implicitly shared. An invocation selector remains subject to the current operation's exact grants. Terminal has no current-piece selection publisher or `--on` selector in this version, so it exposes no implicit current selection; extensions can use explicit resource arguments under exact grants. Do not invent a Terminal focus or derive authority from guest input.
7. Specify a database-scoped runtime ownership lease: host-generated owner token and monotonic fencing epoch, atomic acquisition only if absent/released/expired, 5-second heartbeat and 30-second expiry using injected clocks, compare-and-renew/release, and a fence check at every extension effect admission and durable commit. A paused old process resuming after takeover cannot write with the old epoch. Lease expiry is not proof that a previously sent external effect did not happen; mark ambiguous calls and never auto-retry them. Takeover of an expired dirty runtime requires explicit host recovery review before executable packages reactivate. Persist no raw authentication secrets in logs or guest messages. WP4 owns backend implementation; WP7 owns lifecycle and refusal behavior.
8. Ask an independent reviewer to check this ADR and threat model before WP7. The author cannot label their own security design approved.

Verify: `bun test src/extensions/contracts` and `bun run typecheck` exit 0. Required cases: unknown version, unknown keys, spoofed principal, invalid enum, forbidden wire values and exact boundary/just-over-limit sizes. Maintain one constants owner; no tests assert a duplicate list of all operation names.

### WP2. Prove the JavaScript engine and packaging choice before committing to it

Depends on WP1. Scope: isolated tests under proposed `src/sandbox/javascript/`, ignored build outputs, dependency/lockfile changes only after the dependency gate.

1. Read the pinned candidate's own API and license. Record package/version/variant, transitive runtime licenses, supported Bun/browser formats and total added artifact bytes. Existing installed `wasmoon` is Lua, not a JavaScript interpreter. Do not substitute native browser/Bun evaluation.
2. Build a minimal QuickJS context with only a bounded JSON request callback and logging callback. Confirm guest `fetch`, `document`, `process`, `Bun`, filesystem/require/import access and host object references are absent. Guest source remains a string interpreted by QuickJS.
3. Prove exact memory/stack enforcement and hard worker termination for synchronous loops, allocation pressure, large strings and promise/microtask churn. Measure worker/WASM memory separately from VM allocation; `setMemoryLimit` alone does not bound the entire worker process.
4. Prove one asynchronous request/reply with guest promise disposal, rejected host operation, cancellation during a pending request, and worker cleanup. Prefer standard guest promises and explicit host replies; Asyncify requires a written justification and its own budget tests.
5. Build and exercise the candidate in dev browser, the generated Pages Browser Studio, and the compiled Windows desktop wrapper. If terminal host is offered, exercise the compiled Bun worker path too. Browser success is insufficient for WebView2.
6. Record numerical measurements and artifact identity in `plans/extension-runtime-evidence/02-engine-spike.md`. Add the dependency only if the license gate and these proofs pass. Pin the chosen version and variant; no runtime CDN fetch.

Verify: `bun test src/sandbox/javascript/engine.test.ts src/sandbox/javascript/limits.test.ts src/sandbox/javascript/promise-bridge.test.ts`; `bun run license:audit`; `bun run typecheck`. Expected: zero failures, guest forbidden globals unavailable, worker terminates within a bounded supervisor margin, no handles leak across repeated jobs, no host effect from denied requests.

STOP if memory ceilings cannot be established, isolation is unavailable, or packaged WASM fails. Record the failing host and keep executable extensions disabled there. Do not choose another engine or reduce isolation without revising the ADR.

### WP3. Generate the operation and permission catalog from source owners

Depends on WP1; engine spike can proceed independently. Scope: existing semantic capability contracts/helpers/generator plus proposed `src/extensions/catalog/`, `src/extensions/operations/`, `scripts/extension-catalog.ts`, generated outputs and tests.

1. Add optional reviewed extension exposure metadata to `ContentCapability`. Existing capabilities remain unexposed by absence. Do not change their existing IDs, pure preview contract, Kit exposure or `read`/`draft` meaning.
2. Extend `defineContentCapability` to carry that explicit metadata. Initial tests use one benign exposed capability and one internal capability; unannotated operations must never appear in the guest catalog.
3. Define a host-operation drop-in contract with strict input/output schemas, extension policy/resource selector, result projector, effect and host feature dependencies. Executor implementations take narrow injected dependencies; catalog generation must not start servers, read a user library or fetch credentials.
4. Reuse `scripts/capability-manifest.ts` discovery rules and `src/kit/capabilities/discover.ts` parity pattern. Add a shared discovery helper only if genuinely shared behavior is duplicated. One generation invocation produces static imports and metadata from the same sorted validated entries.
5. Generate `src/generated/extension-operations.ts`, machine-readable API metadata and permission docs. Keep host-only executable closures out of the guest bundle. The guest sees schemas/docs/types; the broker sees executors.
6. Add commands `extensions:catalog`, `extensions:catalog:check` to `package.json`. Check mode compares deterministic output without writing. Reject duplicate IDs, mismatched effect/policy, missing projection, invalid host requirement and version/policy changes without an intentional fingerprint change.
7. Build a coverage report by domain: discovered existing owner, reviewed exposed operation, unavailable gap, unsupported host. This report is generated from source metadata plus explicitly labeled planned coverage in this plan. It must not create a second executable authority.

Verify: `bun test scripts/extension-catalog.test.ts src/extensions/catalog src/entities/capabilities src/kit/capabilities`; `bun run extensions:catalog`; `bun run extensions:catalog:check`; `bun run capabilities:check`; `bun run typecheck`.

Required regression: add a temporary fixture drop-in, generate, and see it in all catalog projections without editing a central list; remove it and verify disappearance. Compare dev discovery to baked catalog IDs/policies. Confirm an unannotated capability is inaccessible even if guessed by exact name.

### WP4. Add one encrypted, revision-aware extension persistence owner

Depends on WP1. Scope: `src/stage/contracts/extension-store.ts`, memory/SQLite implementations, store composition, next append-only SQLite migration, migration/lock/backup tests.

1. Define storage operations for package bytes by digest; installed package/grant/control record by extension ID and expected revision; namespaced data/settings by key and expected revision; bounded audit records; and idempotent legacy migration marker. The backend provides atomic compare-and-update of the control record. Do not use unrestricted StateStore string keys or filesystem filenames as extension namespaces.
2. Use separate bounded package/control/data/audit records rather than rewriting a 100 MiB JSON registry on every grant change. SQLite bodies use the existing cell cipher and keyed-identity conventions; memory implementation has the same semantic contract. Raw package source, settings and user data are never stored in plaintext columns or diagnostics.
3. Add the next migration after the actual current maximum, not a hardcoded guessed number. Never edit shipped migrations 1-46. Keep backend modules behind stage contracts and obey `scan:boundaries`.
4. Control record schema includes installed digest, approved policy fingerprint, grant revision, enabled state, update/recovery state, namespace data version and import marker. Runtime caches derive from this record. Failed reads/corruption produce disabled/unavailable, not permissive empty defaults.
5. Provide compare-and-set data writes and bounded enumeration. Extension A cannot read/write extension B even with a guessed ID; the broker supplies the namespace. Deletion/removal has an explicit keep-data vs delete-data choice.
6. Add import transaction support for migrating current `themeExtensions` into extension records. Import is idempotent and can resume after failure. Preserve a read-only legacy snapshot/marker until verified; after migration, legacy state is not an active authority. If atomic migration across current contracts is unavailable, use a recoverable staged import with a committed authoritative marker before routing switches.
7. Add the extension runtime lease contract defined in WP1, with atomic acquire/renew/release and a monotonic fencing epoch. Every extension durable mutation checks the live fence inside the same backend transaction as its commit. Thread a trusted extension-write fence through the existing content/ChatStore write doors used by broker adapters; do not accept a fence/principal in guest DTOs, rely on an earlier broker-only check, or use a heartbeat as the commit check. Keep native SQLite transaction bodies synchronous, as `StageDatabase.transaction` requires. Mirror semantics in memory stores. If an existing write API cannot check a fence at its commit boundary, extend that owner with explicit trusted context and tests before exposing the operation.
8. Inspect backup/archive/restore/lock paths and include new encrypted records. Restore must validate schema/digests and not auto-enable executable packages or stale grants without explicit review. Restored leases are never treated as live ownership; imported audit/results remain historical.

Verify: `bun test src/stage/store/extension-store.contract.test.ts src/stage/store/sqlite/migrations.upgrade.test.ts src/stage/store/extension-migration.test.ts`; `bun run probe:sqlite`; `bun run scan:boundaries`; `bun run typecheck`.

Required cases: memory/SQLite parity, stale revision, two competing updates, locked-store denial, corruption, duplicate import, interrupted migration/restart, quotas, uninstall retention/deletion and real backup/restore of isolated fixtures. Add `src/stage/store/extension-lease.process.test.ts`: launch two actual OS processes against one isolated fixture DB, prove only one acquires ownership, prove the second refuses activation, terminate/pause the first, advance an injected test clock or wait a bounded test TTL, recover under a new epoch, and prove resumed old-epoch writes fail at content, scene-state and extension-data commit doors. Test wall-clock rollback fails closed or preserves existing ownership, never creates two owners. If a new test location conflicts with repository test conventions, use a nearby contract suite but record the exact replacement path.

### WP5. Unify package inspection, lifecycle and grants

Depends on WP3 and WP4. Scope: existing theme validators/lifecycle tests and new `src/extensions/packages/`, `permissions/`.

1. Implement the strict envelope in section 5. Reuse existing appearance/media/CSS validators; a new package may combine inert appearance and executable contributions without two package identities.
2. Derive requested appearance scopes from appearance content as today. Derive executable request review from declared operation requirements expanded through the actual catalog. Reject undeclared files/entry, unsupported API major and unavailable required operations.
3. Generalize the existing challenge mechanism: host snapshot, digest, expanded requirements, policy fingerprint, one-use random challenge, injected clock and 5-minute expiry. Bind a review to the opened store and revision. Denial and expiry cannot install/enable anything.
4. Allow individually chosen optional grants. Keep host-written permission labels and resource pickers. Untrusted author text is secondary plain text. Review displays combined content-read plus egress/model implications.
5. Implement install, enable, disable, revoke, remove and update as explicit revision-checked transitions with post-commit verification. A changed code digest always needs update approval. Widened host policy invalidates affected access even if the extension code did not change.
6. Move safe-mode/crash-loop/fallback behavior into the shared lifecycle. Style-only packages need no VM. Executable failures stop the package and remove its contributions without damaging user content or other packages.
7. Adapt `createThemeLifecycle` to this service for compatibility; remove its independent state-writing path as soon as migration tests pass. A compatibility facade translates arguments/results, not a second decision engine.

Verify: `bun test src/extensions/packages src/extensions/permissions src/extensions/theme-lifecycle.test.ts src/extensions/theme-mods-lifecycle.test.ts`; `bun run typecheck`.

Required cases: exact digest binding; changed bytes; replay/expiry; missing optional vs required grant; deny; revoke then enable refusal; update races; policy/wildcard widening; built-in appearance restoration; crash recovery; malformed state; no extension authority from an imported `trusted` flag. Existing theme tests must keep their behavioral assertions, not be deleted to permit a rewrite.

### WP6. Implement the single permission broker and honest effect receipts

Depends on WP3-5. Scope: new `src/extensions/broker/` and shared policy extraction from Kit only where contracts actually match.

1. Implement the exact pipeline: decode request; bind host principal; resolve current operation; check package/run/policy/grant revision; decode arguments; freeze/resolve resource scope; authorize data and effect; request host confirmation when necessary; revalidate current authority/revisions; execute with cancellation/deadline; validate/project output; return receipt; write redacted audit.
2. The request cannot carry its own principal, approval, caller category, writer class, provider connection secret, store object or arbitrary execution handler. Unknown nested fields fail closed.
3. Give operations only the narrow dependencies they need. A `content.read` handler must not receive a general fetch/SQL/host shutdown object. Nested tool/model calls reenter authorization with the same originating principal and a bounded call-depth budget. Do not convert the extension into a fully trusted Kit caller.
4. Treat `classifyRisk`/`decideGate` as a reusable action policy only after extension grants pass. Do not import Kit UI into the broker. Extract a pure shared policy module if needed, preserve Kit modes/behavior with characterization tests, and re-export old imports only as thin compatibility seams during migration.
5. Confirmation reviews are generated by host from resolved targets, revisions and proposed effects. Bind answers to one challenge/digest/review, not a boolean from the extension. If data/revision changes during review, fail with conflict or ask again on the new concrete review.
6. Implement per-store effect admission ordering with revoke/update/lock/close and the live fencing lease. Recheck before mutation/egress; durable writes also check at their transaction's commit door. Cancellation has no success receipt before a verified commit. If an already-admitted external effect cannot be undone, record its actual/ambiguous status and do not retry automatically. Add `operations.status` and bounded paginated `operations.receipts.list` as own-receipt operations in the WP1 delivery matrix. Persist a host operation ID and correlation ID before admitting a consequential effect; send an acceptance acknowledgement before the final result. If that acknowledgement is lost with the VM, the next approved job can list its own recent receipts without knowing the missing ID. Lookup/list applies to the original package/digest, or a host-approved data/grant migration, and returns only redacted status/category/receipt information, never another package's results. Neither lookup nor correlation IDs authorize replay. After full revocation only the trusted host manager may inspect historical receipts, unless receipt-read access is explicitly restored.
7. Bound confirmations, pending calls and audit data. Permission denial must not become a loop of automatic re-prompts. Guest-triggered requests can return a request-for-access indication; only host-controlled user interaction opens a new approval flow.

Verify: `bun test src/extensions/broker src/kit/tools/safety src/kit/capabilities`; `bun run typecheck`.

Required public-boundary tests: guessed internal operation, safe read without extension grant, Kit full mode without grant, forged principal, cross-package draft/file/data handle, stale worker epoch, revocation while queued, revocation while confirming, late provider response, update during write preview, nested tool attempt, unsupported host and missing confirmation UI. Assert the actual injected effect spy/store remains untouched on every denial, not only that an error string exists.

### WP7. Connect QuickJS, the value bridge and the per-store supervisor

Depends on WP2, WP5 and WP6. Requires independent security design review from WP1.

1. Add a small guest SDK bootstrap. Developer entry calls `bunzai.extension.define({commands, events})` with handlers retained inside the guest VM. Package manifest declares allowed command/event identities; runtime registration cannot create undeclared triggers. Initialization may register handlers and bounded logs, not perform privileged effects.
2. At each command/event job, start or reset a bounded VM, evaluate the installed verified `main.js`, register handlers, then invoke the selected handler with a filtered frozen JSON context. Persisted guest state is extension storage; do not promise persistent module globals. Reuse a worker only if reset/isolation tests prove no prior package/job authority or state survives.
3. Implement `bunzai.call(operation, args)` as guest promise request/reply. Use one strict protocol and the broker for every effect. Generated ergonomic methods are wrappers over this same function, never separate dispatch paths.
4. Implement a supervisor with explicit start/ready/running/stopping/stopped/crashed states, global/per-package quotas, cancellation, bounded queues and monotonically invalidated epochs. Acquire the WP4 fenced runtime lease before any executable activation, renew only while this service remains healthy and owns the store, and release after accepted work settles on close. Lease loss stops admission, terminates workers and cancels pending work; late writes fail at backend fences. Refuse a second OS-process owner and show an actionable host message. Revoke/update/disable/lock/close immediately stops admission and cleans registrations, UI and promise waiters. Reconcile dirty expired leases under the host recovery review instead of auto-reactivating packages.
5. Desktop browser worker host: extend `sandbox-host.ts` allowlist and `PackagedAssets` for trusted JS wrapper/WASM bytes. Bind channels to actual Worker objects. No same-origin execution fallback for executable extensions. Authenticate server relays and keep host run bindings outside guest messages.
6. Browser Studio uses the same interpreter/broker contracts and in-memory stores. Terminal uses a Bun worker wrapper with the same QuickJS guest restrictions, not a direct Bun plugin import. Unsupported host operations return `UNSUPPORTED_HOST` before a permission request.
7. Add immutable asset identity to build outputs and startup self-checks. Engine/bootstrap missing or corrupt means unavailable. No CDN repair/download at runtime and no interpreter in server/UI main thread.

Verify: `bun test src/sandbox/javascript src/extensions/runtime src/ui/extension-worker-host.test.ts src/ui/sandbox-host.test.ts`; `bun run typecheck`; `bun run scan:boundaries`.

Required cases: successful async call; multiple out-of-order results; invalid message; oversized result; promise churn; no host globals; sibling Worker spoof; stopped worker late message; timeout while host call pending; initialized-but-not-approved package; store close; two independent fixture stores using identical package IDs; second-process refusal and lease loss while a promise waits. Inject clocks to prove valid 30/120-second host waits succeed within their outer budget, guest microtasks consume CPU time, the 300-second deadline always ends a job, and a late irreversible effect is inspectable through its host receipt rather than retried. Run actual browser worker execution, not only a fake worker class.

### WP8. Expose Library and writing operations through canonical owners

Depends on WP6-7. Scope: existing entity/format capabilities, narrow domain services, `src/extensions/operations/content/`, draft core and tests.

1. Inventory all current semantic capabilities through the generator. Review and annotate safe-to-expose operations at each owner. Group IDs by kind/area; do not list them again in extension source. Add missing Script Sheet/Skill/Promptbook semantic operations to their entity folders with pure previews and canonical decoding.
2. Implement scoped summary/search/list/read DTOs. Default read excludes escrow, raw imported scripts, private history and unrelated assets; add explicit field groups for those that are intentionally supported. Search filtering precedes ranking/snippets/counts. Test unauthorized IDs cannot be distinguished through results/errors.
3. Reuse `createChangeSession` composition by moving the pure draft data/composition core out of Kit if necessary. Keep Kit presentation/provider adapters in Kit. Each draft belongs to the originating extension principal/digest and target revision; raw draft IDs do not grant authority.
4. Implement create/duplicate/edit preview, inspect/discard and durable apply through the existing compare-and-save boundary. Require an approved read scope sufficient for returned before/after values. Durable apply validates complete canonical output, preserved escrow, expected revision, allowed fields and verified stored receipt.
5. Add collection membership operations through its existing store, not a second membership index. Add trash/restore only through actual lifecycle owners with exact targets and host confirmation.
6. Implement deterministic validation/token/macro metadata/preview operations through existing pure engines. Running imported Lua/regex is a separate explicit bounded invocation, not an incidental result of reading or editing a script.

Verify: `bun test src/extensions/operations/content src/extensions/operations/writing src/entities/capabilities src/kit/capabilities src/kit/changes`; `bun run capabilities:check`; `bun run extensions:catalog:check`; `bun run typecheck`.

Required regressions: stale draft rejected; another extension cannot apply draft; denied field not leaked in diff; all kinds preserve originals/escrow; preview makes no writes; scope-filtered search/count; generic unknown-key patch refused; current Workbench/Kit behavior unchanged. Coverage report must enumerate all reviewed capability projections and any missing operation owner.

### WP9. Integrate scenes, state, events and prompt contributions into the one roleplay core

Depends on WP8. Scope: ChatStore contracts/backends, `src/rp-core.ts`, existing scene orchestration, state slot owners, proposed scene/event/prompt operations.

1. Implement scoped scene/take/message read DTOs from existing ChatStore queries. No duplicate journal. Distinguish current visible path, hidden versions/history and prompt/private phase output. Extension scene read does not imply access to all of those.
2. Implement composer draft, message send/edit/delete, fork and turn-control adapters. They call existing core/store doors, carry expected revisions and use host action/cost confirmations. A draft/composer contribution never auto-sends. Cancellation only applies to the extension's own job or an explicitly authorized active turn.
3. Add extension-owned scene slots `ext:<installed-package-id>:<slot-name>` and authenticated extension writer context to the trusted write door. Do not add `writer: 'extension'` as a guest option to `recordMessageDeltas`. Every slot definition declares allowed writers and shape; other packages' slots and core slots are denied unless explicitly exposed/granted.
4. Preserve turn semantics: state proposed during an in-flight turn stays pending on that checkpoint and commits with the turn; after-commit writes name the expected committed version. Failure/cancellation must not leak extension deltas into another take. Extension-originated turns, hooks and background follow-on jobs retain the trusted originating principal/grant revision/fencing epoch through their existing domain commit doors; an injected extension job must not turn into an unfenced first-party background write. Add memory/SQLite parity and storage tripwire updates with documented reviewed shape changes. The two-process fence test must exercise these follow-on paths, not only direct extension-data writes.

   Initial pending-state support is deliberately bounded to a reply/regenerate turn owned by the same extension package, digest, policy, grant revision and runtime fence. Persist the trusted owner with the canonical checkpoint and recheck it at final commit. A first-party or another package's turn cannot acquire those pending deltas; Continue refuses them because existing continuation semantics do not stamp new state. These cases must reject before staging and be described in the API. Exact-message, expected-version state writes remain available after commit. Do not claim universal pending-state support or introduce a second journal to hide this restriction.
5. Hook through `createRoleplayCore`/existing assembly stages. Supported initial events: user-invoked command, scene opened, selected content changed, before prompt assembly, after committed message, turn failed/cancelled. Filter payload by grant at delivery, use origin/correlation IDs, suppress default self-recursion and cap cascades at 4 hops.
6. Background subscriptions require explicit activation and event grants. Queue at most the documented limit; coalesce refresh events, and surface dropped work rather than silently losing writes. Disabling removes subscriptions before another event can admit a job.
7. Prompt contributions use named insertion points and strict text/block descriptors, with deterministic package ID/declared priority ordering. Text from a plugin is data: never recursively evaluate its macros/scripts. `prompts.inspect` is separately granted because it may reveal private notes and assembled content. Transform hooks receive only specifically approved data and return a bounded candidate, not an unrestricted mutable turn object.
8. Hook failure policy is explicit: optional cosmetic/after-commit hook logs and disables after repeated failure; a required prompt transform fails the turn before provider send. No partial assistant message or hidden state commit on failure. Preserve Promptbook private/reply/after flow and its existing recovery semantics.

Verify: `bun test src/extensions/operations/scenes src/extensions/operations/state src/extensions/runtime/events.test.ts src/extensions/runtime/prompt-hooks.test.ts src/stage/store/scene-state-guard.test.ts src/studio/book-phase.test.ts src/studio/scene-turn-runtime.test.ts`; `bun run typecheck`.

Also run the repository's existing scene-state/ChatStore backend suites identified in WP0. Required cases: fork/regenerate/continue, after-phase failure, cancellation, stale take/version, forged slot writer, cross-package namespace, lock/revoke mid-event, recursive events and two extensions transforming in reproducible order. Do not claim scene integration complete on the new unit tests alone.

### WP10. Implement external effects, media and host-specific adapters

Depends on WP6-9. Scope: domain adapters under `src/extensions/operations/`, existing providers/transfers/assets/tool owners; no changes to their canonical semantics.

1. Files: host-held opaque handles from a trusted picker, bound to principal/digest and allowed mode. Revalidate containment and resolved target before each write; distinguish create from overwrite. Refuse traversal, symlink/junction escape, revoked handles and another extension's handle. A file handle never returns an absolute host path to the guest.
2. Network: reuse `src/kit/providers/egress.ts` as the single vetted transport owner. `guardedFetchVetted`, `pinnedSender` and `VettedDeps` already resolve once, reject private addresses, pin the connection and re-vet redirects; `server-asset-fetch.ts` is a caller exemplar. Extend this owner for exact HTTPS origin/method grants, host-controlled request headers, no ambient cookies/auth, byte/time/request limits and cancellation. The current `pinnedSender` is GET-only and `guardedFetchVetted` caps only `response.ok` bodies: explicitly implement validated method/body handling, safe redirect method conversion/body replay rules and byte limits on every response status including errors, while redirect bodies are promptly cancelled. Preserve existing GET asset behavior. Deny loopback/private/link-local/metadata destinations, non-HTTPS, URL credentials and address/redirect escapes. Do not add a raw `fetch` or a second DNS/SSRF checker in an extension adapter. If moving the shared owner out of Kit to avoid layer inversion, update all callers and retain the same implementation once, with compatibility re-export only while needed.
3. Browser Studio cannot enforce desktop DNS/address controls with ordinary browser fetch. Mark `network.request` unsupported there until an equivalent boundary is proven; do not provide a weaker browser fallback. Metadata exposes this before install. User-clicked `links.open` is a distinct host navigation operation with scheme checks and confirmation.
4. Models: use host-selected connection handles and existing provider layer. Return no credentials. Require per-invocation generation consent with visible model, destination, token/output limits and prompt data categories. Budget counters survive guest worker restart. Never retry paid requests blindly after ambiguous failure. Fake provider tests only; live paid calls are not needed for readiness tests.
5. Tools: expose only reviewed exact tool definitions with an extension policy. Invoke through the nested broker with the original principal, arguments and budgets. Do not give an extension a general `ToolBelt`, arbitrary MCP server or shell function. Unknown tools remain unavailable.
6. Transfers/import/export: use existing adapters and fidelity reports. Preview first; apply/write against selected handles after host confirmation. File import does not execute scripts or automatically install a package found inside content. Add cross-format regression fixtures.
7. Media/playback/clipboard: approved asset handles and bounded byte reads; attachment changes use canonical draft/apply. Clipboard read/write require supported host and trusted action. Playback control uses existing media owner; no implicit authorization for Spotify credentials, remote music APIs or arbitrary URLs.
8. UI requests requiring a real user gesture get a host action card. A worker message is not a browser gesture. If the user does not act, expire/cancel without pretending the request succeeded.

Verify: `bun test src/extensions/operations/files src/extensions/operations/network src/extensions/operations/models src/extensions/operations/tools src/extensions/operations/transfer src/extensions/operations/media src/kit/providers/egress-vetted.test.ts src/kit/providers/egress.test.ts src/egress-doors.test.ts`; `bun run license:audit`; `bun run typecheck`.

Required negative cases: redirect off grant, private-address target, DNS/address mismatch, oversized stream, cancellation, network+content disclosure review, spending cap, duplicated paid invocation, arbitrary tool escalation, file escape, handle reuse after update, imported code remains sealed and unsupported browser capability. Use deterministic DNS/HTTP/provider seams in tests, not public network or real keys.

STOP on network address enforcement that cannot be proven or unsupported file containment semantics. Keep that operation unavailable on that host and state the gap; do not weaken enforcement to complete the table.

### WP11. Build one host-drawn Extensions manager and contribution renderer

Depends on WP5-10. Scope: discovered Settings section, existing theme manager migration, host renderer/bridge, operation-derived permission UI.

1. Add the Extensions Settings section using the current section-contract/drop-in pattern. Show installed version/digest, enabled state, granted resources, activity, errors, storage usage, updates and safe-mode recovery. Existing Appearance settings still choose a theme, but installation/grants belong to this same manager.
2. Replace `theme-manager.tsx`'s hand-maintained `scopeLabels` with catalog-derived host descriptions. Appearance-only packages retain their current preview, swatches, approval and recovery functionality through the shared service.
3. Approval UI separates required and optional access, shows concrete resource pickers and combined egress implications, and offers deny/revoke without coercive copy. Package-provided text cannot override host titles, icons, danger labels or buttons. Display names remain plain text.
4. Define a small versioned interactive descriptor tree: text, stack/row, field, select, toggle, button, list and approved asset image. Render through existing components and semantic tokens. No raw HTML, arbitrary CSS/event-handler code, React imports, external image URLs, permission/recovery controls or unbounded lists from guest descriptors.
5. Place contributions through the existing slot registry and real host placement points. Extend slot capabilities explicitly; static ThemeSlot behavior stays compatible. Associate every control with package identity and a declared command/action ID; no arbitrary operation string from a UI event bypasses the broker.
6. Protected approval/lock/recovery layers must remain outside package styling and contributions. Test CSS positioning, z-index, fake dialog content and interaction interception. A general notification/dialog API is visibly extension-branded and cannot issue consent tokens.
7. On revoke/disable/lock/update remove or inert the package's panels/actions and reject stale clicks. Keep focus recovery and keyboard access. Honor reduced motion, container layout and all bundled themes.
8. Log viewer shows useful redacted errors, operation/target category and receipts. Default audits do not contain prompts, chat text, keys, full URLs with query secrets or local paths. A deliberate export of diagnostic content needs user review.

Verify: `bun test src/ui/extensions src/ui/apps/settings/sections/theme-manager.test.tsx src/ui/server-theme-extensions.test.ts`; `bun run lint:ui`; `bun run catalog:check`; `bun run scan:colors:check`; `bun run scan:parts`; `bun run typecheck`.

Live gate in a throwaway Studio: install example, deny optional access, run command, approve concrete effect, inspect receipt, revoke while panel is open, confirm panel/worker stops, update, recover in safe mode. Repeat essential flows with keyboard, narrow container, reduced motion and each supported theme. Record screenshots without the owner's real content. DOM-only/jsdom proof is not this live gate.

### WP12. Ship generated SDK, local tooling and useful examples

Depends on WP3 and WP7-11. Scope: `src/extensions/sdk/`, scripts, template/examples and developer docs. No public registry/account/service required.

1. Generate ergonomic typed wrappers and SDK docs from the catalog, including exact input/output shapes, effects, permission descriptions, supported hosts and error codes. The generated wrappers call the single `bunzai.call`; the low-level call has identical authorization.
2. Add `extensions:check`, `extensions:pack`, `extensions:sdk`, `extensions:sdk:check` commands. `check` validates manifest/assets/declared operations/API compatibility and optionally reports literal-call usage. Dynamic-call analysis is advisory, never an authorization bypass or claim of complete static extraction.
3. `pack` uses existing Bun build tooling to prebundle TS/JS, reads only developer-selected source, writes a deterministic envelope/digest and has no install-time execution step. Deny runtime imports after bundling. Do not add esbuild/webpack/a package manager simply for bundling if Bun already does the job.
4. SDK CLI output is actionable and includes unavailable host features. JSON output emits one strict JSON result; diagnostics go to stderr. A nonexistent operation fails at check time when literal and always fails at runtime.
5. Add an example folder discovered by the existing example inventory pattern. Examples: selected-character consistency checker with draft/apply; per-scene notes/tracker panel using own state; explicitly approved prompt contribution; optional model-backed helper with a fake-provider tutorial; existing inert Encore/theme example adapted without executable powers.
6. Add host-only developer mode: load a selected local package artifact, show the same review, inspect logs, unload/reload. Never run watched arbitrary source automatically with old approval. Reload after changed bytes invalidates run epoch and requires digest review; persistent source-directory access is separate and host controlled.
7. Write a copy/paste tutorial covering project setup, one permission, one command, one panel, one denial, update, revoke and troubleshooting. Include executable API examples derived from real schemas and fixture tests. Explain preview vs apply, selected-resource vs library-wide scope and browser/terminal feature differences.
8. Run a cold-start developer exercise: a person/model without implementation context follows only public docs in an empty temporary project and produces a working extension. Record failures as documentation defects to fix, not instructions to use private internals.

Verify: `bun test scripts/extension-check.test.ts scripts/extension-pack.test.ts scripts/extension-sdk.test.ts src/extensions/sdk`; `bun run extensions:sdk`; `bun run extensions:sdk:check`; `bun run extensions:catalog:check`; `bun run typecheck`.

Required cases: deterministic two-build digest, missing file, undeclared operation, incompatible API version, bundled dependency cannot reach host, optional grant denied, no code execution on check/pack/import, stale SDK output, template compiles and example uses only public SDK. Examples must never contain real keys or user content.

### WP13. Complete consolidation and delete duplicate authorities

Depends on WP5-12. This is a completion requirement, not optional cleanup.

1. Route Desktop and Pocket theme/extension transports through the same service request handlers. Keep authentication/body-size/remote policy at transport boundaries. Compatibility `/api/themes/*` routes translate to shared lifecycle and return legacy shapes; they may not persist separate grants/state.
2. Migrate old theme registry fixtures from every valid lifecycle state: enabled, disabled, revoked, changed host package, corrupt package, safe-mode/crash loop and empty state. Preserve built-in theme semantics. Remove old write paths after successful migration routing; old snapshot is read-only recovery evidence.
3. Search for independent permission maps, install/revoke branches, guest effect dispatchers and direct store/provider calls from sandbox/renderer code. Each remaining map must have a different documented authority, such as Kit's agent risk classification; do not delete distinct policy merely because names look similar.
4. Remove temporary adapters created during rollout when no callers remain. Keep public compatibility seams only with documented purpose/tests and a deprecation policy. Do not keep two operating runtimes behind a permanent feature flag.
5. Confirm Lua/regex compatibility and existing theme functionality still use their authoritative engines and validators. Shared transport helper extraction must not alter script invocation semantics, host grants or allowed imports.
6. Update generated helper/codemap/component/slot catalogs through their source generators. Do not edit generated files as independent source. Update docs/semantic summaries/review receipts using repository workflow and independent review.

Verify: `bun test src/extensions src/sandbox src/ui/server-theme-extensions.test.ts src/pocket/theme-route.test.ts src/kit/tools/safety src/kit/capabilities`; `bun run capabilities:check`; `bun run slots:check`; `bun run extensions:catalog:check`; `bun run extensions:sdk:check`; `bun run scan:boundaries`; `bun run typecheck`.

Add `scripts/extension-boundary.test.ts` or an equivalent focused static guard using repository patterns. It must reject: runtime guest/renderer importing store backends; host guest evaluation outside the QuickJS wrapper; exposed operation missing schema/policy; old theme lifecycle writing independently. Prove the guard fails with isolated violating fixtures, not by mutating production security code.

### WP14. Adversarial and artifact verification gate

Depends on WP13. No readiness claim before this passes.

1. Independent reviewer reads the package decoder, authority bindings, policy matcher, broker, engine wrapper, effect adapters, store migration and all negative tests. The reviewer receives the actual diff and this plan, not only the author's summary. Record findings and resolutions with source SHA.
2. Run the hostile fixture matrix in section 10 through the public package-install/execute APIs and actual workers. Do not replace broker tests with mocks that bypass authentication, grant matching or persistence.
3. Add the catalog/SDK drift checks and hostile contract tests to `verify:ci` and required CI. They must also run for contributions adding capability/operation drop-ins. Keep ordinary Pages landing deployment focused; do not reattach the entire app suite to website-only deployment.
4. Run `bun run verify:ci`. Then build actual artifacts using the current `scripts/build-desktop.ts` and `scripts/build-pages.ts` commands. New worker/WASM bytes must be baked into `PackagedAssets` and copied under the correct Pages base path, with no developer source tree dependency.
5. Run live isolated-fixture flows on each advertised host: dev browser, generated Browser Studio, packaged Windows desktop/WebView2, and packaged terminal if offered. Other advertised OS artifacts require their platform proof before that support claim. Unsupported runtime features show a useful unavailable state, not a fallback to native evaluation.
6. Exercise offline startup and installed offline extension use, missing/corrupt WASM, library lock/unlock, safe mode, app exit with in-flight work, restore and rerun after update. Verify no late writes after close and no executable package auto-enabled by restore.
7. Record artifact filenames/hashes, source SHA, commands, test counts, warnings/skips, numerical budgets, supported-host matrix and reviewer approval in `plans/extension-runtime-evidence/14-release-gates.md`. A green source suite is not a packaged proof.

Verify commands after the new checks exist:

```powershell
bun run extensions:catalog:check
bun run extensions:sdk:check
bun test src/extensions src/sandbox/javascript scripts/extension-boundary.test.ts
bun run verify:ci
bun run scripts/build-desktop.ts --cli-targets=bun-windows-x64
bun run build:pages
```

Expected: zero relevant failures, no unreviewed warnings/skips, packaged live gates recorded against those exact artifacts. Use platform build arguments as defined in the current script; if they drift, record and verify the replacement rather than guessing.

### WP15. Publish accurate developer-preview documentation and handoff

Depends on WP14. Code may be complete before external release is authorized; do not publish without authorization.

1. Update `docs/reference/extending/` with runtime, SDK, permissions, package format, host support and troubleshooting pages. Update `docs/reference/architecture.md`, `glossary.md`, `ui.md`, scene-state docs and theme authoring guide to describe verified owners and actual limitations. Correct historic statements naming an absent runtime spec.
2. Generated API docs list available operations from the runtime catalog and each host's supported feature set. Planned/unavailable operations are clearly separated, never shown as functioning SDK examples.
3. Add compatibility policy: API major negotiation, explicit deprecation, digest review on updates, host-policy widening reapproval, and no guarantee of access after revocation. Document private state/export/removal behavior and that read+network/model grants enable disclosure to approved destinations.
4. Include a truthful security boundary statement and vulnerability reporting link. Do not say unhackable, impossible to bypass, formally verified, or zero-cost inference. Explain limits of OS/host compromise and in-flight irreversible effects.
5. Complete the independent docs summary/review workflow. Run docs/index/link checks. Handoff names remaining unsupported operations/hosts and all evidence paths.
6. Only after explicit operator authorization: prepare scoped commits/PR/release, run required checks on the actual delivered branch, and give the developer-preview URL and downloadable examples. Never infer release authorization from this planning request.

Verify: `bun run docs:summaries:check`; `bun run docs:index:check`; `bun run scan:links`; `bun run extensions:catalog:check`; `bun run extensions:sdk:check`. Expected: no new errors; existing warnings documented and independently assessed. Finish the ledger and update `plans/README.md` only to the level actually proven.

## 9. Integration details the executor must not improvise

### Small-executor checkpoints and exact contract decisions

Do not implement a whole WP in one unreviewed patch. Split each numbered WP step into a source change plus its focused test. After every step, run typecheck and the named focused tests before switching callers. Checkpoint the ledger before handing work to another model. Keep the source buildable between owner extraction and caller migration; delete the old implementation immediately after its final caller switches and its behavior is proven.

WP1 must freeze the concrete schemas for these host concepts before downstream implementation: `ExtensionPackage`, `OperationDescriptor`, `ExtensionPrincipal`, `GrantSet`, `InvocationContext`, `OperationReceipt`, `ExtensionError`, `HostFeatures`, `ExtensionStore`, `RuntimeLease`, and `InteractiveDescriptor`. Fields and versions must be specified in a checked source schema, not independently handwritten in SDK, HTTP routes and UI. The descriptor has an input schema AND an output schema; `unknown` observations from existing read capabilities are not automatically safe output contracts. Introduce explicit observation/projection schemas at their owner before exposing them. Use JSON-value schemas only for intentionally open user data/settings payloads, with depth/size bounds and declared scope.

For each implemented operation, write its minimum boundary test first with this common sequence: install a fixture package -> approve an exact grant through the host review seam -> execute through the real broker -> inspect the actual store/effect -> revoke -> retry -> prove no second effect. Add its special denial cases, not a fresh miniature runtime test harness per domain. Share the isolated fixture service constructor once under a test-support owner. Contract tests use public interfaces; static source guards supplement them rather than substituting for behavior proof.

Never update the acceptance matrix just because a test is difficult. During handoff, a blocked step is a blocked step. The only permitted narrowing is a recorded owner-approved scope amendment with the reason and affected API/host claims.

### Control and persistence transactions

The durable control record and grants are canonical. Runtime maps, UI lists, generated docs and SDK metadata are projections. No `window` state, worker memory or stale UI settings may overwrite a newer control revision. Store operations return typed conflicts; never re-read and overwrite silently.

Package installation is staged bytes -> validated digest -> immutable package record -> approved control update -> verified readback -> enable/runtime activation. Failure before control commit leaves an unreferenced package eligible for bounded cleanup. Failure after commit is recovered from the record, never reported as a successful activation if startup failed. Cleanup is resumable and cannot remove another installed digest.

SQLite transactions may protect local record changes; never keep them open across user prompts/network waits. Cross-domain effects use the existing content/ChatStore compare-and-save/expected-version doors plus the broker's admission ordering. If revocation consistency requires a new transaction seam, implement it in the stage owner with contract tests, not through direct SQL in the broker. If cross-process writers cannot be fenced, refuse that deployment topology rather than claim safe concurrent ownership.

### Data access and projection

DTOs are allowlisted projections, not `JSON.stringify(entity/store/settings)` with a few keys deleted. Asset hashes/IDs, resource handles and revisions may be exposed only where their semantics are documented. Error responses must not distinguish unauthorized object existence. A broad approved read may legitimately return content containing instructions; those instructions never acquire extension permissions or drive host approval automatically.

Optional-grant denial is a normal runtime result. Do not turn it into an exception that crashes every panel. The generated SDK returns typed results or a documented typed error contract consistently; choose one convention in WP1 and use it everywhere, including low-level calls.

### Native/bundled versus guest code

First-party operation modules are trusted compiled host code. Their authority is reviewed at source. An installed package never registers an executable host module, alters policy metadata, sets its own safety class or monkey-patches Kit's tool map. Extensions call operations; they do not become new trusted operations merely by declaring a manifest entry.

Bundled npm dependencies in `main.js` run inside QuickJS and get no extra authority. If a dependency expects DOM/Node APIs, packaging/checking should explain incompatibility. Do not polyfill `fetch`, `process`, filesystem or provider access with unrestricted host objects to make the dependency work.

### Appearance is a contribution, not an authorization shortcut

Keep existing checked CSS/font/media rules. Theme styles currently have broad cosmetic influence outside protected layers; do not describe them as incapable of misleading presentation. The host permission/recovery layer must remain recognizable, unstyleable and uninterceptable. Interactive descriptors never accept package-supplied permission buttons or host-looking approval tokens. Review CSS and descriptor interaction together.

## 10. Mandatory adversarial test matrix

Each row must have an actual test path/result in the evidence ledger. At least the positive path and relevant denial path run through the public broker/service and real worker integration.

| Boundary | Cases | Required result |
| --- | --- | --- |
| Package parser | Unknown keys, path escape, duplicate names, oversized source/assets, malformed media, hidden code in theme | Reject before install/evaluation; no writes/effects |
| Grant catalog | Guessed internal ID, missing policy, new wildcard member, widened output projection, changed host policy | Unavailable/deny/re-review; no inherited authority |
| Identity | Guest names another package/store, forged writer, copied draft/file handle, sibling Worker request | Host principal wins; cross-authority access denied |
| Review | Deny, expired/replayed challenge, bytes changed after inspect, target revision changes during confirm | No effect; require fresh accurate review |
| Safe reads | No grant, narrower ID/field grant, metadata count/snippet/history leak | No unauthorized content or existence disclosure |
| Mutations | Preview without write, stale revision, invalid canonical output, escrow preservation, duplicate request | Zero preview writes; conflict/deny or one verified commit |
| Revoke/update | Queued call, pending prompt, late async completion, stale click, old epoch | Stop future admission; no late unauthorised commit |
| Interpreter | Loop, deep recursion, heap pressure, promise churn, unresolved request, repeated jobs | Bounded resources; host responsive; complete disposal |
| Ambient authority | Guest probes DOM, native globals, imports, network, tokens, host object handles | Absent/denied; no fallback execution |
| External effects | Off-origin redirect, private target, address rebinding, oversized response, cost cap, ambiguous retry | Deny/abort; no extra disclosure/spend |
| Events | Unauthorized payload, self recursion, event flood, host scene switch, revoke on delivery | Scoped frozen payload; bounded queue; correct cancellation |
| Turns/state | Branch fork, regenerate, Continue, failed Promptbook after phase, stale checkpoint, extension slot spoof | Existing core semantics; no stray deltas or duplicate journal |
| UI | Malicious text/descriptor, overlay attempt, permission imitation, keyboard/reduced motion | Host-owned safe UI; no consent token from package |
| Persistence | Lock, corruption, interrupted migration, competing control revision, restore | Fail closed; recoverable durable authority; no lost edits |
| Host parity | Missing worker/WASM, offline, Pages base path, WebView2, compiled terminal | Proven supported path or explicit unavailable; never downgrade |

Avoid low-value tests that mirror every descriptor constant. Test the generator once per rule with fixture operations, then test actual security-sensitive effects. Keep assertions at public boundaries and prove denial means no effect.

## 11. Scope boundaries and stop conditions

Allowed implementation areas: existing owners in section 3; proposed owners in section 4; their direct host/bootstrap adapters, tests and build/CI integration; corresponding docs/generators. Read a direct caller before editing it. Do not expand into unrelated Library redesign, landing-page styling, provider feature work, a marketplace, rewriting all Kit tools, replacing the database, a new roleplay engine or a new UI framework.

STOP the affected work package and record a precise blocker if:

1. The missing historical runtime spec is recovered and contradicts a load-bearing design here; reconcile owner decisions first.
2. Supporting an operation appears to require exposing native host objects, credentials, raw DOM, unchecked HTML or unrestricted network/process authority.
3. QuickJS memory/worker limits cannot be demonstrated in the chosen variant or advertised artifact.
4. A runtime or store binding cannot reliably distinguish one installed package/store/invocation from another.
5. Cross-process ownership cannot be fenced; do not silently support simultaneous desktop/CLI writes.
6. A staged migration cannot preserve current theme packages/grants/data through interruption and restore.
7. Existing tests fail after two focused reasonable attempts, or a fix would weaken assertions/security gates. Record reproduction and request review rather than hiding the test.
8. A required domain operation has no valid canonical/persistence owner. Design and test that owner first; do not call an internal server route as a shortcut.
9. The plan appears to need a new dependency, paid infrastructure or external service beyond the reviewed interpreter binding. Justify the need and obtain missing authorization before committing the cost.
10. A reviewer finds a boundary defect. Fix and rerun affected gates; do not label self-review independent approval.

Blocking one host-specific operation does not prevent pure package/catalog work, but it prevents a claim that the blocked operation/host is ready. Do not mark the whole plan DONE while mandatory work or support claims remain unresolved.

## 12. Verification commands and their role

Existing at planning time: `bun run typecheck`, `bun test <paths>`, `bun run capabilities:check`, `bun run slots:check`, `bun run probe:sqlite`, `bun run license:audit`, `bun run scan:boundaries`, `bun run lint:ui`, `bun run verify:ci`, `bun run build:pages`, `bun run scripts/build-desktop.ts --cli-targets=bun-windows-x64`, docs checks above.

Proposed commands to add and then use: `extensions:catalog`, `extensions:catalog:check`, `extensions:sdk`, `extensions:sdk:check`, `extensions:check`, `extensions:pack`. Document arguments with `--help`; input and output paths must be explicit. Do not claim a proposed command was run before implementation.

During iteration run focused tests at the owning boundary, adjacent regression suites after a caller switch, and full wall at integration/release gates. Do not run the entire suite after every small documentation edit. Do not skip the final supported checks for a security runtime. Green CI applies only to the exact checked branch/artifact.

## 13. Execution ledger and handoff format

Maintain `plans/extension-runtime-evidence/README.md` with one row per WP:

| WP | Status | Source SHA | Files changed | Tests/commands | Live/artifact proof | Review | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0-15 | TODO / IN PROGRESS / IMPLEMENTED / UNIT-PROVEN / LIVE-PROVEN / ARTIFACT-PROVEN / BLOCKED | Exact revision | Scoped list | Actual counts/exit codes and log path | Host/hash/result | Reviewer and findings | Explicit |

After each work package, hand the next executor these facts in plain text:

1. Which WP completed and its exact source revision.
2. Authoritative owners and APIs now present.
3. Commands actually run and failures/warnings/skips.
4. Files already changed by another task that must be preserved.
5. Next WP, dependencies, and any amended contract.

No executor should need the original conversation. This document plus the repo and ledger is the handoff. If context is tight, finish a verified substep and record a concrete next action; do not start a parallel replacement implementation.

## 14. Machine-checkable final done criteria

- [ ] New package installs, denies optional grants, runs and updates through one service on a throwaway store.
- [ ] Existing valid theme packages migrate without losing enabled/revoked state, settings or assets; old state is no longer an active writer.
- [ ] One source-discovered catalog generates SDK, permission UI metadata and docs; dev/compiled/browser inventories agree.
- [ ] No exposed operation lacks strict schemas, source-owned policy, resource checks, output projection, tests and host availability metadata.
- [ ] No missing grant can be bypassed by Kit mode, low-level SDK call, nested tool, UI event, guessed ID or a changed package.
- [ ] QuickJS executes only inside the bounded worker wrapper; missing isolation fails closed.
- [ ] Revoke/disable/update/lock/close invalidate running authority and prevent not-yet-admitted effects; already-admitted external effects are reported accurately.
- [ ] Canonical content changes and ChatStore state use their existing revision/validation doors; no competing content or chat journal exists.
- [ ] All declared developer-preview API operations have working handlers; unavailable proposed operations/hosts are explicitly documented and not falsely advertised.
- [ ] Templates/examples build against public SDK and work when followed from docs by a fresh executor.
- [ ] Protected UI, supported themes, keyboard/narrow layout and reduced motion have live evidence.
- [ ] Hostile boundary tests, catalog/SDK drift checks, adjacent suites and `verify:ci` pass on the delivery revision.
- [ ] Supported packaged artifacts and Browser Studio are actually exercised offline/online as applicable, with hashes and source identity recorded.
- [ ] Independent security/migration/release review findings are resolved or explicitly block release.
- [ ] No unrelated working-tree files were changed or staged; no real library/provider credentials were used in tests.
- [ ] Docs/summaries describe verified behavior and limits. `plans/README.md` and evidence ledger reflect actual completion.

## 15. Maintenance rules after this lands

Adding a capability or host feature must include extension exposure review at its owning descriptor. Absence remains unavailable. A policy/projection/resource change is compatibility-sensitive even if the operation name and TypeScript signature stay identical. Add tests and update fingerprints deliberately.

New hosts implement narrow adapters and run the same contract suite. They cannot declare broad features available simply because similarly named browser APIs exist. A guest SDK convenience method cannot acquire a second dispatch path. Themes remain data contributions; Lua/regex remain sealed until explicit invocation; executable JS remains interpreted, never imported into the host realm.

Keep real boundary tests, generation checks and evidence maintenance in required CI. Revisit budgets using measured low-end artifacts, not to satisfy a heavy extension by default. The compatibility promise is the versioned operation/policy contract and persisted data schema, not today's internal folder arrangement.
