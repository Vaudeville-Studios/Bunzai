# Independent cold review of Plan 001

- Reviewed artifact: `plans/001-unified-extension-runtime.md` and index.
- Date: 2026-10-31.
- Source baseline: `fea0b2cb79293745526dec295ae9ddcbf3c6b50b`.
- Reviewer: fresh-context agent `extension_plan_review`.
- This reviews planning instructions only. It is not approval of a runtime implementation, migration or security guarantee.

## Findings and changes incorporated

| Priority | Finding | Plan correction |
| --- | --- | --- |
| P1 | A new `macros.preview` caller conflicts with accepted ADR-012's four-caller restriction | WP1 explicitly requires the narrow new ADR amendment and boundary tests before exposure |
| P1 | A ten-second absolute job deadline contradicted longer asynchronous operations | Section 7 separates cumulative guest CPU, active lifecycle, host/confirmation waits and an absolute outer deadline; WP7 tests clock behavior; broker records effect receipts inspectable after VM disposal |
| P1 | Broad API coverage could be silently reduced while still claiming completion | Section 6 makes the proposed surface required; WP1 freezes exact operation/family and host acceptance coverage; only an explicit owner amendment can narrow it |
| P1 | Cross-process refusal had no assigned implementation | WP1 defines a fenced lease, WP4 implements atomic ownership and commit fences, WP7 gates activation/renewal/shutdown, with two-process fixture tests |
| P2 | Network instructions omitted the existing vetted transport authority | Section 3 and WP10 name/reuse `guardedFetchVetted`, `pinnedSender` and `VettedDeps`; explicitly extend GET-only handling and cap all response statuses |

The follow-up review confirmed those five corrections and requested two final clarifications, both incorporated: timeout aborts cancellable work without falsely declaring irreversible effects absent, and own-receipt listing recovers operation IDs lost with a dead VM. WP9 also explicitly propagates trusted fencing context through extension-originated turn/hook/background commits. These are plan-level corrections, not executed security proofs.

The author independently opened ADR-012 and the vetted egress implementation before incorporating these corrections.

## Review coverage and limits

Reviewer read the complete plan/index, repository instructions, plan-template/audit guidance, ADR-012/014, and spot-checked capability/draft, theme, sandbox-host, storage-contract and egress owners. The review did not audit all source, dependencies, migrations, packaged isolation, runtime implementation or UI security. No source changes, tests, builds, real-library access or external writes were performed by the reviewer.

Future implementation still requires independent security/migration/release review and all evidence gates in the plan. Plan completeness is not implementation completeness.
