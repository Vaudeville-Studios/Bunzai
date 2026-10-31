# Character identity draft example

This command previews a name and tagline change for the `mira` character, then asks the host to review and apply the exact draft fingerprint. The package requests only those two identity fields and the separate draft-apply grant. Select the exact character resource during permission review; change the example ID in `main.js` if needed.

The preview itself does not write. A stale or revoked draft returns a conflict and must be previewed again. Run `bun run extensions:check -- <folder> --host desktop` and `bun run extensions:pack -- --source <folder> --out <artifact.json>` before installing.
