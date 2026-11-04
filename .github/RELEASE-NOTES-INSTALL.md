## Install

Download one file.

| File | For | How to open |
|---|---|---|
| `Bunzai.exe` | Windows | Double-click it. |
| `Bunzai-Linux.deb` | Ubuntu, Debian (experimental) | No terminal needed. Double-click it, choose Install, then open **Bunzai** from your apps. If double-clicking does nothing, run `sudo apt install ./Bunzai-Linux.deb`. |
| `Bunzai-Linux` | Any other Linux (experimental) | In a terminal: `chmod +x Bunzai-Linux && ./Bunzai-Linux`. Close the terminal to stop it. |
| `SHA256SUMS` | Checking downloads | Not an app. Fingerprints to check a download arrived undamaged: `sha256sum -c SHA256SUMS --ignore-missing`. |

Everything except Windows is experimental: our main contributors are on Windows, so other systems get less testing. macOS is not released yet; use a [source checkout](https://vaudeville-studios.github.io/Bunzai/docs/guide/installation.html).

On Linux, Bunzai opens in your browser. Closing the tab does not stop it; use **Settings > About > Quit Bunzai**.

Windows may warn that the app is unrecognized, because it is not code-signed. That warning is not a safety verdict; run it only if you trust where you downloaded it, otherwise cancel. No window? Install Microsoft's [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

Your library is stored apart from the app, encrypted, in `Documents/Bunzai Studio`. Back it up before updating.

Source checkouts, updates and troubleshooting: [installation guide](https://vaudeville-studios.github.io/Bunzai/docs/guide/installation.html).
