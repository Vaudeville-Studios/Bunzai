---
id: reference/table-read
title: Table Read
audience: dev
summary: A bounded character interview over the canonical character model, saved providers and one encrypted revisioned session.
tags: [table-read, character, interview, persistence, provider]
related: [reference/entities/character, reference/architecture, guide/table-read]
---

# Table Read

The discovered `src/ui/apps/table-read/` app creates ordinary characters by conversation. The Library
offers it beside blank character creation. Its selected Living Card design keeps the interview and
canonical draft together, with a pane switch in narrow containers. Controls and tokens come from the
existing UI families; there is no separate theme or character model.

The centered layout is bounded at 88rem with a seven-to-three interview/card-rail split. Generated
transparent PNG artwork places the Understudy on the left beside dialogue and a manuscript table
across the foreground. The figure leans, the spotlight dims and a paper shifts during a pending
request; narrow containers use a compact scene header above the dialogue. Decorative art is hidden
from assistive technology and receives no pointer input. The shared build-only app PNG plugin embeds
the source images as data URLs in both development and packaged browser bundles, without a new asset
route. One finite UI artwork catalog owns the five adult cutouts, stable IDs, labels, imports and
original-reader fallback. Shared Card controls select the illustration during setup; a compact Select
can change it during an interview. The cosmetic choice is kept in `ctx.prefs` as `table-read.reader`,
separate from the interview schema. Unknown preferences resolve to the original cutout. Appearance
changes neither the Understudy prompts nor the saved provider/model, and do not issue a model request
or clear field/answer scratch. A keyed
question entrance and the existing Card choice controls establish the interview hierarchy; brief and
history use Disclosure controls. The character rail uses the Workbench's actual BentoCard sections
for Identity, Description, Personality, Scenario, First Message and Examples. FIELD_MODULES supplies
labels and control metadata; EditorField and the shared CharacterTextControl reuse Workbench input
styles, RenderBox and ExpandTextarea. Table Read starts prose in source mode, with the normal
rendered/source toggle and fullscreen editor available. It embeds presentation only, without loading
a saved entity, media context or Workbench save lifecycle. The local
`useFieldUpdates` owner compares accepted field values within a session and draft-store lifetime,
using shared `useFlash` timing. Initial views, identical polls and restored lifetimes stay quiet;
actual changes briefly show Updated. New
motion honors reduced-motion preferences, and pointer answers do not force heading focus.

Focusing a control selects the existing local scratch field; typing does not write to the server or
claim manual ownership. One dirty field disables the other field controls until explicit Keep edit
or Cancel edit. Keep validates and persists the edit, including an intentional blank. Scratch survives
accepted proposals and fullscreen editing. Frozen sessions expose any retained unkept text separately
for copy/discard recovery.

## Ownership

`src/core/table-read/` owns strict value schemas, the finite editable field surface, prompts and pure
mode transitions. The character itself is `CharacterBody` from `src/entities/character/`; field
proposals can touch only name, tagline, description, personality, scenario, opening message and example
dialogue. Arbitrary paths, executable output and unknown protocol keys are refused.

`src/studio/table-read/` owns orchestration and persistence. `connect` from the existing provider
composition resolves a saved connection and model; `provider.send` performs the call. Requests disable
tools, set output/token/context/time limits, and contain only this interview's idea, accepted answers
and card fields. A normal turn uses one structured model response for proposals and its next question.
Malformed output retains a retryable draft instead of pretending to succeed.

The current defensive limits are 8,000 characters per idea or answer, 20,000 per field, 1,000 per
question, six choices of up to 240 characters each, and 48 transcript entries. The encrypted document
is capped at 512,000 UTF-8 bytes, model input at 192,000 bytes and combined streamed content/reasoning
at 96,000 bytes. A model operation has a 120-second deadline and an output budget of at most 6,000
tokens, further reduced for the model's context window. These are guardrails, not writing-quality scores.

## Modes and field ownership

Cold Read targets about five questions with an eight-question ceiling. Deep Dive has a twenty-question
ceiling and at most one model-requested follow-up for an already asked field. Follow-up identity must
match the proposed question's target; decoded repeated deflections retire a target. Covered fields can
be revisited only through bounded clarification, and manually kept fields are not asked again. A redundant or unusable next question is recoverable failure, not an
automatic claim that a barely populated card is ready.

Rapid Fire prepares a bounded deck before setting its server-owned 90-second deadline. Choices are
validated against the current question, accepted promptly without inference, and retained in the
transcript. A full live field is not silently truncated. Expiry refuses further answers; it does not
automatically spend another call. Review and model-assisted synthesis remain explicit actions.

Manual field ownership is stored, including deliberate empty values. Every future model application
respects it. Manual edits invalidate any older pending operation as well as locking that field. A late
response cannot replace a newer revision. The app displays a composing state while structured output
is pending and applies fields only after validation, without simulated token-by-token field updates.

## Durable state and operation lifetime

There is one active interview document under the closed `tableRead` StateStore key. Its version-one
decoder bounds the canonical draft, transcript, questions, ownership, operation identity and receipts.
It is sealed in the existing `studio_state` table, alongside other Studio documents. No SQL migration
or change to the canonical character envelope is introduced.

This is additive private state. The prior StateStore can still read and write its known keys without
erasing the new row; it has no Table Read interface. Encrypted snapshots restore the interview and
revision together. Plain folder exports and character exports do not include interview progress.

StateStore's trusted-application `writeIfRevision` shares conditional-write mechanics with the existing
extension method. Extension compare-and-write still checks `requireExtensionCommit` inside its SQL
transaction; Table Read never fabricates extension authority. Locked or corrupt state refuses access
without clearing the stored document.

The route owner is explicitly shared by trusted and approved-device handlers, scoped to the actual
opened StateStore. Restore retires the earlier runtime. GET is read-only and never starts, retries or
clears a model operation. Pending requests carry owner/token/expiry; explicit retry cannot duplicate a
live request. Stop and manual edits invalidate the durable token. Cumulative content and reasoning
bytes abort the host's over-limit inference wait, even when a provider ignores cancellation. Model waits settle on
cancellation; accepted storage writes are awaited under the existing safe library-close contract.

## Review and exact-once creation

No-model **Review current draft** makes a partial card reviewable even when the provider is unavailable.
It does not create a Library entity. **Finish with the interviewer** requests synthesis first. Missing
fields remain visible and a name is required to save.

Save first persists a frozen committing phase, stable random card ID and lease. It then calls the
existing `StudioStore.compareAndCreate`, which creates only that ID when absent. Receipt recovery
accepts an existing live character only when its canonical body equals the frozen body. Concurrent
saves, edit, discard and start-over are refused while the commit is unresolved. A lost receipt keeps
the committing evidence for explicit retry rather than renaming the new card.

A positively identified different or retired entity is a conflict, never an overwrite or resurrection.
That known conflict returns the retained draft to review so it can be copied, edited or explicitly
discarded. Uncertain create or receipt failures remain frozen. Saved characters open through the
existing Workbench ownership; no hidden editor draft is modified.

## HTTP and support boundaries

`GET /api/table-read` reads a revisioned view. `POST /api/table-read` accepts the strict action union
on `TableReadApi`; app code uses `ctx.api`, not direct transport. Authentication and open-library
checks precede the feature. Approved LAN/mesh devices may author as they can in scene routes, without
receiving a LibraryHandle or host-management authority. The existing shared foreign-site predicate
also applies to these new writes. No extension operation or arbitrary provider endpoint is added.

The temporary browser Studio explicitly returns unavailable. This implementation does not add the old
draft's CLI surface, alternate interviewer catalog, auxiliary lorebook/persona bundles, format-specific
question targets or Dark Room layout. The scripted-provider live fixture is workflow evidence, not an
evaluation of real model writing quality or new packaged-binary proof.
