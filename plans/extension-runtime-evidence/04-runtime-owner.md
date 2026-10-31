# Runtime owner integration evidence

Status: implementation in progress. This record is a concrete code/test checkpoint, not a release or isolation claim.

## Trusted runtime services

- `src/extensions/runtime/service.ts` owns package preview challenges, install/update/reapproval state, host principal creation, broker wiring, per-job cancellation, lease heartbeat and strict activation result decoding.
- `src/extensions/runtime/confirmation.ts` owns bounded host approval tickets. Requests expire after two minutes, at most eight may be pending, abort/expiry/capacity fail closed, and each ticket carries the operation-owned JSON review projection plus exact resource/field/method/destination scope.
- `src/ui/server-extension-owner.ts` supplies one queue and one fenced service per opened library. Authenticated routes expose pending tickets and explicit host answers. No guest field can answer its own ticket. The composed owner binds content, extension storage, vetted network and package-namespaced scene state.
- `src/extensions/contracts/destination.ts` defines exact HTTPS-origin and opaque host connection identifiers. `destinationMode` and HTTP methods are part of operation policies and grants; wildcard, HTTP, localhost and IP-literal grants are refused. The currently composed runtime advertises `desktop` only.
- Activation returns a strict result. Only an explicit `type:'bunzai.ui'` result enters the interactive descriptor decoder; other JSON remains output data.
- SQLite content, extension-data and scene-state writes recheck the live runtime lease and package control/grant revision inside the write transaction. `ExtensionCommitContext` is host-created and bound to package, digest, policy fingerprint, grant revision and operation. Ordinary content writes use the existing unprivileged path.
- Extension scene state uses only `ext:<packageId>:<slot>`. Reads are package-filtered and the ChatStore extension door revalidates namespace and commit context at SQLite commit.
- `contracts/events.ts` owns a closed lifecycle event inventory and emits only `{type,sceneId,kind}` payloads. Persistent event opt-ins are exact `{event,sceneId}` pairs in the sealed control; subscribe/unsubscribe operations require exact event and scene grants, host review, and broker-created commit context. Runtime dispatch filters enabled controls and grants, queues at most 32 pending events, and invokes at most eight packages sequentially for each event. Grant review, update and session expiry clear old subscriptions.
- Runtime shutdown drops session-duration grants so they do not revive on reopen. Per-package receipts and budget reservations are persisted before consequential handlers run.

## Focused integration evidence

Earlier broker/confirmation/destination checkpoint:

```powershell
bun test src/extensions/broker/invoke.test.ts src/extensions/runtime/confirmation.test.ts src/extensions/runtime/service.test.ts src/extensions/permissions/destinations.test.ts
```

Observed result: 10 tests passed, 46 assertions. Broker cases cover missing-review denial, exact access matching, principal rechecks, admission receipts and ambiguous cancellation. Confirmation covers one-answer semantics, repeat rejection, capacity, abort and expiry. Destination tests cover exact HTTPS origins, path/http/local/IP rejection and connection handles.

Current composed-owner and durable-fence check:

```powershell
bun test src/ui/server-extension-owner.test.ts src/extensions/operations/state src/stage/store/chat-store-extension-state.sqlite.test.ts src/stage/store/sqlite/extension-lease.process.test.ts
```

Observed result: 5 tests passed, 23 assertions. This proves concurrent route requests share one runtime owner, scoped scene-state operation behavior, SQLite scene-state grant fencing, and a real two-process lease takeover where the expired process's attempted content write is rejected. Additional current event/turn/owner/store suites are listed in the execution ledger. It does not prove packaged desktop execution or full plan coverage.

## Remaining gates

- Full typecheck and broader suites are owned by root due parallel source edits; no whole-branch pass is claimed here.
- Event subscriptions and safe lifecycle delivery are implemented; prompt transforms, turn-control operations, the full operation matrix and additional semantic content operations remain incomplete.
- Packaged desktop runtime, safe-mode behavior and cross-host parity remain release gates. Browser and terminal are not advertised as supported extension hosts.
