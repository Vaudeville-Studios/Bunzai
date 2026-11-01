# Native cache verification race

Base source: 2307cd60fc23fb0eed7de3853a715ce9bd6082d3. Runtime: official Bun 1.3.14, actual Windows x64 and WSL Ubuntu Linux x64 (non-root UID 1000). All runs use fresh task-owned profiles and explicit whitelisted environments. This is source-runtime evidence, not a packaged native-window claim.

Independent baseline evidence reviewed by root: the unchanged Linux concurrency regression failed twice across 30 runs. Disposable instrumentation observed no publication exception. Instead, a concurrent atomic replacement unlinked the inode observed by lstat, producing nlink 0; the full safety predicate correctly rejected that stale metadata. Root authorized pathname re-observation only for this exact transient case.

The canonical owner now permits at most six lstat observations with 1ms yields only while nlink is zero. Every returned path still passes the unchanged regular-file, symlink, owner, link-count, mode, size, bounded read and SHA256 checks. Nonzero unsafe metadata, read/missing errors and publication failures retain their previous fail-closed behavior. No alternate writer, cache, lock or general retry was added.

The existing concurrency regression now covers 40 fresh two-caller pairs and one 16-caller burst per run, preserving identical verified path, shipped bytes, private mode and one-file directory assertions. Only the canonical owner and this canonical test were overlaid into the disposable exact-base Linux source. Instrumented prototypes were not used for canonical GREEN.

Canonical full focused results: Linux 8 pass, 2 Windows-specific skips, 276 assertions; Windows 3 pass, 7 Linux-specific skips, 11 assertions. Linux hard-link, symlink, broad-permission and modified-byte refusals pass unchanged.

Independent reviewer luna_js_engine approved the canonical diff and reran it successfully 30/30 times: 1,200 two-caller pairs plus thirty 16-caller bursts, 7,800 assertions. The reviewer also confirmed the full Linux native suite result above. Root independently read and approved the exact two-file diff and bounded verification mechanism before commit. This evidence covers source-runtime concurrent calls; it does not certify universal cross-process startup availability or a packaged native window.
