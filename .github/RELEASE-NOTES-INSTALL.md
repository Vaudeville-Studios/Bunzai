## Install

Choose an asset attached to this release for your operating system and processor. The source archive is not a ready-to-run application.

| Platform | Asset | How to start |
|---|---|---|
| Windows desktop, x64 | `Bunzai.exe` | Open the app. If its window does not appear, check that the Microsoft WebView2 Runtime is installed. |
| Windows command line, x64 | `bunzai-cli-windows-x64.exe` | Run it from PowerShell or Command Prompt with a Bunzai command. |
| Linux, x64 | `bunzai-cli-linux-x64` | In a terminal, run `chmod +x bunzai-cli-linux-x64`, then `./bunzai-cli-linux-x64 ui`. |
| Linux, arm64 | `bunzai-cli-linux-arm64` | In a terminal, run `chmod +x bunzai-cli-linux-arm64`, then `./bunzai-cli-linux-arm64 ui`. |

macOS release binaries are currently held back. Use a source checkout on macOS until a macOS release is published.

The CLI prints the local address to open in a browser. Kit is available from a source checkout for development and is not included in release downloads. The `sidecar-*` files support the optional remote-access helper and are not opened directly.

This release includes `SHA256SUMS`. Compare the checksum for the exact asset you downloaded before opening it. A Windows reputation warning does not tell you whether a file is safe; verify the release source and checksum, or cancel if you cannot establish that you trust the file. Do not treat the warning itself as a reason to bypass Windows protections.

The Windows desktop app uses Microsoft's WebView2 Runtime. See [Microsoft's distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) and [runtime downloads](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

Your studio lives separately from the program, in an encrypted `library.db` inside the studio folder. Keep a protected backup before updating. The default folder is `Documents/Bunzai Studio`; the running app prints its exact location. Exported pieces are plain, unencrypted files and need separate protection.

For a source checkout, including Bun version, recursive submodule setup, backups, updates, and troubleshooting, see the [installation guide](https://vaudeville-studios.github.io/Bunzai/docs/guide/installation.html).
