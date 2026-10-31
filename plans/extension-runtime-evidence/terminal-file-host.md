# Terminal file host amendment

## Scope and semantics

Terminal has no native chooser dialog. Its supported picker is a host-owned TUI text-path prompt. The extension never supplies a path: `files.pick` creates a typed pending ticket, the user enters a path in Kit's focused prompt, and Kit retains the canonical path in a per-runtime map behind a random opaque handle. The handle is bound again by the existing `HostFileActionPort` to package, digest, grant revision, and run epoch. Paths are absent from ticket replies, extension JSON, and file contents responses.

The terminal adapter accepts regular files up to 8 MB for host selection and reads the whole selected file only when the grant's `files.read` call requests a sufficient limit. Reads allocate at most the initial stat size plus one byte, use bounded descriptor reads, and recheck size, timestamp, file identity, and canonical path before returning bytes. Guest read/write bridge payloads remain bounded to 180 KB and move in 32 KiB chunks. The existing queue allows at most eight outstanding file actions with a 120 second ticket lifetime; at most 64 selected handles live for 30 minutes, and expired handles are pruned before applying that cap. Revoke, disable, update, and owner close invalidate unstarted tickets/handles through the shared port. A write ticket is marked begun by the fenced service immediately before native I/O; begun writes survive run abort long enough to settle as written or ambiguous. Terminal TUI cancellation answers the same typed file ticket.

Create writes use exclusive read/write file creation (`wx+`), so they fail if the destination already exists. Overwrite previews bind the selected file's size, timestamp, and digest; the host reopens the approved canonical target, checks its device/inode identity and snapshot immediately before writing, loops through partial writes, syncs, then reads back and verifies the digest. Ticket/principal and path identity are rechecked after asynchronous stages before truncate/write. A separate process can still modify an ordinary filesystem file during the write after the final check: this adapter does not claim cross-process atomic compare-and-swap. Once a write starts, a failed or lost completion is reported as ambiguous through the existing linked effect ticket.

This is a host-selection equivalent for the nonvisual Terminal host. It does not imply Browser or Desktop native picker support or change their behavior.

## Verification

`bun test src/kit/render/app-terminal-files.integration.test.tsx --timeout 120000` passes. This integration renders the actual Kit App, selects a temporary read path in the TUI, executes `files.pick` and `files.read` inside the real QuickJS Bun Worker, then selects a new create path, shows the write review, requires explicit `y`, and verifies the file bytes. It asserts that the selected path is absent from the guest result.

`bun test src/kit/extensions/file-actions.test.ts src/extensions/runtime/file-action-port.test.ts src/kit/render/app-terminal-files.integration.test.tsx --timeout 120000` passes. These tests cover opaque handle projection, oversized selection rejection before reads, expired-handle pruning, revoke before native open, abort/invalidation after begin, exclusive create, overwrite snapshot drift, bounded write relay, real QuickJS worker activation, and the TUI path/write review flow.

This evidence is source-runtime proof. A compiled CLI artifact launch has not yet been recorded here.
