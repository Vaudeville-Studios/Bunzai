# WP1 required delivery coverage

Status: required scope frozen from the owner-authorized Plan 001; implementation and host proofs are pending.

This is an acceptance record, not an executable registry. Source descriptors remain the only executable authority. No operation may become optional merely because it is not implemented yet. Any narrowing requires a recorded owner-approved plan amendment.

## Required families and operations

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

## Required host defaults

- Desktop: every row above, after its boundary and packaged proof gates.
- Browser Studio: catalog, content, collections, drafts, scene reads/state/prompt events, media assets, inert appearance, host-drawn UI, own storage and deterministic diagnostics, with volatile storage disclosed. General network/models/tools/native files/clipboard/playback and host turn-control are explicitly unavailable until equivalent adapters are proven.
- Terminal: nonvisual operations only after the QuickJS worker and fenced owner gates. UI/media playback/clipboard are explicitly unavailable. **Owner-approved amendment (2026-10-31):** `files.pick` is available through the trusted focused TUI path prompt. The host, not the guest, receives the typed path and creates the opaque file handle. The actual Terminal app-to-QuickJS integration, runtime owner, prompt, and handle registry proofs are `src/kit/render/app-terminal-files.integration.test.tsx`, `src/kit/extensions/owner.test.ts`, `src/kit/render/primitives/safety/extension-file-prompt.test.tsx`, and `src/kit/extensions/file-actions.test.ts`. File read/write remain separately granted and use the existing snapshot/fence checks.

The executor must expand semantic operation families from the reviewed capability folders, attach each exact operation to its source owner, implementation WP and boundary test, and check required coverage against actual handlers and host availability. A callable placeholder is not implemented coverage.

## Current evidence

- Central contracts, broker and catalog are in progress.
- No complete API-family or host matrix is yet proven.
- Source/compiled/browser parity, packaged UI flows and migration/recovery remain release gates.
