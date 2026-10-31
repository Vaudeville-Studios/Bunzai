# WP10 file action evidence

## Implemented boundary

- The generated catalog now includes the four file operations; all are desktop-only.
- HostFileActionPort issues strict, principal-bound UI tickets. The server receives opaque handle IDs and bounded bytes only; it never receives native handles or filesystem paths.
- The trusted UI manager owns an in-memory registry capped at 64 handles with a 30-minute lifetime from selection. It invalidates handles on package revision changes and manager disposal.
- Reads and writes relay shared-contract 32 KiB chunks with a 180,000-byte transfer ceiling and SHA-256 integrity checks. File writes require a fresh current-file snapshot and the exact reviewed proposal digest before the browser write is attempted.
- The write apply operation stages a host file ticket during broker review. The manager action resolves that ticket and its linked broker confirmation together; the extension cannot approve its own write.
- Create mode retains a user-selected directory handle and a host-generated random filename; it creates the file only after the reviewed write is confirmed. The browser File System Access API does not expose an atomic exclusive-create primitive, so the random name reduces collision risk but does not provide a cross-process compare-and-swap guarantee.

## Evidence

- Focused suites cover principal binding, cancellation, stale handles, capacity and expiry, strict ticket answers, ordered read chunks, digest-bound write chunks, and snapshot mismatch rejection.
- The manager/registry/operation/port/engine/route focused run passed 38 tests, 0 failed, 152 assertions (2026-10-31).
- Catalog check passed: 45 operations from 18 drop-ins.
- SDK check passed: 45 generated operation wrappers.

The file transfer limits, selected-file cap, handle count and lifetime have one shared owner in contracts/limits.ts. The picker tests use in-memory fake handles. They do not prove native File System Access behavior in Chrome, packaged WebView2, or another desktop runtime. Packaged/deployed file picker support remains unverified.
