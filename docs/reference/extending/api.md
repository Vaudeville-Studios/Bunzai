# Generated extension API catalog

Generated from `src/extensions/operations/`. Descriptors are the source of truth.

The table lists host-level adapters. rp-core remains the owner of linked-scene turns, so those turns do not run extension prompt or scene-event hooks and Desktop/Terminal local prompt previews are unavailable for linked scenes.

* Legacy scenes only; Core-linked scene targets are refused.

| Operation | Name | Effect | Hosts | Budget | Confirmation |
| --- | --- | --- | --- | --- | --- |
| `api.describe` | Describe available operations | read | desktop, browser, terminal | metadata | none |
| `api.search` | Search the operation catalog | read | desktop, browser, terminal | metadata | none |
| `assets.attach.apply` | Apply portrait attachment | write | desktop, browser, terminal | write | none |
| `assets.attach.preview` | Preview portrait attachment | read | desktop, browser, terminal | read-large | none |
| `assets.import.apply` | Apply portrait import | write | desktop, browser, terminal | write | none |
| `assets.import.preview` | Preview portrait import | read | desktop, browser, terminal | read-large | none |
| `assets.list` | List media assets | read | desktop, browser, terminal | read-small | none |
| `assets.read` | Read a media asset | read | desktop, browser, terminal | read-large | none |
| `clipboard.read` | Read clipboard text | external | desktop | external | sensitive-send |
| `clipboard.write` | Write clipboard text | external | desktop | external | sensitive-send |
| `collections.create` | Create a collection | write | desktop, browser, terminal | write | effect |
| `collections.list` | Read collections | read | desktop, browser, terminal | read-large | none |
| `collections.membership.apply` | Apply collection membership | write | desktop, browser, terminal | write | effect |
| `collections.membership.preview` | Preview collection membership | read | desktop, browser, terminal | read-small | none |
| `collections.read` | Read one collection | read | desktop, browser, terminal | read-small | none |
| `commands.register` | Choose available commands | write | desktop, browser, terminal | write | effect |
| `composer.draft.set` | Replace a scene draft | control | desktop, browser | metadata | none |
| `content.create.preview` | Preview content creation | read | desktop, browser, terminal | read-large | none |
| `content.draft.apply` | Apply a content draft | write | desktop, browser, terminal | write | effect |
| `content.draft.character.greetings.update` | Preview Change the first message or replace authored alternate and group-only greeting lists. | read | desktop, browser, terminal | read-large | none |
| `content.draft.character.identity.update` | Preview Change a character's portable name, nickname, tagline, or casting-card identity facts. | read | desktop, browser, terminal | read-large | none |
| `content.draft.character.media.update` | Preview Change the canonical portrait, media asset references, visual mode, or preferred face. | read | desktop, browser, terminal | read-large | none |
| `content.draft.character.metadata.update` | Preview Change portable discovery tags, rating, content warnings, creator, license, or notes. | read | desktop, browser, terminal | read-large | none |
| `content.draft.character.prompts.update` | Preview Change portable character description, persona, scenario, system instructions, or examples. | read | desktop, browser, terminal | read-large | none |
| `content.draft.character.variants.manage` | Preview Add, remove, rename, configure, or restore inheritance for a character variant. | read | desktop, browser, terminal | read-large | none |
| `content.draft.discard` | Discard content draft | read | desktop, browser, terminal | read-small | none |
| `content.draft.inspect` | Inspect content draft | read | desktop, browser, terminal | read-small | none |
| `content.draft.lorebook.entries.enable` | Preview Enable or disable one or more lorebook entries as one change. | read | desktop, browser, terminal | read-large | none |
| `content.draft.lorebook.entries.remove` | Preview Remove one or more lorebook entries from a draft, with exact affected ids in the preview. | read | desktop, browser, terminal | read-large | none |
| `content.draft.lorebook.entries.reorder` | Preview Move one lorebook entry to a specific position in the authored entry order. | read | desktop, browser, terminal | read-large | none |
| `content.draft.lorebook.entries.update` | Preview Change the title, content, note, enabled state, or constant state of one lorebook entry. | read | desktop, browser, terminal | read-large | none |
| `content.draft.lorebook.settings.update` | Preview Change portable lorebook settings such as its name, matching defaults, or budget. | read | desktop, browser, terminal | read-large | none |
| `content.draft.pack.groups.manage` | Preview Add, rename, or remove a named multi-character media-pack group. | read | desktop, browser, terminal | read-large | none |
| `content.draft.pack.items.manage` | Preview Add, edit, remove, or reorder typed media items in the default or a named pack group. | read | desktop, browser, terminal | read-large | none |
| `content.draft.persona.identity.update` | Preview Change a persona's name, shelf-only brief, or injected first-person identity text. | read | desktop, browser, terminal | read-large | none |
| `content.draft.persona.profile.update` | Preview Change structured persona sections, traits, ordering, pronouns, or casting facts. | read | desktop, browser, terminal | read-large | none |
| `content.draft.preset.blocks.manage` | Preview Add, edit, remove, enable, reorder, or group typed preset prompt blocks. | read | desktop, browser, terminal | read-large | none |
| `content.draft.preset.groups.manage` | Preview Add, edit, or remove preset categories while cleaning block and child references. | read | desktop, browser, terminal | read-large | none |
| `content.draft.preset.settings.update` | Preview Change preset name, description, enabled state, or authored sampler values. | read | desktop, browser, terminal | read-large | none |
| `content.draft.promptbook.phase-preset.update` | Preview Replace one Promptbook phase block's authored text without running it. | read | desktop, browser, terminal | read-large | none |
| `content.draft.promptformat.templates.update` | Preview Edit stored text-completion template fields as inert canonical data. | read | desktop, browser, terminal | read-large | none |
| `content.draft.regex.rules.manage` | Preview Add, edit, remove, or reorder stored standalone regex rules without executing them. | read | desktop, browser, terminal | read-large | none |
| `content.draft.scriptsheet.instruction.update` | Preview Replace one Script Sheet instruction as inert authored text. | read | desktop, browser, terminal | read-large | none |
| `content.draft.skill.instruction.update` | Preview Edit a Skill's name, description, or inert authored instructions. | read | desktop, browser, terminal | read-large | none |
| `content.draft.tool.definition.update` | Preview Replace one validated tool definition as inert data. | read | desktop, browser, terminal | read-large | none |
| `content.duplicate.preview` | Preview content duplication | read | desktop, browser, terminal | read-large | none |
| `content.fields.read` | Read reviewed content fields | read | desktop, browser, terminal | read-large | none |
| `content.history.list` | List content history | read | desktop, browser, terminal | read-small | none |
| `content.history.read` | Read historical fields | read | desktop, browser, terminal | read-small | none |
| `content.kinds` | List content kinds | read | desktop, browser, terminal | metadata | none |
| `content.links.read` | Read character links | read | desktop, browser, terminal | read-small | none |
| `content.list` | List content summaries | read | desktop, browser, terminal | read-small | none |
| `content.read` | Read canonical piece body | read | desktop, browser, terminal | read-large | none |
| `content.restore` | Restore content from Trash | write | desktop, browser, terminal | write | effect |
| `content.search` | Search content summaries | read | desktop, browser, terminal | read-small | none |
| `content.summary` | Read a content summary | read | desktop, browser, terminal | read-small | none |
| `content.tokens.estimate` | Estimate text tokens | read | desktop, browser, terminal | read-large | none |
| `content.trash` | Move content to Trash | write | desktop, browser, terminal | write | effect |
| `content.validate` | Validate canonical content | read | desktop, browser, terminal | read-large | none |
| `diagnostics.runtime` | Runtime status | read | desktop, browser, terminal | metadata | none |
| `events.subscribe` | Subscribe to a scene event | write | desktop, browser, terminal | write | effect |
| `events.unsubscribe` | Unsubscribe from a scene event | write | desktop, browser, terminal | write | effect |
| `export.preview` | Preview one content export | read | desktop, terminal | read-large | none |
| `export.write` | Write a reviewed export | write | desktop, terminal | write | none |
| `files.pick` | Choose a file | read | desktop, terminal | read-small | none |
| `files.read` | Read a chosen file | read | desktop, terminal | read-large | none |
| `files.write.apply` | Write a chosen file | write | desktop, terminal | write | effect |
| `files.write.preview` | Preview file contents | read | desktop, terminal | read-large | none |
| `formats.describe` | Describe a format | read | desktop, terminal | metadata | none |
| `formats.list` | List available formats | read | desktop, terminal | metadata | none |
| `host.features` | Host availability | read | desktop, browser, terminal | metadata | none |
| `import.apply` | Apply an imported piece | write | desktop, terminal | write | effect |
| `import.preview` | Preview one content import | read | desktop, terminal | read-large | none |
| `links.open` | Open a link | external | desktop | external | sensitive-send |
| `logs.readOwn` | Read own operational logs | read | desktop, browser, terminal | metadata | none |
| `logs.write` | Write an operational log | control | desktop, browser, terminal | metadata | none |
| `macros.describe` | Describe built-in macros | read | desktop, browser, terminal | metadata | none |
| `macros.preview` | Preview supplied macro text | control | desktop, browser, terminal | metadata | effect |
| `messages.delete` | Delete message | write | desktop*, browser, terminal* | write | effect |
| `messages.edit.apply` | Apply message edit | write | desktop*, browser, terminal* | write | effect |
| `messages.edit.preview` | Preview message edit | read | desktop, browser, terminal | read-small | none |
| `messages.list` | List messages | read | desktop, browser, terminal | read-small | none |
| `messages.read` | Read a message | read | desktop, browser, terminal | read-small | none |
| `messages.send` | Add a message | write | desktop*, browser, terminal* | write | effect |
| `messages.versions.list` | List message versions | read | desktop, browser, terminal | read-small | none |
| `models.cancel` | Cancel model generation | control | desktop, terminal | metadata | none |
| `models.describe` | Describe a model connection | read | desktop, terminal | read-small | none |
| `models.generate` | Generate with a saved model | external | desktop, terminal | external | sensitive-send |
| `models.list` | List models | read | desktop, terminal | read-small | none |
| `models.usage` | Read model usage | read | desktop, terminal | metadata | none |
| `network.request` | Send an HTTPS request | external | desktop, terminal | external | sensitive-send |
| `operations.receipts.list` | List own effect receipts | read | desktop, browser, terminal | metadata | none |
| `operations.status` | Operation availability | read | desktop, browser, terminal | metadata | none |
| `permissions.status` | Current permissions | read | desktop, browser, terminal | metadata | none |
| `playback.pause` | Pause playback | control | desktop | metadata | none |
| `playback.play` | Play a local audio asset | control | desktop | metadata | none |
| `playback.status` | Read local playback status | read | desktop | metadata | none |
| `playback.stop` | Stop playback | control | desktop | metadata | none |
| `prompts.contribute` | Contribute to a named prompt stage | control | desktop, browser, terminal | metadata | none |
| `prompts.inspect` | Inspect the active prompt | read | desktop, browser, terminal | read-large | none |
| `prompts.transform` | Transform this hook's prompt candidate | control | desktop, browser, terminal | metadata | none |
| `regex.preview` | Preview regex rules | read | desktop, browser, terminal | read-small | none |
| `scenes.create` | Create scene | write | browser | write | effect |
| `scenes.list` | List scenes | read | desktop, browser, terminal | read-small | none |
| `scenes.read` | Read scene details | read | desktop, browser, terminal | read-small | none |
| `scenes.settings.apply` | Apply scene setting | write | desktop*, browser, terminal* | write | effect |
| `scenes.settings.preview` | Preview scene setting | read | desktop*, browser, terminal* | read-small | none |
| `scenes.summary` | Read a scene summary | read | desktop, browser, terminal | read-small | none |
| `settings.read` | Read extension settings | read | desktop, browser, terminal | read-small | none |
| `settings.update` | Update extension settings | write | desktop, browser, terminal | write | effect |
| `state.read` | Read own scene state | read | desktop, browser, terminal | read-small | none |
| `state.slots.describe` | Describe extension scene slots | read | desktop, browser, terminal | metadata | none |
| `state.write.apply` | Apply scene state write | write | desktop*, browser, terminal* | write | effect |
| `state.write.preview` | Preview scene state write | read | desktop, browser, terminal | read-small | none |
| `storage.delete` | Delete stored data | write | desktop, browser, terminal | write | effect |
| `storage.get` | Read stored data | read | desktop, browser, terminal | read-small | none |
| `storage.list` | List stored data keys | read | desktop, browser, terminal | read-small | none |
| `storage.set` | Store a value | write | desktop, browser, terminal | write | effect |
| `takes.fork` | Fork a take | write | desktop*, browser, terminal* | write | effect |
| `takes.list` | List takes | read | desktop, browser, terminal | read-small | none |
| `takes.read` | Read a take | read | desktop, browser, terminal | read-small | none |
| `tools.describe` | Describe a reviewed Kit tool | read | desktop, terminal | read-large | none |
| `tools.invoke` | Invoke a reviewed Kit tool | read | desktop, terminal | read-large | none |
| `tools.list` | List reviewed Kit tools | read | desktop, terminal | read-large | none |
| `transfer.preview` | Preview a format transfer | read | desktop, terminal | read-large | none |
| `turns.cancel` | Cancel own scene turn | control | desktop*, terminal* | metadata | none |
| `turns.continue` | Continue scene reply | external | desktop*, terminal* | external | sensitive-send |
| `turns.regenerate` | Regenerate scene reply | external | desktop*, terminal* | external | sensitive-send |
| `turns.start` | Start scene reply | external | desktop*, terminal* | external | sensitive-send |
| `turns.status` | Read own scene turn status | read | desktop*, terminal* | metadata | none |
| `ui.dialog.request` | Request an extension dialog | control | desktop, browser | metadata | none |
| `ui.editor.open` | Open an editor | control | desktop, browser | metadata | none |
| `ui.notice.show` | Show an extension notice | control | desktop, browser | metadata | none |
| `ui.panel.remove` | Remove an extension panel | control | desktop, browser | metadata | none |
| `ui.panel.set` | Update an extension panel | control | desktop, browser | metadata | none |
| `ui.scene.open` | Open a scene | control | desktop, browser | metadata | none |
| `ui.status.set` | Set extension status | control | desktop, browser | metadata | none |
