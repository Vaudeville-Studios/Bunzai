# Extension developer quickstart

This exercise starts from an empty temporary folder, uses only the checked-in public example and CLI, and installs the packed artifact through Settings. It reads character names only. The optional library-wide read can be denied while the package still installs; the command then shows that denial in its panel.

## 1. Copy a working example into a clean folder

Run these commands from the repository root in PowerShell:

```powershell
$demo = Join-Path $env:TEMP ("bunzai-extension-character-audit-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $demo | Out-Null
Copy-Item -LiteralPath "src/extensions/examples/bunzai.extension.character-audit/manifest.json" -Destination $demo
Copy-Item -LiteralPath "src/extensions/examples/bunzai.extension.character-audit/main.js" -Destination $demo
bun run extensions:check -- $demo --host desktop
bun run extensions:pack -- --source $demo --out (Join-Path $demo "character-audit.json")
bun run extensions:pack -- --source $demo --out (Join-Path $demo "character-audit-second.json")
Get-FileHash (Join-Path $demo "character-audit.json") -Algorithm SHA256
Get-FileHash (Join-Path $demo "character-audit-second.json") -Algorithm SHA256
```

The two artifact hashes should match. `check` and `pack` validate and bundle without evaluating the entry file. The bundled entry is limited to 1 MiB UTF-8. Static imports must be package-local or the generated `bunzai-extension-sdk`; dynamic imports and other bare package imports are rejected.

## 2. Review one optional permission and install

In Bunzai, open **Settings > Extensions** and choose the package file at `$demo/character-audit.json`. Review the package identity and each requested operation. `ui.panel.set` is required so the command can display its result. `content.list` is optional and requests only `id`, `kind`, and `name` for up to 20 characters in the library. The grant is library-wide metadata access; it does not include character bodies, prompts, descriptions, or media.

Leave `content.list` unchecked, approve the required panel operation, then choose **Approve and install**. New packages start disabled. Enable the package from its installed row and run **Refresh character name audit**. The panel explains that library access was denied. This demonstrates that an optional grant can be denied without making the package un-installable.

Open the package's access review, grant `content.list` for the library only if that scope is acceptable, and apply the review. Run the command again. The host-rendered panel now lists up to 20 character names. The example does not read or change character content.

## 3. How the command and panel use the SDK

The public SDK's generated methods are typed wrappers over the same `bunzai.call` broker bridge:

```js
import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  commands: {
    audit: async () => {
      const characters = await bunzai.operations.contentList({
        scope: { type: "library" },
        kinds: ["character"],
        fields: ["id", "kind", "name"],
        limit: 20
      });
      await bunzai.operations.uiPanelSet({
        contributionId: "audit-panel",
        descriptor: {
          version: 1,
          root: { type: "list", items: characters.map((character) => ({ type: "text", text: character.name })) }
        }
      });
    }
  }
});
```

The manifest declares both operations, the `audit` command, and the `audit-panel` panel contribution. `ui.panel.set` validates the panel ID and descriptor against the package declarations. The host draws the bounded descriptor. A package cannot provide HTML, event-handler source, or host permission controls. `bunzai.extension.define` registers handlers only; calls are admitted by the broker during a host invocation and still require the installed grant.

## 4. Update, disable, and revoke

To update, change the manifest version in the temporary project, run `check` and `pack` again to a new output file, then review that artifact in **Settings > Extensions**. Confirm the package ID and digest, inspect changed operation requests, and apply the update. Changed bytes require a new review; an old approval does not authorize the new artifact.

Use **Disable** to stop activation while retaining the installed package. Use **Revoke** to remove its grants and stop its panels/actions. **Remove extension and data** also removes its private settings and activity records; it does not delete library content.

## Preview and apply for content edits

Operations that propose library changes return a preview/draft first. Inspect the host's exact before/after review and explicitly call the matching apply operation with the expected revision and preview fingerprint. A preview does not persist a change. Scope is explicit: a selected-resource grant permits only those exact IDs; a `library` grant is broader and must be reviewed as such.

## Host availability

The catalog and `bun run extensions:check -- <folder> --host <host>` report whether each operation has a concrete adapter on `desktop`, `browser`, or `terminal`. The SDK types describe the source catalog; host availability is decided by the installed host, not by the package. Native file pickers, network access, UI gestures, and provider connections are host-specific. An operation missing on a host remains unavailable even if the manifest names it.

Desktop and Browser command menus attach the Library's staged pieces or the Workbench's active piece as a separate host context, bounded to 16 refs. `content.list` and `content.search` can request that context with `scope: { type: "invocation" }`; the broker still intersects it with the command's exact grant. Terminal currently has no current-piece context or `--on` selector. A Terminal command can use explicit resource selectors where an operation supports them, subject to the same exact grants.

## Troubleshooting

- **Unknown or unavailable operation:** check the operation ID in generated SDK docs and rerun `extensions:check` with the target host.
- **Package review rejects the file:** verify every manifest asset and entry path exists, declared files exactly match the manifest, and the artifact was produced by `extensions:pack`.
- **The package installs but the command is absent:** enable it in the installed row and check that the command contribution ID matches the handler registered by `bunzai.extension.define`.
- **A command reports denied access:** reopen its access review and inspect the exact operation, resource scope, and fields. Grant only what the command needs.
- **An update stops working:** changed package bytes require review. Confirm the current version/digest and reapprove only the requests you still want.
- **A host feature is unavailable:** select the actual host in `extensions:check`; a Desktop adapter does not imply Browser or Terminal support.
- **Need the operation schema or error codes:** run `bun run extensions:sdk` or read the generated [API reference](api.md) and [SDK reference](sdk.md).

The example sources live in `src/extensions/examples/bunzai.extension.character-audit`. Never put provider keys, private library content, or credentials in a package or its fixtures.

## More checked workflows

Three additional examples cover the common write and lifecycle paths. Each is independently exercised by the pack test from a temporary copy:

- [Character identity draft](../../../src/extensions/examples/bunzai.extension.draft-writer/README.md) previews a two-field semantic change and applies the reviewed fingerprint under an exact character grant.
- [Scene event panel](../../../src/extensions/examples/bunzai.extension.event-panel/README.md) subscribes to the safe `scene.opened` summary and renders it through the bounded panel API.
- [Prompt contributor](../../../src/extensions/examples/bunzai.extension.prompt-contributor/README.md) contributes one manifest-declared candidate to a specific scene's system prompt stage during host prompt preview.

Copy an example directory to a temporary folder, run `extensions:check` for the target host, then pack the checked source. Permission review still chooses exact target resources; a manifest requirement names resource kinds and fields but does not silently grant a library-wide scope.
