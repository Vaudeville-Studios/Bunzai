# ADR-015: Extension runtime and macro preview boundary

**Status:** accepted, 2026-10-31 (independent root review)
**Context owners:** extension runtime, macro evaluator
**Depends on:** ADR-012

## Amendment to ADR-012 Decision 4

Add one fifth caller for the existing closed-world macro evaluator: `macros.preview`, available only to a manifest-declared command that a user explicitly invokes. Automatic event, prompt-hook, background and scheduled execution cannot invoke it. The operation runs through the extension broker and requires a fresh host confirmation for each request. Its review projection displays only the bounded sample and explicit value context supplied by the caller; it does not evaluate the sample. After approval, it evaluates once using the existing recursion, output and step limits. It forces read-only mode and disables author regex. It returns only bounded rendered text and aggregate sanitized diagnostics; it does not persist variable changes or any other state.

This caller is not a guest-selected evaluator entry point. The host authorizes the operation through the package manifest and current grant, checks budgets, obtains the fresh confirmation, and invokes the existing evaluator once. The `macros.preview` handler cannot invoke other broker operations, tools or the evaluator recursively. Any other operation that can invoke nested tools must still obtain its own fresh host confirmation under the normal broker rules. The extension cannot choose a handler, access a macro registry function, or supply host services.

The amendment does not add evaluator callers to import, parsing, save, content mutation, format adapters, serialization, provider tools, or background execution. Imported macro text remains data until a user explicitly invokes this preview. It does not widen `MacroContext` with filesystem, network, process, credentials, timers, callbacks, or persistence handles. Any broader context or caller requires a separate accepted decision.

## Acceptance evidence and limits

- Independent root review accepted this caller boundary and confirmed the context is value-only and read-only.
- A broker-path test proves that event activation is rejected before confirmation, a declined command evaluates zero times, and an approved command evaluates once.
- The operation is reachable only from a user-invoked, manifest-declared command through the broker, with a fresh host confirmation; event/prompt/background activations fail closed. Import, save and codec callers remain excluded by ADR-012.
- The handler has no nested broker/tool route and cannot recursively re-enter the evaluator.
- Limits are enforced by the existing evaluator; the operation adds no larger or duplicated limits.
- Tests prove caller-supplied variable changes are discarded. The descriptor has no service dependency; it cannot persist state or call a provider.

Fresh-confirmation paths have been exercised on Desktop by the broker-path test, in Browser by the static Pages probe, and in Terminal by the real QuickJS/TUI test. These results establish the narrow macro-preview caller on those three hosts only. They do not establish general host parity, packaged WebView behavior, package release readiness, or completion of the broader extension runtime plan.
