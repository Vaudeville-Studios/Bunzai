---
id: reference/entities/skill
title: Skill entity
audience: dev
summary: The canonical piece for instructions the model gets only when they matter, such as how to run a sword fight. A skill is a prompt that fires like a lore entry, on the lorebook's own trigger fields and matcher, or always, or while the model has it open. A scene links skills; the ones on in a turn ride as one Skills block at the preset's skills marker, never dropped by the budget.
tags: [entity, skill, prompt, lore, trigger, canonical]
related: [reference/entities/lorebook, reference/entities/preset, reference/entities/tracker, reference/entities/tool]
---

# Skill entity

A `CanonicalSkill` is `CanonicalEntity<"skill", SkillBody>`: a `name`, a one-line `description` (what it is for: the line
the model reads when it may pick the skill), and `text`, the instructions, whose macros render as in any prompt text.
The plan is `.claude/plans/skill-agent-kinds.md` section 2.

## When it is on

`when` is one of three (`src/core/skill.ts`, `skillVerdict`):

- `always`: in the prompt every turn while a scene links it.
- `mentioned`: when its triggers match. The triggers are a lorebook entry's own fields, decoded by the lorebook's own
  trigger decoder (`triggers`, `secondaryTriggers`, `selectiveLogic`, `caseSensitive`, `matchWholeWords`, `scanDepth`;
  see [lorebook.md](lorebook.md)), and matched by the lore engine's own `matchTrigger` and `selectiveLogicMatches` over
  the newest `scanDepth` messages, the one being answered included, newest first as a lore entry's scan text is. A regex
  trigger goes through the engine's vetted regex. No triggers, or a scan depth of 0, never match. A trigger's `frequency` and
  `probability`, which a lore entry's triggers may carry, are kept but not used by a skill.
- `picked`: while the model has it open. With `closeWhenUnmentioned`, an open skill closes on a turn its triggers no
  longer match (a skill with no triggers or a scan depth of 0 stays open).

Each verdict carries one plain sentence of why ("Mentioned: sword.", "Not opened."), returned on the assembly result as
`skills`.

## Open and closed

Which skills are open is scene state: the slot `skills` (`src/core/scene-state/slots/skills.ts`, a `fields` slot, one
field per skill id holding `true` while open, closing removes it; writers `turn` and `person`). So a swipe, regenerate,
cut or fork shows exactly the open set of what is shown, with no rule of its own ([scene-state.md](../scene-state.md)).

A scene that links picked skills gives the writing model two tools while Narrator Tool Access is on
(`studio/library-skills.ts`), made like the trackers' update tool:

- `open_skill` lists every picked skill in its own description, as a name and what it is for, so only that list costs
  anything until a skill opens. Its one argument is the skill's name. It answers with the skill's instructions, the
  turn's macros read read-only and what no macro answers stripped, and opens the skill (once) through the turn's one
  tool door, so it is in the Skills block from the next reply.
- `close_skill` closes an open one ("Closed ..."; a skill that is not open says so and writes nothing).

Both are `stateScoped` writes at the tier `narrator.skill`: their only effect is the open skills' deltas pending on the
reply being written, which a regenerate, swipe or cut takes back. An unknown name is refused with the list of names, and a
write that could not be saved is the model's error with nothing kept. With Tool Access off, or a connection that takes no
tools, a picked skill cannot open. A picked skill whose close rule holds on a turn is closed by that turn, with its
variable deltas (`studio/scene-turn.ts`); a continue closes nothing.

## In a scene and in the prompt

A scene links skills by id in its prompting (`ChatPrompting.skills`, in order, no duplicates, the same rule as tools and
trackers: `src/stage/store/prompting-rules.ts`). A turn reads them through its one library reader
(`studio/library-skills.ts`, `readLibrary`): each is checked by the skill decoder, and a gone or unreadable one is left
out, as is one whose name another linked skill already has.

The skills that are on ride as one system message, `### Skills` and then each skill's name as a `##` heading over its
rendered text (its macros run and what no macro answers is stripped, as in the preset's blocks), in the scene's order (`src/core/assembly/skills.ts`); a skill whose text renders blank adds nothing. It
goes where the preset's `skills` feature marker stands, with that block's role ([preset.md](preset.md)), and without one
after the leading system messages, after the trackers' and storyboards' blocks. The budget reserves it as it reserves
the library trackers' block: history gives way to it and it is never dropped (Chi, 2026-10-29). The Tokens sheet labels
it "Skills".

## Editing and placement

Extensions may stage a reviewed update to a Skill's name, description, or authored instructions through
`content.draft.skill.instruction.update`. The instructions remain inert canonical text in this operation; the
extension does not evaluate them. The normal draft review and apply operations own confirmation and persistence.

The Workbench editor edits instructions, activation and shared trigger controls through the existing
revision-checked piece session. Primary triggers can match any or all; older pieces default to any.
Promptbook Skill cards can occupy named positions and join adjacent Prompt cards in one message.
Their instructions still use the same activation and fixed-budget owner. Repeating a named slot
through include is refused rather than sending unreserved duplicate content.

The scene's dedicated Skills panel, manual close route and Kit authoring capabilities remain unbuilt.
Kit can list, read, duplicate, export and delete Skills through generic piece tools. The new editor and
placements have unit evidence; live UI verification remains blocked by browser access.


Every field, with its meaning, is in the generated [fields.skill.md](../../generated/fields.skill.md).
