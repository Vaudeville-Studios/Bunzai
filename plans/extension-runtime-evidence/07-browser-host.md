# Browser extension host evidence

## Implemented boundary

The static Pages artifact now carries the trusted QuickJS worker bundle and the pinned QuickJS WASM bytes in generated Pocket data. A sandboxed `srcdoc` frame has `sandbox="allow-scripts"` only, an opaque origin, a nonce-bound strict message handshake, and CSP with `connect-src 'none'`. It creates a Blob Worker from the host-built self-contained worker bundle and passes the pinned WASM bytes as `wasmBinary`; package source is sent as a separate message field and is evaluated only inside QuickJS. There is no same-origin or UI-thread evaluation fallback.

Pocket creates one `ExtensionService` over one `memoryExtensionStore` for the page lifetime. Its generated Browser catalog contains only source descriptors that advertise Browser support. Pocket binds content, drafts, package settings, package storage, canonical scene reads/creation, scene state, collections, events, and host actions. It omits file and network adapters. `/api/extensions/*` uses the same strict routes as desktop through browser-safe bounded HTTP helpers. `pagehide` closes the service, aborts active runs, and discards the volatile store. The Pages builder also copies the referenced theme font assets into `studio/fonts`.

## Measurements and live fixture

`bun run build:pages` produced the local static artifact. The compiled worker source was 162,177 characters; pinned QuickJS WASM was 503,134 bytes (670,848 Base64 characters). The artifact was served from an ephemeral loopback listener by `bun scripts/pocket-extension-browser.ts` and exercised in Chrome 149.0.7827.55. The command exited 0 after the latest run.

The fixture installed and enabled temporary packages through Pocket routes, created a canonical scene, exercised local prompt preview through the real service, revoked the contributor, then opened the stored scene through the Scenes UI and applied a command-produced draft through the mounted composer. It also completed a real QuickJS command and a regex worker request. After the menu virtualization change, the fixture navigated into the built Library UI, staged its stored character through the real Library row, and ran the installed `Verify selected context` command through `HostCommandMenu`; its guest handler required `input === null` and verified that `content.list(scope: invocation)` returned exactly that selected character. Browser proof passed with this flow. The browser assertions observed:

- iframe sandbox tokens were exactly `allow-scripts`; the parent could not read its document;
- the iframe origin was `null`; local storage and parent document access raised `SecurityError`;
- its CSP included `connect-src 'none'` and `worker-src blob:`;
- guest QuickJS globals `fetch`, `document`, `window`, `parent`, `localStorage`, and `process` were all `undefined`;
- the host catalog included Browser-safe content, scenes, and command operations, while excluding `network.request` and all `files.*` operations;
- canonical scene open and scene-open notification routes both returned 200; the composer result was `applied` and the transcript message count did not change;
- a host-selected character reference crossed the separate activation `hostContext` field, reached QuickJS only as a frozen `bunzai.context.invocation.resources` value, and `content.list(scope: invocation)` returned only that grant-matching character;
- prompt preview included the stored scene context and QuickJS contributor output; revoking the contributor removed its candidate;
- no external HTTP(S) request occurred; the fixture created opaque-origin Blob Workers for QuickJS and regex;
- reloading while a second command waited for host approval removed the worker frame, and the next page had no installed fixture package;
- the referenced Cinzel font was present in the built Pages artifact; an absent `scenes` tutorial bundle returned a normal 404 and was handled by the shell.

Current Mainstage merge artifact identity (commit `9c6063c5fa25dc066892389df585798035af523d`, 2026-10-31): `dist/pages/studio/index.html` SHA-256 `9734EE81081CEAD6F414E54A1EA30773FE4E33C1CF83B81E36096D58B54EA5CF`; `studio/pocket.js` SHA-256 `6A1FBEC03964EA122D156C7EBFD2B9B4BA0887B7801631FF65AC7C5EAB9D29DA`; `studio/apps/library.js` SHA-256 `1976E49A0A42F83F6B2759EC6A42DB2D3FB3010C6A50D9D2B4D6D2A870828C28`; `studio/apps/workbench.js` SHA-256 `CD2DA8B00FCB9F157FC4C27D67CE23B84C103CCFFEC9426C9123CD0EE37840EE`; `studio/apps/scenes.js` SHA-256 `374435190E424161DD865AFEEB6E58DE38FBE39F0FB190ECF4D3713B23C95348`. `bun run build:pages` and `bun run extensions:pocket-browser` both exited 0 against this artifact after the final descriptor metadata and compatibility-note changes. The fixture exercised the actual cross-bundle host Apply event bridge into the mounted SceneComposer, then asserted the applied draft and unchanged transcript count. The bridge regression unit test separately covers a registered callback, not a cross-bundle event. The menu E2E used one actual Browser command; the separate HostCommandMenu component test rendered 512 commands, kept fewer than 60 mounted, scrolled to the final command, and invoked it.

This is live proof against the generated local Pages artifact, not a deployment or packaged WebView claim. The Browser file and network adapters remain intentionally unavailable.
