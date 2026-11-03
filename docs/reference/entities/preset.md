---
id: reference/entities/preset
title: Preset entity
audience: dev
summary: The canonical superset entity for a chat-completion prompt-manager preset: every PresetBody field, its type, the formats that produce it, and its meaning.
tags: [entity, preset, canonical, fields]
related: [reference/architecture]
---

# Preset entity

A `CanonicalPreset` is `CanonicalEntity<"preset", PresetBody>`: the stable canonical wrapper (see
[architecture.md](../architecture.md)) around a `PresetBody`, a named, ordered collection of prompt
blocks plus its sampler and behavior settings. It models one member of the SillyTavern "preset" family,
the chat-completion prompt-manager preset (prompt blocks, ordering, samplers, settings groups): the shape
RoleCall, Marinara, and Lumiverse's preset dialects all center on. `src/entities/preset/schema.ts` is the
source of truth for the types; this page is the source of truth for what each field MEANS and which
formats produce it.

ST's other preset subtypes land here when Bunzai can use them. KoboldAI, TextGen and NovelAI sampler sets land on
`samplers` (flagged `samplerSet`, so the Library calls them sampler sets), a system prompt template lands as the
`main` block, and a reasoning template lands as `reasoning` (the markers a scene hides from the transcript). Each
is seeded with ST's stock prompt order so choosing it in a scene still sends the card. Instruct and context
templates are a separate kind, the [prompt format](promptformat.md) piece, because they configure a
text-completion formatter that Bunzai does not have yet. See [formats/sillytavern.md](../formats/sillytavern.md),
"Quirks".

`PresetAdapter` is a member of the `FormatAdapter` union in `src/core/adapter.ts` (see
[architecture.md](../architecture.md), "The canonical entity"), and four adapters read and write a
`CanonicalPreset`: SillyTavern, RoleCall, Marinara, and Lumiverse, each registered in its own format
folder's codec list. The `bunzai` CLI has no dedicated preset subcommand; presets travel through the
generic `inspect` and `convert` commands like any other kind. The Library and Workbench also author a
`PresetBody` directly (`createAndOpenPreset`, `PresetEditorView`). The Producers column below names the
wire format each field was verified against, which is what the shape models.

A block is DATA. The current build engine in `core/preset` (the Workbench's LiveBuild pane) is a preview
only, and honest about the gap: it orders enabled blocks by placement rank and `injectionOrder`, labels
where a marker splices at runtime, and counts tokens by a chars/4 convention. It does not resolve macros,
which stay literal until a real chat runtime resolves them, and it does not apply `groups` or `choices`:
groups are authoring structure, not build order, and choices gate blocks only once answered at a run
surface that does not exist yet. Nothing in the converter or the preview calls `eval`.

## How to read the field tables

The field tables on this page are generated from the schema by `scripts/docs-fields.ts` and embedded
verbatim. Do not hand-edit a cell: improve the schema doc comment and regenerate, and the docs follow.

- **Field** is the canonical name. A trailing `?` marks an optional field.
- **Type** is the TypeScript type in the schema.
- **Producers** are the source formats named in the field's schema doc comment. A `-` means the doc
  comment names no specific producer. Many such fields are the universal core every format carries
  (`name`, `content`, `role`, `enabled`, `placement`); others simply have their provenance described in
  prose rather than tagged inline.
- **Meaning** is what the field is for. A blank Meaning cell is a self-evident primitive named by its
  own field, and marks a field the schema doc comment did not annotate. Non-obvious fields carry their
  meaning from the schema doc comment. Any richer explanation lives in the prose around a table, never
  inside a cell.

## Prompt block attachments

The Preset editor and each Promptbook phase share the block attachment control. A block may keep
up to eight files: PNG, JPEG, GIF or WebP images, PDFs, and UTF-8 `.txt`, `.md`, `.csv` or `.json`
files. The editor shows their names, media types and sizes, with thumbnails for images. Files can
be removed, saved and reopened with the block. Structural markers and tool-result blocks cannot
carry attachments. Attachment-only blocks are retained; disabled blocks send no files.

`PresetPrompt.attachments` is an optional list of `{ name, ref }`. Names are display metadata,
never paths. The same contract is used by `BookPhase.preset`; there is no separate Promptbook
file store. This is an additive optional field under canonical schema version `1`, like the
existing optional link fields. Attachment-free records continue to decode without a migration.
The strict adjacent decoder rejects unsupported references and unknown attachment fields.

Files use the existing encrypted upload staging, session grants and canonical media slots. Native
Bunzai folder export and import carry their bytes, including attachments in profiles. Foreign
preset exports currently report attachment loss, including files on disabled blocks and profiles;
use native JSON to keep them. A filename, local path or URL does not cause the host to read or fetch
a file. PDFs are transmitted as documents without local OCR or AI extraction.

For an existing host-runtime scene, each file becomes an adjacent user-role companion immediately
after its owning block, in attachment order. The authored block keeps its own role. Text-file
contents are literal model input and do not run macros. The Inspector and forecast show file
metadata; text files contribute to the text estimate, while image and PDF token costs are marked
as excluded. The estimate therefore does not guarantee that a multimodal request fits.

Limits are eight attachments per block, 32 per request, 16 MiB of combined raw attachment bytes
per request and 2 MiB per text file. Images retain the shared 10 MiB image cap. The asset store's
32 MiB per-asset ceiling does not override the lower request limit. Provider/model limits can be
smaller. See [the provider boundary](../architecture.md) and
[untrusted files](../security/untrusted-content.md).

New RP-Core-linked scenes do not yet consume Bunzai's canonical Preset/Promptbook attachments.
Their send and preview paths explicitly refuse a selected setup containing enabled attachments
before calling a provider. The host-to-Core Preset/Promptbook bridge is separate work; saving a
file in the editor does not imply support in that runtime.

## Composition

`PresetBody` has two required fields, `name` and `prompts` (the ordered manuscript of blocks), plus
thirteen optional fields: two further collections (`groups`, `choices`), seven settings sub-objects
(`samplers`, `systemPrompts`, `templates`, `behavior`, `apiOptions`, `media`, `generation`), two
standalone scalars (`description`, `enabled`), and two link arrays (`behaviorRefs`, `quickReplyRefs`). Grouping keeps
related fields together and mirrors how a preset is authored, not how any one app stores it. The full
`PresetBody` table is in [Full composition](#full-composition) at the end.

@fig composition

The sections below walk each group. Every field table is pasted verbatim from
[docs/generated/fields.preset.md](../../generated/fields.preset.md).

## Prompt blocks and groups

A `PresetPrompt` is one row in the manuscript. One block maps 1:1 to an ST prompt, an RC prompt, or a
Marinara section. `id` is the VERBATIM source identifier, never a fresh vaud-minted id, because
prompt-order references, marker resolution, and `isDefault` all key off it; re-minting it would break
every round-trip, so this field is exempt from the UUID regeneration the other entities apply. `role`
(`PromptRole`) is one of `system`, `user`, `assistant`, or `tool`. The last carries a tool-result
message on platforms that support that standard role; adapters must preserve it or report the loss.

Two fields are easy to confuse: the per-block `systemPrompt` flag (ST `system_prompt`, renders this one
block as a system-role prompt-manager entry) is not the preset-level `systemPrompts` sub-object (the
always-on utility prompts, covered under "System prompts, templates, and behavior" below).

`placement` follows the position-picker law: the raw vocabulary (`PromptPlacement`) lives in the schema,
and per-platform legality lives in `core/preset/platform-fields.ts`, never a UI literal. The named stops
are `relative` (in preset order), `in_chat` (own message at depth), `append` (glue onto the message at
depth), `append_preset` (very bottom), and `prepend_preset` (very top); the type is an open union so a
platform-specific stop can still pass through unclaimed. When `marker` is true the block is a structural
placeholder with no content of its own, and `markerSlot` names which slot it fills, for example
`chatHistory` or `worldInfoBefore`. Bunzai's feature markers (`FEATURE_MARKER_SLOTS` in `core/preset/build.ts`:
`trackers`, `linkedTrackers`, `storyboards`, `skills`) put that feature's messages where the block stands, with the block's
role, before the guides are placed (`core/assembly/feature-slots.ts`); the block's own text is not sent, an `append`
marker becomes its own message at that depth (glued on, the feature would ride a history message the budget may
drop), and a second marker of the same slot sends nothing. A preset without one keeps the feature's own spot, so
today's request is unchanged until someone places a marker. SillyTavern stores no slot, so its import reads a feature
marker's slot from its id: a marker whose id is its slot survives a SillyTavern export and import, one with any other
id comes back as a plain marker.

`groupId` links a block to a `PresetGroup.id`; absent means the block is top-level or uncategorized.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | ST, Marinara | Stable block id = the VERBATIM source identifier (ST `identifier`, Marinara section `identifier`). NEVER a fresh vaud-minted id: prompt-order refs, marker resolution, and `isDefault` all key off it, and re-minting would break every round-trip. This field is EXEMPT from the UUID regeneration the other entities apply. |
| `name` | `string` | - |  |
| `content` | `string` | - |  |
| `attachments?` | `PresetAttachment[]` | - | Optional inert files sent beside this block when enabled. |
| `role` | `PromptRole` | - |  |
| `enabled` | `boolean` | - |  |
| `systemPrompt` | `boolean` | ST | ST `system_prompt`: rendered as a system-role prompt-manager entry. |
| `marker` | `boolean` | - | structural placeholder (chat history / world info / examples) with no content of its own. |
| `markerSlot?` | `string` | RC, ST | When `marker`, the slot identity: ST-compatible (chatHistory, worldInfoBefore, worldInfoAfter, dialogueExamples, personaDescription), RC's named marker slots, or a Bunzai feature marker (trackers, linkedTrackers, storyboards, skills: core/preset/build.ts FEATURE_MARKER_SLOTS). |
| `placement` | `PromptPlacement` | - |  |
| `injectionDepth` | `number` | ST | message depth for in_chat/append placements (0 = most recent; ST `injection_depth`, def 4). |
| `injectionOrder` | `number` | ST | relative-order weight; lower appears first (ST `injection_order`, default 100). |
| `forbidOverrides` | `boolean` | ST | ST `forbid_overrides`: a character may not override this prompt. |
| `injectionTrigger?` | `string[]` | - | generation types that trigger this injection ("normal", "continue", "impersonate", ...). |
| `isDefault?` | `boolean` | ST | true iff a built-in ST default identifier (not a user-authored prompt). |
| `groupId?` | `string` | - | id of the containing group (PresetGroup.id); absent = top-level / uncategorized. |
| `wrapInXml?` | `boolean` | Marinara | Marinara: wrap this block's content in an XML tag on build. |
| `xmlTagName?` | `string` | - |  |
| `extras?` | `Record<string, unknown>` | - | per-platform leftovers with no first-class home; sealed, round-trips untouched. |

### Groups

`PresetGroup` is a category or folder of blocks. It is canonical, not escrow, because Marinara `groups`
and RC categories are first-class and the editor authors them. ST has no real groups: it encodes them as
divider prompts, so the ST codec derives a divider identifier deterministically from a group's `id` for
vaud-authored groups, and escrows the original divider identifier only for a group that came from an
imported ST preset. That keeps the round-trip law intact under edits (add, rename, or move a group), not
just on import: a user-added group must never gain an escrow entry it never had.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | ST | stable canonical id; the ST codec derives its divider identifier from this deterministically. |
| `name` | `string` | - |  |
| `content?` | `string` | ST, Marinara | nemo-wiki dividers may carry content; legacy ST + Marinara groups do not. |
| `parentGroupId?` | `string` | RC, Marinara | parent group id for nesting (Marinara `parentGroupId` / RC subcategories); absent = top. |
| `order?` | `number` | - |  |
| `enabled?` | `boolean` | - |  |
| `extras?` | `Record<string, unknown>` | - |  |

## Sampler and generation settings

Sampler and context settings, plus the generation-shape knobs that ride alongside them (seed, completion
count). All fields on both shapes are optional: absent stays absent, because the round-trip law forbids
emitting a value the source never had. The build engine applies defaults at compile time; none are
stored on the entity. Field surfaces match presets-core's `SamplerSettings` and `GenerationSettings`.
`maxMessages` only applies when `contextMode` is `"messages"`; the window is bounded by `"tokens"` when
`contextMode` is absent. A scene honors both: in messages mode a turn sends the newest `maxMessages` (default 50)
prior messages plus the message it answers, and keeps the greeting. The scene's own override
(`ChatPresetSamplers`) wins over the library preset's value.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `temperature?` | `number` | - |  |
| `topP?` | `number` | - |  |
| `topK?` | `number` | - |  |
| `topA?` | `number` | - |  |
| `minP?` | `number` | - |  |
| `frequencyPenalty?` | `number` | - |  |
| `presencePenalty?` | `number` | - |  |
| `repetitionPenalty?` | `number` | - |  |
| `maxContext?` | `number` | - |  |
| `maxTokens?` | `number` | - |  |
| `promptPostProcessing?` | `"none" \| "merge" \| "semi" \| "strict" \| "single"` | - |  |
| `contextMode?` | `"tokens" \| "messages"` | - | how the window is bounded; default "tokens" when absent. |
| `maxMessages?` | `number` | - | message-count budget when contextMode = "messages". |

### Generation

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `seed?` | `number` | - |  |
| `completions?` | `number` | - | number of completions to request (presets-core `n`). |
| `maxContextUnlocked?` | `boolean` | - |  |
| `biasPreset?` | `string` | - |  |

## System prompts, templates, and behavior

Three shapes govern how a request gets assembled around the manuscript. `systemPrompts` carries the
always-on utility prompts (presets-core `SystemPrompts`); `templates` carries Handlebars-ish format
strings for card fields (presets-core `TemplateFormats`); `behavior` carries message-assembly flags
(presets-core `BehaviorSettings`). All three sub-objects are optional, and every field on each of them is
optional too.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `impersonation?` | `string` | - |  |
| `newChat?` | `string` | - |  |
| `newGroupChat?` | `string` | - |  |
| `newExampleChat?` | `string` | - |  |
| `continueNudge?` | `string` | - |  |
| `groupNudge?` | `string` | - |  |
| `assistantPrefill?` | `string` | - |  |
| `assistantImpersonation?` | `string` | - |  |

### Templates

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `worldInfoFormat?` | `string` | - |  |
| `scenarioFormat?` | `string` | - |  |
| `personalityFormat?` | `string` | - |  |

### Behavior

`namesBehavior` is ST's numeric enum for how character names prefix messages, kept verbatim rather than
decoded into a named union.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `wrapInQuotes?` | `boolean` | - |  |
| `namesBehavior?` | `number` | ST | ST `names_behavior`: how char names prefix messages (numeric enum, kept verbatim). |
| `sendIfEmpty?` | `string` | - |  |
| `continuePrefill?` | `boolean` | - |  |
| `continuePostfix?` | `string` | - |  |

## API and media options

Provider and request-level toggles. `apiOptions` (presets-core `APIOptions`) covers streaming and
per-provider request shape; `media` (presets-core `MediaSettings`) covers image and video inlining. Both
sub-objects are optional, and every field on each of them is optional too.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `streamResponses?` | `boolean` | - |  |
| `claudeUseSystemPrompt?` | `boolean` | - |  |
| `useMakerSuiteSystemPrompt?` | `boolean` | - |  |
| `squashSystemMessages?` | `boolean` | - |  |
| `functionCalling?` | `boolean` | - |  |
| `showThoughts?` | `boolean` | - |  |
| `reasoningEffort?` | `string` | - |  |
| `enableWebSearch?` | `boolean` | - |  |
| `requestImages?` | `boolean` | - |  |

### Media

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `imageInlining?` | `boolean` | - |  |
| `inlineImageQuality?` | `string` | - |  |
| `videoInlining?` | `boolean` | - |  |

## Choices walkthrough

`PresetChoice` is the novel construct on this entity: Marinara's `choiceBlock` and RC's `ChoiceGroup`
unified into one shape. It is authored now and run later. Vaud presents these questions and captures
answers at setup time once a run surface exists; an answer feeds `{{getvar::key}}` through `key`, gates
blocks on or off through each option's `enablesPrompts`, or writes scoped state through each option's
`set`. `type` (`PresetChoiceType`) picks how the question is answered: `one` and `many` select from
`options`, `toggle` is a boolean, `input` is free text; `default` shapes to match, an option id, option
ids, a boolean, or a string, in that same order.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | - |  |
| `key?` | `string` | Marinara | variable this choice sets (Marinara `variableName`); `{{getvar::key}}` reads it. |
| `label` | `string` | RC, Marinara | the question/title shown to the user (Marinara `question` / RC `label`). |
| `readme?` | `string` | RC | long-form prose behind a "read more" (RC `readme`). |
| `type` | `PresetChoiceType` | - |  |
| `options` | `PresetChoiceOption[]` | - |  |
| `default?` | `string \| string[] \| boolean` | - | one: option id; many: option ids; toggle: boolean; input: string. |
| `min?` | `number` | - | many: fewest options that must stay selected. |
| `placeholder?` | `string` | - | input: empty-field hint. |
| `suggestions?` | `string[]` | - | input: tappable example answers. |
| `separator?` | `string` | Marinara | many: how selected values join when injected (Marinara `separator`). |
| `randomPick?` | `boolean` | Marinara | Marinara: pick an option at random instead of asking. |
| `sortOrder?` | `number` | - |  |
| `extras?` | `Record<string, unknown>` | - |  |

### Options

One option in a walkthrough choice. It carries both source effects first-class rather than picking one:
`value` sets the choice's variable (Marinara), `enablesPrompts` gates blocks on while selected (RC
`option.prompts`), and `set` writes scoped state while selected (RC `option.set`). A source that uses
only one effect leaves the others empty.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | - |  |
| `label` | `string` | - |  |
| `description?` | `string` | - |  |
| `value?` | `string` | Marinara | Marinara: the string injected into the choice's variable when this option is selected. |
| `enablesPrompts?` | `string[]` | RC | RC: block ids (PresetPrompt.id) enabled while this option is selected. |
| `set?` | `Record<string, string>` | RC | RC: scoped state writes applied while selected (scope:key -> value). |

**Run in a scene.** A scene keeps its answers per preset and per group (`Chat.regex.choices`, ChatStore rule 42) and the assembler applies
them as RoleCall's preset loader does. Groups are read with the checks of RoleCall's `parseGroup` (`core/preset/choices.ts`): a `one` needs a
default that is one of its options, a `many` a default that meets its `min`, an `input` a default; a group that fails is not shown and not
applied. The answers are the baseline for every block a group names (`enablesPrompts` holds block ids, which are RoleCall's prompt
identifiers): a selected option turns its blocks on, every other named block is off, a block no group names is untouched, and the scene's own
block switches go on top, even one that matches the preset's own. `{{choice::group}}` and `{{chosen::group::option}}` read the answers. A
toggle's blocks ride in `extras.prompts` (RoleCall keeps them on the group, not the option). `set` is read and kept but nothing applies it,
as in RoleCall, where no code reads it. The Preset tab's Choices row opens the walkthrough, and its Save & done keeps the run's answers as the person's defaults for that preset (the app preference `scenes.presetChoiceDefaults`): a scene reads its own answer for a group, else the default, else the declared one.

## Full composition

`PresetBody` is the top shape assembled from every group above.

| Field | Type | Producers | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | - |  |
| `description?` | `string` | - |  |
| `enabled?` | `boolean` | - | Set-level on/off (the Library shelf switch; the lorebook/regex `enabled?` precedent). Absent = on; always read as `enabled !== false`. An off preset skips export the way an off set does. |
| `prompts` | `PresetPrompt[]` | - | the ordered real prompt blocks (divider rows are never blocks; `groups` model structure). |
| `groups?` | `PresetGroup[]` | RC, Marinara | categories / folders; canonical because Marinara + RC author them (see PresetGroup). |
| `samplers?` | `PresetSamplers` | - |  |
| `systemPrompts?` | `PresetSystemPrompts` | - |  |
| `templates?` | `PresetTemplates` | - |  |
| `behavior?` | `PresetBehavior` | - |  |
| `apiOptions?` | `PresetApiOptions` | - |  |
| `media?` | `PresetMedia` | - |  |
| `generation?` | `PresetGeneration` | - |  |
| `choices?` | `PresetChoice[]` | - | the CHOICES walkthrough (novel; authored now, run later). |
| `behaviorRefs?` | `string[]` | - | linked canonical regex/script entity id(s) - a LINK, never a copy; export decides whether to embed, and reports a set that could not ride rather than dropping it. |
| `quickReplyRefs?` | `string[]` | - | linked canonical quick-reply set ids; the Press exports each referenced set beside the preset. |

## Linked regex sets

`behaviorRefs` is the preset's counterpart of
[`CharacterBody.behaviorRefs`](character.md#composition-and-variants): it names standalone regex/script
pieces by canonical id rather than copying their rules into the preset. The set stays its own
editable piece, so editing it once changes every preset that links it.

`quickReplyRefs` follows the same rule for quick-reply sets. The Workbench preset settings list both
available regex sets and available quick-reply sets as explicit checkboxes. The Press resolves each
reference by kind and id and exports the linked pieces beside the preset; the preset never embeds or
duplicates their canonical bodies.

The link is canonical; embedding is a per-format decision made at export, because the platforms do
not agree on whether a preset can carry regex at all. SillyTavern and RoleCall carry the rows inside
the preset file itself (`extensions.regex_scripts`), so their adapters embed a linked set on the way
out. Lumiverse stores the association on the script instead, by `preset_id`, so nothing rides inside
the preset. Marinara has no preset-level attachment, so a linked set cannot travel with a Marinara
export. Each adapter's `embedRegex` owns its own answer, and `emitPieces` in
[src/convert.ts](../../../src/convert.ts) reports a set that could not ride rather than dropping it
silently.

## The writing family

A preset is one of the writing setups a scene can follow, with the Script Sheet
([scriptsheet.md](scriptsheet.md)): separate kinds that read one way. Each kind's `kind.ts` gives `asPreset`, the
preset it sends (a preset's own body), and `src/core/writing.ts` reads the family from that. The scene's Writing slot
records the kind with the id, so one picker lists presets and sheets together, and a sheet joins the preset deck in
the Library, shown as "Writing".

## What rides escrow, not a field

The design principle behind this schema: model canonically what the editor or domain authors, escrow
what is pure source-wire fidelity that no editor touches. `groups` and `choices` are canonical, not
escrow, because Marinara and RC have them natively and the editor authors them.

Rides escrow, because it has no canonical slot or is unauthored wire state: ST's per-character
`prompt_order` overrides, Marinara's variable layer, the original divider identifier for a `PresetGroup`
that came from an imported ST preset (see Groups, above), and each shape's own `extras`
(`PresetPrompt.extras`, `PresetGroup.extras`, `PresetChoice.extras`), sealed per-platform leftovers with
no first-class home that round-trip untouched. See the escrow rule in
[architecture.md](../architecture.md).

Does NOT ride escrow, because it is modeled: `groups` and `choices` are first-classed canonical fields,
not wire-only state, per the design principle above.

## See also

- [architecture.md](../architecture.md): the canonical model, escrow, hub-and-spoke, the adapter contract.
