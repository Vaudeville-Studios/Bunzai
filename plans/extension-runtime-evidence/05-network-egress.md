# WP10 network operation evidence

## Implemented

`network.request` is a generated desktop operation. Its package request lists exact HTTPS origins and exact HTTP methods; the host review manager can narrow both. The broker resolves access from the invocation and rejects a method or origin that is not in the saved grant. Every invocation presents a host confirmation with method, exact origin, path and outbound JSON payload before the host adapter sends it.

The adapter uses the existing `guardedFetchVetted` / `pinnedSender` egress owner. DNS is resolved once per hop, every answer must be public, TLS retains the hostname, and redirects are vetted against the exact granted origins. Mutating methods are never replayed across redirects. Requests are limited to 32 KiB JSON; response bodies are byte-capped for every final HTTP status at 256 KiB. The adapter has a 15 second timeout, propagates the broker abort signal, sets only fixed Accept and JSON content-type headers, and does not carry ambient cookies or auth.

Browser Studio does not expose this operation.

## Evidence

- `bun test src/extensions/operations/network src/kit/providers/egress-vetted.test.ts src/ui/apps/settings/sections/extensions.test.tsx`: 24 passed, 0 failed, 105 assertions.
- Egress tests use deterministic DNS/HTTPS seams. No public network or credentials were used.
- The broker operation test proves the confirmation precedes the injected network service and captures exact method/origin/payload. The egress suite proves address pinning, private target denial, redirect vetting, mutating redirect refusal, cancellation signal propagation, and body caps including non-success responses.
- UI tests prove the user can narrow methods and destinations and those exact selections are persisted through the manager API call.

## Not yet proven

The production server composition binds this adapter, but no isolated end-to-end extension fixture has yet sent a request through the live server/browser/desktop packaged artifact. File picker/clipboard/media host operations remain pending review of their host action and opaque handle boundary. Do not treat this document as packaged host proof.
