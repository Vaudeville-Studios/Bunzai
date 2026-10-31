# ADR-016: model cost approval and accounting

Status: implemented limitation; no USD cap is claimed.

## Decision

Every `models.generate` call requires a fresh host approval showing the selected saved connection and model, the exact prompt, and the requested output-token ceiling. The review also states that provider pricing is unavailable and no dollar cap is enforced. The runtime never computes price from a locally maintained model table.

The broker reserves the prompt's UTF-8 byte length plus four bytes per requested output token before dispatch. The provider response is bounded before it is returned, and settled `accountingUnits` are the prompt and output UTF-8 byte lengths. These conservative units are separate from reported provider token counts. Missing provider token reports remain `null` on the call and mark aggregate `tokenUsageComplete` false; they are not replaced with byte counts. Provider-reported USD cost is accumulated only when the provider supplies it.

## Reason

The trusted provider configuration contains connection IDs, endpoint data and credentials, but no authoritative model-price owner. Price data can vary by provider, account, cache path and model revision. Inventing a local price table or treating absent `usage.cost` as zero would give false assurance. Per-call approval limits each send to a bounded prompt/output request and gives the host a decision before external dispatch; it does not guarantee a maximum dollar cost.

## Consequences

- The host approval must remain visible for every paid or potentially paid model call.
- A numeric USD maximum is not enforced. The UI and operation review disclose this before the send.
- Usage reports distinguish actual provider token counts from conservative byte-based accounting units and provider-reported cost.
- A future USD ceiling requires a trusted, versioned pricing owner or provider-enforced maximum; it must fail closed when that ceiling cannot be established.

## Evidence

`src/extensions/operations/models/operations.ts` supplies exact per-call review content and the cost limitation. `src/extensions/runtime/model-services.ts` binds execution to the reviewed provider configuration, reports only provider-supplied token counts, and keeps accounting units separate. Deterministic fixtures in `src/extensions/runtime/model-services.test.ts` cover exact snapshot binding and missing usage data. This ADR is not evidence of a dollar cap.
