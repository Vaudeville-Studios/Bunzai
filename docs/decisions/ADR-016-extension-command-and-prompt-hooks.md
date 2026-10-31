# ADR-016: Extension command registrations and prompt candidates

**Status:** accepted, 2026-10-31 (root authorization)
**Context owners:** extension runtime, operation catalog, roleplay core
**Depends on:** ADR-015

## Command registration

The manifest remains the immutable source of command identities, labels, and handlers. Guest initialization through `bunzai.extension.define` binds handler functions to those manifest identities; it cannot invent or rename commands. The brokered `commands.register` operation changes only the installed package's host-visible enabled subset, replacing the set with an exact subset of IDs in that package's manifest. Install seeds the full declared set to preserve current behavior. Registration changes use the trusted package identity, expected revision, and extension commit context. The manager and every host activation path must enforce the persisted subset. It grants no access to another package, does not add handlers, and cannot increase operation permissions.

## Prompt contribution and transformation

Prompt hooks remain manifest-declared and run only through the host's active prompt-hook boundary. `prompts.contribute` adds one bounded candidate for the active package and hook at a named insertion point. `prompts.transform` can replace only that same candidate after it exists; it cannot replace or inspect the host's assembled prompt. Candidate state is invocation-local and never shared across packages or hooks. The operations have separate grants. `prompts.inspect` remains the independent permission for reading approved active prompt data.

Prompt activations may call only operations whose source descriptor explicitly lists the `prompt` activation origin. This is a separate broker policy, included in the operation permission fingerprint; the manifest's hook declaration alone grants no operation access. Discovery metadata and selected content/state/settings/storage reads may opt in when their normal exact grant checks still apply. Writes, external sends, host UI actions, and other effectful operations remain unavailable from prompt activation even when separately granted. The host rechecks enabled state, package digest, grant revision and suspension after the hook returns and before accepting its candidate. A revoked candidate is discarded; a required hook then fails the turn, while an optional hook is skipped.

The host orders candidates by ascending declared integer priority (default `0`), then package ID, then hook ID, using stable code-point comparisons. It applies the shared candidate, hook-count and aggregate byte limits. Contributions remain data: the host does not recursively evaluate macros or scripts. A missing active invocation, undeclared hook, missing grant, absent candidate, or exceeded limit fails closed. A prompt contribution may be marked `required`; a failed required hook aborts the turn before provider send. Optional hook failures are counted in the host-owned extension control record, reset after success, and suspended after three consecutive failures. Re-enable or access reapproval clears this state; guest-writable logs are not used as the suspension authority. The manager shows current counts and suspensions.

Manifest command, panel and prompt IDs share a bounded token grammar (`[A-Za-z0-9][A-Za-z0-9._:-]{0,79}`), so host menus and invocation routes never receive whitespace, control characters or unbounded IDs.

## Evidence required

Implementation is accepted only when tests prove exact manifest-subset registration, CAS and package isolation, install defaults, disabled command rejection on each composed host, and per-hook candidate append/replace isolation with independent grants and shared bounds. Catalog and UI metadata must be generated from operation and manifest source definitions. This decision does not claim host support before the corresponding runtime composition and tests land.
