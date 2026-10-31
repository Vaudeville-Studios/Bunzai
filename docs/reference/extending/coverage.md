# Generated extension coverage

Generated from source drop-ins. Absence from the operation catalog means unavailable.

## Semantic capability inventory

- Discovered capabilities: 39
- Explicitly marked for extension review: 24
- Semantic capability adapters: 24
- Strict operation descriptors: 137

| Capability | Operation | Status |
| --- | --- | --- |
| `character.greetings.update` | `content.draft.character.greetings.update` | available |
| `character.identity.update` | `content.draft.character.identity.update` | available |
| `character.media.update` | `content.draft.character.media.update` | available |
| `character.metadata.update` | `content.draft.character.metadata.update` | available |
| `character.prompts.update` | `content.draft.character.prompts.update` | available |
| `character.variants.manage` | `content.draft.character.variants.manage` | available |
| `lorebook.entries.enable` | `content.draft.lorebook.entries.enable` | available |
| `lorebook.entries.remove` | `content.draft.lorebook.entries.remove` | available |
| `lorebook.entries.reorder` | `content.draft.lorebook.entries.reorder` | available |
| `lorebook.entries.update` | `content.draft.lorebook.entries.update` | available |
| `lorebook.settings.update` | `content.draft.lorebook.settings.update` | available |
| `pack.groups.manage` | `content.draft.pack.groups.manage` | available |
| `pack.items.manage` | `content.draft.pack.items.manage` | available |
| `persona.identity.update` | `content.draft.persona.identity.update` | available |
| `persona.profile.update` | `content.draft.persona.profile.update` | available |
| `preset.blocks.manage` | `content.draft.preset.blocks.manage` | available |
| `preset.groups.manage` | `content.draft.preset.groups.manage` | available |
| `preset.settings.update` | `content.draft.preset.settings.update` | available |
| `promptbook.phase-preset.update` | `content.draft.promptbook.phase-preset.update` | available |
| `promptformat.templates.update` | `content.draft.promptformat.templates.update` | available |
| `regex.rules.manage` | `content.draft.regex.rules.manage` | available |
| `scriptsheet.instruction.update` | `content.draft.scriptsheet.instruction.update` | available |
| `skill.instruction.update` | `content.draft.skill.instruction.update` | available |
| `tool.definition.update` | `content.draft.tool.definition.update` | available |

## Strict content field groups

Each group requires an explicit grant. The full body can include authored prompts and sealed script data; it excludes escrow, notes and platform profiles. Detail groups are narrower.

| Kind | Group | Status | Hosts |
| --- | --- | --- | --- |
| character | `body` | available | desktop, browser, terminal |
| lorebook | `body` | available | desktop, browser, terminal |
| persona | `body` | available | desktop, browser, terminal |
| pack | `body` | available | desktop, browser, terminal |
| preset | `body` | available | desktop, browser, terminal |
| scriptsheet | `body` | available | desktop, browser, terminal |
| promptbook | `body` | available | desktop, browser, terminal |
| regex | `body` | available | desktop, browser, terminal |
| quickreply | `body` | available | desktop, browser, terminal |
| tool | `body` | available | desktop, browser, terminal |
| dice | `body` | available | desktop, browser, terminal |
| formula | `body` | available | desktop, browser, terminal |
| tracker | `body` | available | desktop, browser, terminal |
| skill | `body` | available | desktop, browser, terminal |
| promptformat | `body` | available | desktop, browser, terminal |
| agent | `body` | available | desktop, browser, terminal |
| htmldoc | `body` | available | desktop, browser, terminal |
| character | `character.identity` | available | desktop, browser, terminal |
| character | `character.links` | available | desktop, browser, terminal |
| character | `character.identity (historical versions)` | available | desktop, browser, terminal |
| persona | `persona.identity` | available | desktop, browser, terminal |

## Host operation inventory

| Operation | Status | Hosts |
| --- | --- | --- |
| `api.describe` | available | desktop, browser, terminal |
| `api.search` | available | desktop, browser, terminal |
| `assets.attach.apply` | available | desktop, browser, terminal |
| `assets.attach.preview` | available | desktop, browser, terminal |
| `assets.import.apply` | available | desktop, browser, terminal |
| `assets.import.preview` | available | desktop, browser, terminal |
| `assets.list` | available | desktop, browser, terminal |
| `assets.read` | available | desktop, browser, terminal |
| `clipboard.read` | available | desktop |
| `clipboard.write` | available | desktop |
| `collections.create` | available | desktop, browser, terminal |
| `collections.list` | available | desktop, browser, terminal |
| `collections.membership.apply` | available | desktop, browser, terminal |
| `collections.membership.preview` | available | desktop, browser, terminal |
| `collections.read` | available | desktop, browser, terminal |
| `commands.register` | available | desktop, browser, terminal |
| `composer.draft.set` | available | desktop, browser |
| `content.create.preview` | available | desktop, browser, terminal |
| `content.draft.apply` | available | desktop, browser, terminal |
| `content.draft.character.greetings.update` | available | desktop, browser, terminal |
| `content.draft.character.identity.update` | available | desktop, browser, terminal |
| `content.draft.character.media.update` | available | desktop, browser, terminal |
| `content.draft.character.metadata.update` | available | desktop, browser, terminal |
| `content.draft.character.prompts.update` | available | desktop, browser, terminal |
| `content.draft.character.variants.manage` | available | desktop, browser, terminal |
| `content.draft.discard` | available | desktop, browser, terminal |
| `content.draft.inspect` | available | desktop, browser, terminal |
| `content.draft.lorebook.entries.enable` | available | desktop, browser, terminal |
| `content.draft.lorebook.entries.remove` | available | desktop, browser, terminal |
| `content.draft.lorebook.entries.reorder` | available | desktop, browser, terminal |
| `content.draft.lorebook.entries.update` | available | desktop, browser, terminal |
| `content.draft.lorebook.settings.update` | available | desktop, browser, terminal |
| `content.draft.pack.groups.manage` | available | desktop, browser, terminal |
| `content.draft.pack.items.manage` | available | desktop, browser, terminal |
| `content.draft.persona.identity.update` | available | desktop, browser, terminal |
| `content.draft.persona.profile.update` | available | desktop, browser, terminal |
| `content.draft.preset.blocks.manage` | available | desktop, browser, terminal |
| `content.draft.preset.groups.manage` | available | desktop, browser, terminal |
| `content.draft.preset.settings.update` | available | desktop, browser, terminal |
| `content.draft.promptbook.phase-preset.update` | available | desktop, browser, terminal |
| `content.draft.promptformat.templates.update` | available | desktop, browser, terminal |
| `content.draft.regex.rules.manage` | available | desktop, browser, terminal |
| `content.draft.scriptsheet.instruction.update` | available | desktop, browser, terminal |
| `content.draft.skill.instruction.update` | available | desktop, browser, terminal |
| `content.draft.tool.definition.update` | available | desktop, browser, terminal |
| `content.duplicate.preview` | available | desktop, browser, terminal |
| `content.fields.read` | available | desktop, browser, terminal |
| `content.history.list` | available | desktop, browser, terminal |
| `content.history.read` | available | desktop, browser, terminal |
| `content.kinds` | available | desktop, browser, terminal |
| `content.links.read` | available | desktop, browser, terminal |
| `content.list` | available | desktop, browser, terminal |
| `content.read` | available | desktop, browser, terminal |
| `content.restore` | available | desktop, browser, terminal |
| `content.search` | available | desktop, browser, terminal |
| `content.summary` | available | desktop, browser, terminal |
| `content.tokens.estimate` | available | desktop, browser, terminal |
| `content.trash` | available | desktop, browser, terminal |
| `content.validate` | available | desktop, browser, terminal |
| `diagnostics.runtime` | available | desktop, browser, terminal |
| `events.subscribe` | available | desktop, browser, terminal |
| `events.unsubscribe` | available | desktop, browser, terminal |
| `export.preview` | available | desktop, terminal |
| `export.write` | available | desktop, terminal |
| `files.pick` | available | desktop, terminal |
| `files.read` | available | desktop, terminal |
| `files.write.apply` | available | desktop, terminal |
| `files.write.preview` | available | desktop, terminal |
| `formats.describe` | available | desktop, terminal |
| `formats.list` | available | desktop, terminal |
| `host.features` | available | desktop, browser, terminal |
| `import.apply` | available | desktop, terminal |
| `import.preview` | available | desktop, terminal |
| `links.open` | available | desktop |
| `logs.readOwn` | available | desktop, browser, terminal |
| `logs.write` | available | desktop, browser, terminal |
| `macros.describe` | available | desktop, browser, terminal |
| `macros.preview` | available | desktop, browser, terminal |
| `messages.delete` | available | desktop, browser, terminal |
| `messages.edit.apply` | available | desktop, browser, terminal |
| `messages.edit.preview` | available | desktop, browser, terminal |
| `messages.list` | available | desktop, browser, terminal |
| `messages.read` | available | desktop, browser, terminal |
| `messages.send` | available | desktop, browser, terminal |
| `messages.versions.list` | available | desktop, browser, terminal |
| `models.cancel` | available | desktop, terminal |
| `models.describe` | available | desktop, terminal |
| `models.generate` | available | desktop, terminal |
| `models.list` | available | desktop, terminal |
| `models.usage` | available | desktop, terminal |
| `network.request` | available | desktop, terminal |
| `operations.receipts.list` | available | desktop, browser, terminal |
| `operations.status` | available | desktop, browser, terminal |
| `permissions.status` | available | desktop, browser, terminal |
| `playback.pause` | available | desktop |
| `playback.play` | available | desktop |
| `playback.status` | available | desktop |
| `playback.stop` | available | desktop |
| `prompts.contribute` | available | desktop, browser, terminal |
| `prompts.inspect` | available | desktop, browser, terminal |
| `prompts.transform` | available | desktop, browser, terminal |
| `regex.preview` | available | desktop, browser, terminal |
| `scenes.create` | available | desktop, browser, terminal |
| `scenes.list` | available | desktop, browser, terminal |
| `scenes.read` | available | desktop, browser, terminal |
| `scenes.settings.apply` | available | desktop, browser, terminal |
| `scenes.settings.preview` | available | desktop, browser, terminal |
| `scenes.summary` | available | desktop, browser, terminal |
| `settings.read` | available | desktop, browser, terminal |
| `settings.update` | available | desktop, browser, terminal |
| `state.read` | available | desktop, browser, terminal |
| `state.slots.describe` | available | desktop, browser, terminal |
| `state.write.apply` | available | desktop, browser, terminal |
| `state.write.preview` | available | desktop, browser, terminal |
| `storage.delete` | available | desktop, browser, terminal |
| `storage.get` | available | desktop, browser, terminal |
| `storage.list` | available | desktop, browser, terminal |
| `storage.set` | available | desktop, browser, terminal |
| `takes.fork` | available | desktop, browser, terminal |
| `takes.list` | available | desktop, browser, terminal |
| `takes.read` | available | desktop, browser, terminal |
| `tools.describe` | available | desktop, terminal |
| `tools.invoke` | available | desktop, terminal |
| `tools.list` | available | desktop, terminal |
| `transfer.preview` | available | desktop, terminal |
| `turns.cancel` | available | desktop, terminal |
| `turns.continue` | available | desktop, terminal |
| `turns.regenerate` | available | desktop, terminal |
| `turns.start` | available | desktop, terminal |
| `turns.status` | available | desktop, terminal |
| `ui.dialog.request` | available | desktop, browser |
| `ui.editor.open` | available | desktop, browser |
| `ui.notice.show` | available | desktop, browser |
| `ui.panel.remove` | available | desktop, browser |
| `ui.panel.set` | available | desktop, browser |
| `ui.scene.open` | available | desktop, browser |
| `ui.status.set` | available | desktop, browser |

## Host totals

| Host | Available operations |
| --- | ---: |
| desktop | 137 |
| browser | 105 |
| terminal | 122 |
