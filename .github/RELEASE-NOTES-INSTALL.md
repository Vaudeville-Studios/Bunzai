## Install

Choose an asset attached to this release for your operating system and processor. The source archive is not a ready-to-run application.

| Platform | Asset | How to start |
|---|---|---|
| Windows desktop, x64 | `Bunzai.exe` | Open the app. If its window does not appear, check that the Microsoft WebView2 Runtime is installed. |
| Linux, x64 | `Bunzai-Linux` | In a terminal, run `chmod +x Bunzai-Linux`, then `./Bunzai-Linux`. It starts the local Studio and opens your browser. Keep the terminal open while using it. |

macOS release binaries are currently held back. Use a source checkout on macOS until a macOS release is published.

Each app includes its matching remote-access helper and prepares a verified local copy automatically, without a second download. Remote access stays off until you enable it in Settings. You do not need a separate sidecar file. `SHA256SUMS` is the integrity list, not another app to run. GitHub's source archives are for development.

Advanced CLI commands and Linux ARM64 builds remain available from a source checkout. Older releases retain their separate helpers and CLI files for existing installations and recovery links. Kit is available from source and is not included in release downloads.

This release includes `SHA256SUMS`. Compare the checksum for the exact asset you downloaded before opening it. A Windows reputation warning does not tell you whether a file is safe; verify the release source and checksum, or cancel if you cannot establish that you trust the file. Do not treat the warning itself as a reason to bypass Windows protections.

The Windows desktop app uses Microsoft's WebView2 Runtime. See [Microsoft's distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) and [runtime downloads](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

Your studio lives separately from the program, in an encrypted `library.db` inside the studio folder. Keep a protected backup before updating. The default folder is `Documents/Bunzai Studio`; the running app prints its exact location. Exported pieces are plain, unencrypted files and need separate protection.

For a source checkout, including Bun version, recursive submodule setup, backups, updates, and troubleshooting, see the [installation guide](https://vaudeville-studios.github.io/Bunzai/docs/guide/installation.html).
