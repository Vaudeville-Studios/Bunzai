# ADR-012: Macro evaluation is a closed-world interpreter, not a second script sandbox

**Status:** accepted, 2026-08-23 (proposed 2026-07-26)
**Context owners:** `src/core/preset/macros/`, `src/sandbox/`, a future `src/core/macros/`
**Supersedes nothing. Constrains:** any implementation of the macro engine

## Context

Bunzai needs to answer a question it cannot answer today: will this preset's macros actually work
after it is converted to another platform's format? The current answer is name-level only.
`src/core/preset/macros/support.ts` says so in its own header: a macro name missing from the target
engine is a reliable "this dies", but a name that is present proves nothing about syntax or meaning.
`{{random::a::b}}` picks from a list on SillyTavern and is a numeric range on RoleCall.

Closing that gap means being able to run a macro template against a modeled engine and compare the
result, which is what the macro engine design calls for: a tokenizer, a parser, and a
tree-walking evaluator over a registry of handlers.

That collides with project rule 3, which reads: "Imported scripts stay sealed. Lua, macros, and
regex payloads are data at every import and conversion boundary. Execution is only user-invoked
inside the Lua or regex test bench: Lua runs in wasmoon and regex runs in a terminable worker, both
on the isolated sandbox origin described by ADR-009. Do not add another execution path."

Rule 3 names macros. Read at its widest, it forbids the macro engine the specs already describe. Read
at its narrowest, it governs only the sealed script payloads Bunzai imports from other platforms.
The rule cannot be quietly reinterpreted in a code comment by whoever implements the evaluator first.
It needs a decision.

## The distinction this ADR draws

The two things rule 3 currently covers with one sentence are not the same hazard.

| | Sealed scripts (Lua, regex) | Macro templates |
| --- | --- | --- |
| What the payload is | Code in a general-purpose language | Text with `{{token}}` substitutions |
| Who wrote it | An untrusted third party, imported | Same, but interpreted against a fixed vocabulary |
| Expressive power | Turing-complete (Lua); catastrophic backtracking (regex) | Only what a registered handler does |
| Reachable host surface | Would be arbitrary without isolation | None; there is no handler that touches fs, net, or process |
| Failure mode | Escape, exfiltration, hang | Wrong text, unbounded expansion |
| Existing mitigation | Worker isolation, wasmoon, distinct origin (ADR-009) | Bounded depth, bounded output, no I/O |

A Lua interpreter runs whatever the payload says. A macro evaluator runs only handlers Bunzai
wrote, selected by name from a closed registry; an unrecognized name is emitted as literal text.
Those are different risk classes and giving them the same mitigation is not conservatism, it is a
category error that would put a pure text-substitution pass behind a cross-origin worker for no
security gain.

## Decision

1. **Rule 3 is narrowed, in writing, to sealed script payloads:** Lua and regex. Those keep ADR-009
   isolation and remain the only execution paths that get it. This ADR is the amendment; the rule
   text in `AGENTS.md` is updated in the same change that accepts this ADR.
2. **Macro evaluation is permitted as an in-process, closed-world interpreter** under
   `src/core/macros/`, subject to every constraint in section "Constraints on the evaluator" below.
3. **Conversion still never evaluates.** The macro engine design's edge case 21 stands unchanged
   and is promoted to an accepted decision: a codec that calls the evaluator during
   parse or serialize violates the Round-Trip Law. Macro text is opaque payload to every adapter.
   This ADR does not widen what codecs may do; it only permits a separate analysis surface.
4. **The evaluator is reachable from exactly five callers** and no others without a new ADR: the
   macro test bench (user-invoked), the transfer compatibility report, any future prompt assembly or
   Test Stage work, chat display (amended 2026-09-26, below), and the bounded extension `macros.preview`
   operation defined by accepted ADR-015. The extension operation requires an explicitly invoked
   manifest-declared command and fresh host confirmation for every request; it supplies a strict
   value-only context, forces read-only execution and disables author regex, then evaluates once.
   Event, prompt-hook, background, scheduled, import, save, and codec paths remain excluded.
5. **Macro handlers are data-only.** No handler may perform filesystem, network, process, timer, or
   dynamic-code operations. `eval`, `new Function`, and dynamic `import` of payload-derived paths are
   prohibited in the macro tree. This is enforced by a test over the handler registry, not by review
   alone.

## Constraints on the evaluator

These are acceptance criteria, not aspirations. An implementation missing any of them does not
satisfy this ADR.

- **Bounded recursion.** `MAX_EVAL_DEPTH` of 100, per the spec. A runaway subtree returns empty
  rather than throwing or hanging.
- **Bounded output.** A hard ceiling on total expanded characters per run, enforced during
  evaluation, not checked afterward. Expansion bombs are the realistic denial vector for a
  substitution engine and depth alone does not stop them.
- **Bounded steps.** A node-evaluation budget per run, so a wide template cannot substitute for a
  deep one.
- **No ambient clock or randomness by default.** Volatile macros read `context.randomSeed` and a
  caller-supplied clock. A test that cannot pin them is a test that cannot characterize them.
- **`readOnly` honored.** Side-effect macros become no-ops, per the spec.
- **Unknown names remain literal text** and never throw or abort evaluation. They may also be named
  in returned diagnostics so callers can distinguish unresolved text from a clean render.
- **No host surface on `MacroContext`.** It carries values only. If a future feature wants a handler
  that reaches outside, that handler needs its own ADR.

## Consequences

- The macro program in the plan becomes schedulable rather than blocked on an unresolved rule.
- `src/sandbox/` stays exactly as it is. This ADR adds no capability there and removes none.
- The security posture that actually matters is unchanged: nothing imported from another platform
  gets executed as code, at import or at conversion, ever.
- A reviewer gains a specific list to check an implementation against, instead of arguing about
  whether rule 3 applies.
- If this ADR is rejected, the consequence is concrete and should be stated plainly: Bunzai cannot
  ever prove macro behavior, only compare macro names, and the transfer report stays permanently at
  the name-level honesty it has today.

## Amendment, 2026-09-26: chat display

The chat shows messages the way RoleCall does (`useDisplayMessages`): every message, the greeting
included, runs through the full evaluator each time it is displayed, with the chat's cast, messages,
and variables, so every macro the engine knows resolves in the bubble. One difference from RoleCall is decided
elsewhere and wins: RoleCall reads the live card, but a Bunzai chat keeps its own frozen copy of its
cast (ChatStore rule 10), so display resolves against that copy. Two RoleCall
behaviors are kept on purpose and stay inside this ADR's constraints:

- **Volatile macros re-roll.** RoleCall's display passes no seed, so `{{random}}`, `{{pick}}`, and
  `{{roll}}` can change when the list is shown again. Here the display caller supplies a fresh
  `randomSeed` per showing, and each message holding a macro takes the next seed: the same behavior, with the
  randomness still caller-supplied, never ambient.
- **Variable writes do not persist from display.** The evaluator runs on a working copy of the
  chat's variables with `readOnly` off, so `{{setvar}}` and the other variable writes behave inside
  the text, and the copy is dropped afterwards. RoleCall does the same in effect: it loads the chat's variables
  from the server, display writes only its in-memory copy, and prompt assembly is what saves them.
  Chats have no variables yet; they arrive with prompt assembly, and until then display runs on an
  empty working copy.

Display never writes the evaluated text back to the stored message: the stored message stays the
authored text, as in RoleCall.

## What this ADR does not decide

- Whether Risu's `[[name]]` CBS dialect or Agnai's named-slot templates get modeled at all. That is a
  scope question, not a safety one, and it is blocked on source availability rather than on this
  boundary.
- Whether the evaluator is ever exposed to the model as a tool. A user-invoked test bench and a
  model-callable evaluation tool are different exposure decisions; only the former is contemplated
  here.
