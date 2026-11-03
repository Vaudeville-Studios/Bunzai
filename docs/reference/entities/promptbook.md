---
id: reference/entities/promptbook
title: Promptbook entity
audience: dev
summary: A Promptbook is an ordered workflow of private, reply and after phases, composed from preset blocks and linked Library pieces.
tags: [entity, promptbook, workflow, canonical]
related: [reference/entities/preset, reference/entities/skill, reference/entities/agent]
---

# Promptbook entity

A Promptbook lives in the Writing deck alongside Presets and Script Sheets. Its canonical owner is
`src/entities/promptbook/`. Each phase owns a preset, ordered Library cards, optional Agent and model,
reply-token budget, shared Skill-style condition, and explicit reads from earlier phases. Exactly one
enabled, unconditional reply phase sits between private and after phases. Saved setups retain phase
on/off choices. The decoder rejects duplicate identities, references to later phases and invalid Together groups.

The Workbench editor provides Phases, Cards and Board views over one revision-checked draft. Cards
reference Script Sheets, Skills, Tools, Dice, Regex and Trackers rather than copying their bodies.
Adjacent Prompt and Skill cards can form a Together row. Board displays phase order and hand-offs;
its inside-phase level edits the phase's preset blocks. Board wires are a visualization, not connection
editing. Blank and Think, then write are the available starters. Try a line checks phase conditions
without contacting a model; it does not simulate cards, tools or model-picked Skills.

`src/studio/book-phase.ts` composes each phase through the existing scene assembler, tool loop,
regex sandbox, Skill matcher and scene-state write door. Private outputs pass forward as literal data,
so generated macro-looking text cannot write variables. Active Skills remain fixed budget content;
named Skill placements cannot be duplicated with include. The scene's Tool Access permission still
applies. Missing linked pieces stop the workflow before that phase sends.

Private phases run before the writer; after phases run after its Final Cut pass. Only the writer streams
into chat. Incomplete workflows fail without committing an assistant message or state deltas. Stopping
the writer retains its partial reply; stopping an after phase discards the pending workflow. Completed
and intentionally stopped checkpoints can recover after a storage failure; unfinished workflow
checkpoints cannot be manually committed or recovered as completed replies. Regeneration runs private
phases again. Continue restores recorded private notes, skips private and after calls, and retains the
scene runner's variable rewind behavior.

The Inspector records private and after requests, outputs and reported token usage beside the writer.
The forecast composes the reply phase and labels its estimate as reply-only; future hand-offs and Dice
results are unavailable until send. Prompt Inspector pauses before each phase's first request.

Each phase's preset blocks use the shared [Preset attachment contract](preset.md#prompt-block-attachments),
including images, PDFs and literal UTF-8 text files. Files stay with their phase through save/reopen
and native folder interchange. The existing host scene runner resolves each phase's own enabled
files, keeps their order and includes file metadata in its Inspector trace. Rehearsal still does not
contact a model or prove file delivery. New RP-Core-linked scenes explicitly refuse enabled prompt
attachments until the canonical Preset/Promptbook bridge is implemented.

Native Bunzai JSON preserves the canonical book, its attached file bytes and reference IDs. It does
not embed the referenced Library pieces; distribute those alongside it. Export to a single platform
preset is refused because it would discard the workflow. Card versions, arbitrary branching and
full-workflow rehearsal remain unimplemented. Source tests do not establish packaged behavior.
