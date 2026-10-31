# Exercise the native file reader

This fixture reads only a file you explicitly choose. Use a fresh temporary directory and the isolated Studio fixture; do not select a library, credential, or provider file.

## Build a temporary artifact

From the repository root in PowerShell, create a uniquely named fixture and package:

```powershell
$demo = Join-Path $env:TEMP ("bunzai-file-reader-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $demo | Out-Null
$sample = Join-Path $demo "reader-check.txt"
Set-Content -LiteralPath $sample -Value @("Bunzai file reader fixture", "line two") -Encoding utf8
$package = Join-Path $demo "file-reader.json"
bun run extensions:pack -- --source src/extensions/examples/bunzai.extension.file-reader --out $package
Get-Item -LiteralPath $sample, $package
```

Keep the temporary path in `$sample` and `$package` for the host exercise below. The directory is unique; the commands do not overwrite or remove an existing fixture.

## Exercise the production host path

1. Open the isolated desktop Studio fixture, not the existing user library.
2. In Settings > Extensions, review the package at `$package`.
3. Approve only `files.pick` and `files.read`, then install and enable it.
4. Run “Read a selected text file”.
5. In the host file-action card, choose `$sample`. Review the exact file name and the full-file read limit, then continue.
6. Confirm the host-drawn result shows the file name, byte count, SHA-256 digest, and first 2,000 text characters.
7. Revoke the package and confirm its command and rendered result disappear.

The command runs in the production QuickJS worker. Native selection stays in the trusted Studio page; the authenticated local API carries only the opaque handle ID and bounded binary chunks. The file reader does not send file contents to any network destination.

## Limits

The example reads the entire selected file and rejects files larger than 65,536 bytes for this command. File action tickets expire; a selected handle is bound to one invocation, package digest, grant revision, and runtime epoch. The current implementation has not been verified in a packaged WebView runtime.
