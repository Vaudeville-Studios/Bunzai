# Independent review of the macro preview caller

Reviewer: root coordinator, who did not author the ADR or candidate implementation. Date: 2026-10-31. Reviewed source: ADR-012, proposed ADR-015, `src/extensions/operations/diagnostics/_macros-preview-proposal.ts`, its tests, and the trusted `activationOrigin` composition in the runtime service and broker.

Decision: accept the narrow fifth evaluator caller described in the updated ADR-015. This permits promotion of the reviewed candidate and corresponding precise caller-boundary documentation and guard changes. It does not approve unrelated caller expansion or the extension runtime as a whole.

Evidence:

- The strict schema admits bounded supplied text and a value-only environment. It admits no evaluator callback, host service, persistence handle, or regex opt-in.
- The host supplies activation origin. Event and prompt hooks cannot masquerade as a user-invoked command through guest arguments.
- The review handler projects supplied values without evaluating them. The evaluator runs only in execute, after the broker obtains fresh host approval.
- Execution creates a fresh context, forces `readOnly: true` and `allowRegex: false`, uses the existing evaluator and its limits, and returns bounded text plus aggregate diagnostics. It has no host I/O or durable-write calls.
- Root independently ran the proposal tests and existing regex door guard: 6 passed, 0 failed, 27 assertions. The broker regression rejects events and declined commands without execution and executes an approved command once.

The first proposal was rejected because it evaluated during review and again during execution. The accepted candidate removes that pre-approval evaluation.

Remaining release checks: promote the source without adding import/save/codec callers, update the existing macro caller guard, exercise the promoted operation through the packed runtime, and prove each advertised host's confirmation path. Full runtime coverage, CI, packaged verification, and final independent security review remain separate gates.
