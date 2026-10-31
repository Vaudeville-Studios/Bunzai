---
id: reference/entities/promptformat
title: Prompt format entity
audience: dev
summary: The canonical piece for SillyTavern instruct and context templates, kept whole under ST's own field names, and what reads it (nothing yet).
tags: [entity, promptformat, canonical, sillytavern]
related: [reference/entities/preset, reference/formats/sillytavern]
---

# Prompt format entity

A `CanonicalPromptFormat` is `CanonicalEntity<"promptformat", PromptFormatBody>`. The body is `name` plus two
optional halves, `instruct` and `context`, each a flat record of ST's own field names to scalar values, and optional
`notes`. SillyTavern binds an instruct template and a context template by name, so one piece holds both. The type
lives in `src/entities/promptformat/schema.ts`.

Nothing applies a prompt format yet. Bunzai talks to chat-completion connections, which take role-tagged messages
and need no hand-written turn markers; a prompt format is for text-completion connections, which Bunzai does not
have. The piece is stored whole so the files are not lost. The Library card says so in one computed line, which is
never written into the piece. There is no editor: opening one on the Workbench shows that line and the fields, read-only, and a wireframe for a real viewer
is at `design/wireframes/features/prompt-format/index.html`.

An extension may stage reviewed edits to the stored name, instruct/context scalar fields, or author notes through
`content.draft.promptformat.templates.update`. These fields remain inert canonical data; this operation does not apply
the templates to prompt assembly. Draft review and apply own confirmation and persistence.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The format's name; also the name inside each half on export. |
| `instruct` | record | ST instruct template: `input_sequence`, `output_sequence`, `system_sequence`, `stop_sequence`, `wrap`, `names_behavior`, and every other key ST wrote. |
| `context` | record | ST context template: `story_string`, `example_separator`, `chat_start`, `trim_sentences`, and every other key ST wrote. |
| `notes` | string | The author's own notes. |

## Import and export

The `sillytavern-promptformat` codec reads either file or ST's master wrapper. Pairing a same-named instruct and
context into one piece happens in the Library import (`pairPromptFormats`). Export writes one file for one half
and the master wrapper for two. See [formats/sillytavern.md](../formats/sillytavern.md).
