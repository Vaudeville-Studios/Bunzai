---
id: reference/security/secrets-and-keys
title: Secrets, provider credentials, and local API authority
audience: dev
summary: How Kit encrypts BYOK provider configurations, constrains provider egress, and how the Studio gates its local API with a per-launch bearer plus Host and Origin checks.
tags: [security, byok, keys, vault, loopback, csp]
related: [reference/architecture, reference/concepts/safe-rendering, reference/cli]
---

# Secrets and keys

This page covers three separate authorities: Kit's encrypted provider vault, provider egress locked to
the endpoint the user configured, and the Studio's per-launch local API bearer. Where a defense is
incomplete or not measured in the packaged host, this page says so in the same section. See
`@fig defenses` for the whole picture at a glance.

@fig defenses

## Kit provider vault (shipping source preview)

Kit is bring-your-own-provider. Importing, editing, inspecting, validating, converting, and deterministic
analysis do not need a key. Provider-backed turns use the provider or OpenAI-compatible endpoint the user
selected; Bunzai operates no inference account or proxy. The current provider roster is discovered from
`src/kit/providers/spokes/`, and unknown providers or keyed providers without a key fail before a request is
made (`src/kit/providers/adapters.ts`; `src/kit/providers/egress.ts`).

Kit is currently a source preview. Run it from a checkout with `bun run kit`. The release workflow does
not include Kit binaries in its Windows or Linux desktop, CLI, or helper assets.

### What the vault seals

Saved providers live at `~/.bunzai/kit-vault.json`, or under `BUNZAI_HOME` when that override is set
(`src/kit/providers/config.ts`). The current implementation does **not** split public metadata from
secret material. It encrypts the whole `Vault` document: every saved `ProviderConfig`, including its API
key, base URL, extra headers, options, and label, plus the active provider id and optional Spotify link. The file on disk contains
only a versioned `{ v, backend, payload }` envelope. A round-trip test proves that neither the API key nor
the provider name appears in that file as plaintext (`src/kit/providers/vault.ts`;
`src/kit/providers/vault.test.ts`).

The decrypted provider list is cached in process memory after the first successful open. Writes encrypt a
temporary sibling created exclusively with owner-only mode `0600` where the platform supports it, sync
the file contents, then rename it over the vault. That protects the prior file from a partial write;
the containing directory is not fsynced (`src/kit/providers/vault.ts`; `src/studio/atomic-file.ts`).

### Backends and present platform boundary

The security-owned registry has five explicit backends, in seal-priority order. Opening an existing blob
always uses the backend id recorded in that blob; it never tries a different backend after a failure
(`src/kit/keystore/registry.ts`; `src/kit/keystore/keystore.ts`).

1. **Windows DPAPI.** On Windows, the vault is sealed with `ProtectedData` in `CurrentUser` scope. The
   plaintext travels to a hidden, non-interactive PowerShell child over stdin as base64, not in process
   arguments. The result can be opened only by the same Windows user context
   (`src/kit/keystore/backends/dpapi.ts`).
2. **macOS Keychain.** On macOS, one random 256-bit key lives in the login keychain as a generic
   password item (service `bunzai-kit`, account `vault-key`), and the vault is AES-256-GCM under it.
   The key is written through `security -i`, which reads its command from stdin, so it never appears
   in process arguments. The item trusts `/usr/bin/security`, so any process running as the same
   user can read it without a prompt: the same trust level as DPAPI
   (`src/kit/keystore/backends/macos-keychain.ts`, `src/kit/keystore/backends/keychain-key.ts`).
3. **Linux Secret Service.** On Linux with a running keyring (GNOME Keyring, KWallet, KeePassXC), the
   same design through `secret-tool`, which reads the key from stdin. A machine with the tool but no
   running service reports the backend unavailable and falls through to the next one
   (`src/kit/keystore/backends/linux-secret.ts`).

   Making that key is guarded, because a second key replacing the first would strand everything
   sealed under it. Creation runs once per process at a time, and across processes under a lock file
   whose holder writes its own token, refreshes it with a heartbeat, and removes only its own lock. A
   lock whose heartbeat stopped is moved aside by one atomic rename and checked after the move, so a
   fresh lock that replaced it meanwhile is put back rather than taken; the holder re-checks its lock
   just before writing the key. It re-reads before writing and never replaces a stored key
   (`security` without `-U` reports "already exists"). A "key made" marker is kept as a second item
   in the OS store, beside the key, so every Bunzai folder on the machine sees it and wiping the
   keyring clears both. Before a key is made, the marker is written and read back, which proves the
   store is unlocked, and the key is looked up once more, because a locked Linux keyring can answer
   "no key" until that write unlocks it. A store that answers "no key" while the marker exists is
   refused, never given a new key, and the error points to the library's recovery words.

   Both keychain backends are proven against fakes of `security` and `secret-tool` that behave like
   the real tools, record every command, and cover two first-time seals at once, a lock held by
   another process, a stale lock, a lock taken from its holder, a store answering "no key" after one
   was made, a locked store, and a locked store that a write unlocks
   (`src/kit/keystore/keychain-backends.test.ts`). `scripts/probe-keychain.ts` is configured in CI's
   macOS/Linux keychain job to check the real tools. Each invocation uses a fresh
   `bunzai-keychain-probe-*` service for reads, writes, locks, and cleanup; it never uses the
   application's `bunzai-kit` entries. Cleanup attempts both owned entries, reports unexpected
   failure, and removes its temporary home even when cleanup fails. Child-process regressions run
   the actual script against fake OS tools and preserve planted application credentials
   (`scripts/probe-keychain.test.ts`). These tests do not establish a successful native CI run;
   that requires recorded results on the corresponding platform.
4. **Local key file.** The universal fallback, selected wherever no OS-native backend can run. Kit
   generates a 256-bit key on first use and stores it at `~/.bunzai/kit.identity` as a versioned
   104-byte blob with an HMAC integrity check, owner-only mode `0600` where the filesystem supports it.
   The vault is then encrypted with AES-256-GCM under that key. The key is re-read per operation and
   never held in memory, so a file moved or deleted underneath a running Kit is noticed rather than
   silently sealed against a key that no longer exists on disk
   (`src/kit/keystore/backends/identity-file.ts`; `src/kit/keystore/aes.ts`).
5. **Master passphrase.** Derives a 256-bit key with scrypt from a caller-supplied passphrase, using a
   fresh random salt. It reports itself **unavailable** so it is never auto-selected, because nothing in
   Kit collects a passphrase; it stays registered so a vault already sealed with it still opens
   (`src/kit/keystore/backends/passphrase.ts`).

**The local key file is deliberately weaker than DPAPI and is labeled as such.** Its key sits on disk
beside the vault it opens, so any reader of the vault can also read the key. It defends against
exposure - a credential surviving as plaintext in a backup, a synced folder, or a casual scan - not
against an attacker who already holds the user's account. It ranks below every OS-native backend for
exactly that reason, and runs only where none of them can: a macOS or Linux machine without its
keychain tool or service, or any other platform. A vault already sealed by it keeps opening with it,
because opening follows the recorded tag.

Every write verifies its own seal before committing: `writeVault` re-opens the sealed blob and compares
it to the plaintext before renaming over the live vault, so a change of backend between saves fails as
a rejected write rather than silently replacing readable keys with unreadable ones
(`src/kit/providers/vault.ts`).

The Kit settings screen still calls the vault without an `Unlock` and has no passphrase prompt
(`src/kit/render/settings/settings-screen.tsx`); with the local key file in the roster
that is no longer a platform blocker, since selection resolves to a backend needing no input. On any
platform, familiar provider environment variables can supply an active provider without writing it to
the vault at all (`src/kit/providers/config.ts`; `src/kit/providers/vault.ts`).

### Provider egress boundary

HTTP-backed provider spokes use the guarded fetch. A built-in HTTP spoke fixes its provider host; a custom
or local spoke derives one host from the configured base URL. Before the network, Kit rejects an unknown
provider, a missing required key, or a request whose URL host differs from that one allowed host
(`src/kit/providers/egress.ts`; `src/kit/providers/adapters.ts`). Model discovery uses the
same gate.

Native Ollama discovery (`/api/tags`, `/api/show`) and generation (`/api/chat`) use that same configured-host
guard. Metadata reads are capped at 2 MiB, model lists at 512 entries, discovery at four concurrent workers
and an eight-second overall deadline. Cancellation propagates through model resolution. One resolution
supplies both model capabilities and its request's context budget; there is no process-wide metadata cache.
The connection's context choice, capped by a reported positive model limit, owns `options.num_ctx`.
Scene custom body overrides cannot replace or remove it. Missing metadata disables optional tool/thinking
capabilities; malformed native reply records and Kit tool proposals that were not offered are rejected.
These checks do not establish a model's quality, memory requirements or packaged-platform behavior.

A provider credential necessarily travels to that configured endpoint as request authentication. It is
not added to the model conversation, tool observation, session transcript, canonical entity, or export.
The model does receive the conversation and any studio or documentation observations Kit reads to answer
the user's request. `/privacy` records model usage reported to Kit, including provider and token counts,
not request bodies or credentials. It is not a network activity log: connection checks, external tools,
and requests without usage reports are outside it (`src/kit/providers/egress-ledger.ts`).

The redirect rules below apply to requests made through Bunzai's guarded HTTP provider path. The
Claude subscription provider delegates to the external Claude Code CLI, which communicates with
Anthropic itself; Bunzai's HTTP guard cannot inspect or constrain those requests. Its usage counts
come from the CLI's reports (`src/kit/providers/spokes/claude-sub.ts`). Connected MCP subprocesses
also have their own process and network authority; model-usage accounting is not a record of their traffic.

Custom request headers are JSON only. Header text from a scene, or carried in by an imported preset, may not set a header the host owns:
`Authorization`, `Proxy-Authorization`, `X-Api-Key`, `Api-Key`, `X-Goog-Api-Key`, `Anthropic-Version`, `Host`, `Content-Type`,
`Content-Length` and `Cookie`, in any letter case. The list is `PROTECTED_HEADER_KEYS` (`src/stage/params/custom.ts`); it is refused when the
text is saved and again when the request is built (`src/stage/provider/request-overrides.ts`). A connection's own headers, set by the person
in the connection setup, may carry a custom auth scheme; they are merged over the scene's, header names compared without regard to letter case, and win a clash, so scene text can never
override the connection's credential, whatever case it writes the name in.

A link a person types (a backdrop or Mood Music file from a link) has no fixed host, so it has its own door,
`guardedFetchVetted` in `src/kit/providers/egress.ts`: https only, no login in the link, the default port, the name resolved once
and every answer public (loopback, private, link-local, CGNAT, multicast and reserved ranges are refused), the connection pinned to the
address that was vetted so the name is not looked up a second time, every redirect hop vetted the same way, at most three hops, and a
time and size cap. `src/egress-doors.test.ts` fails if any other source file calls `fetch(` or imports `node:https` without a listed reason.

Redirects are followed by hand (`redirect: "manual"`), never by the runtime. Every hop, the first request included, must have the one allowed host
(exact `host` match, so another name and an IP literal both fail), an `http` or `https` scheme, and must not downgrade an `https` chain to `http`. At most five
redirects are followed; the sixth fails. A refused hop throws `EgressBlocked` before that hop is sent, so a credential such as `Authorization` is only ever
sent to the allowed host: there is no cross-host hop to forward it on. A `303`, or a `301`/`302` on a POST, becomes a bodiless GET. The allowlist is the authority:
a local provider whose configured host is itself loopback is allowed to reach it, and nothing else is (`src/kit/providers/egress.ts`; tests in `egress.test.ts`).

### The Spotify link (one more outbound authority)

The Stage wing's Spotify tab controls the person's own Spotify app. It adds a second place the app talks to, and the rules are
fixed in code (`src/ui/spotify/client.ts`, `link.ts`, `routes.ts`):

- **Hosts.** Only `accounts.spotify.com` (the token exchange) and `api.spotify.com` (the Web API). Each has its own `guardedFetch`, so a request to any other host, and a
  redirect to one, is refused before it leaves (`spotifyFetchers`). The page itself cannot reach Spotify: its policy is `connect-src 'self'`, so every call goes through
  the local server. A test names every host a Spotify request reaches, and another proves no source outside `src/ui/spotify/` names a Spotify host.
- **Whose app.** The Client ID is the person's own Spotify app. Bunzai ships no client id and no client secret. Sign-in is OAuth authorization code with PKCE (S256, a
  fresh 64-byte verifier per attempt).
- **The redirect.** Spotify allows a plain http redirect only to a loopback IP literal, never `localhost`; the app uses `http://127.0.0.1:<its own port>/spotify/callback`
  (Spotify's redirect-URI documentation, read 2026-10-12). That route sits outside `/api` because a redirect from accounts.spotify.com is a cross-site navigation the `/api`
  read gate refuses by design. Its only gate is a `state` this app issued: random (32 bytes), single-use, bound to the Client ID it was issued for, and good for ten minutes.
  A callback with any other state exchanges nothing and sends nothing to Spotify. The route answers the trusted loopback listener only, and only for the loopback host.
- **Where the token lives.** The refresh token is sealed in the key vault beside the provider keys (the same `Vault` document, `spotify.refreshToken`; the Client ID rides
  with it) and is never written to a preference, a log, an export, a trace, or anything a model sees. The access token is held in process memory only and refreshed a
  minute before it ends. No route returns either token; the page receives plain playback facts.
- **Who can ask.** `/api/spotify/*` is host-only: a remote or LAN device is refused (`isHostOnlyRoute`), because the sign-in is the owner's Spotify account.
- **Revoking.** Disconnect forgets the sign-in on this computer. Spotify has no call that revokes a refresh token, so taking the app's access away at Spotify is done at
  spotify.com/account/apps.

Not proven: a live sign-in against Spotify (every test mocks the network), and the packaged app's loopback callback. Source and mocked-network proof only.

### Recovery limitations

Vault encryption is intentionally fail-closed once a valid sealed envelope reaches its backend: an
unknown backend tag throws, DPAPI decryption failure throws, and a wrong passphrase or failed GCM
authentication throws (`src/kit/keystore/keystore.ts`; `src/kit/keystore/keystore.test.ts`).
DPAPI also binds recovery to the Windows user context. There is no vault export, recovery-key, backend
migration, or credential-rotation flow today. Losing the Windows profile means re-entering the provider
configuration.

**One documented exception, and only one.** A local key file that is structurally invalid - wrong size,
wrong magic, wrong version, or a failed HMAC - is holding a key that is already unrecoverable, so the
vault sealed under it cannot be opened by any caller, retry, or passphrase. Failing closed there would
protect nothing while leaving the user permanently unable to save a provider. Kit therefore moves the
damaged file aside under a dated `.damaged-*` name, writes a fresh key, moves the now-unopenable vault
aside as `.unopenable-*`, and returns an empty vault carrying a `notice` that names both paths. Neither
file is deleted, so recovery from the original bytes remains possible, and the settings screen surfaces
the notice rather than showing an unexplained empty list
(`src/kit/keystore/backends/identity-file.ts`; `src/kit/providers/vault.ts`;
`src/kit/providers/vault-recovery.test.ts`).

This applies to structural damage only. An I/O failure such as a permissions error or a disconnected
mount may succeed on retry, so it is surfaced rather than treated as damage - replacing a key because a
volume was briefly unreadable would cause exactly the loss this is meant to avoid. Any other unopenable
vault, including tampered ciphertext under a healthy key or a vault from another Windows profile, still
throws and is left untouched on disk.

Only `ENOENT` reads as an absent vault. Other filesystem errors, malformed outer JSON, and invalid
sealed envelopes reject the read. Malformed decrypted provider lists, Spotify fields, active ids,
and unknown plaintext fields are refused instead of being filtered out. A later save crosses the
same read boundary and cannot replace that failed read with an empty successful vault
(`src/kit/providers/vault.ts`; `src/kit/providers/vault-recovery.test.ts`).

The decrypted cache and cross-process write-conflict behavior are unchanged by these checks. They
do not establish protection against a different process changing an already cached vault. Legacy
saved recovery notices are accepted as strings; the current notice is derived from this process's
recovery state.

## The loopback server (shipping)

The visual app runs a local server bound to `127.0.0.1` only: `Bun.serve({ port, hostname: "127.0.0.1",
... })` (`startUi` in `src/ui/server.ts`). It is a thin shell over the same engine the CLI uses. Nothing in an
uploaded entity is ever evaluated server-side; scripts inside cards are data
(the header comment of `src/ui/server.ts`).

### The per-launch bearer

A fresh bearer token is minted once per launch: `randomBytes(32).toString("base64url")`, created in
`createSecurityContext` and marked "never log or persist" (`createSecurityContext` in `src/ui/server-security.ts`). It is
injected into served HTML as an escaped `<meta name="vaude-session">` tag by `injectSessionMeta`
(`src/ui/server-security.ts`), which the trusted UI reads to authenticate its own API calls. The
token stays in that meta tag and the trusted `apiFetch` path; it is never handed to the sandbox origin
(see below, and `src/ui/sandbox-host.ts`). The bearer-bearing index document is not
itself bearer-gated; the default listener's loopback bind is what limits which machines can fetch it.

### The /api/* gate

Every `/api/*` route runs through `checkApiRequest` before any handler
(`createHandler` in `src/ui/server.ts`, definition `checkApiRequest` in `src/ui/server-security.ts`). The gate is scoped to
`/api/*`. JavaScript, wasm, CSS, and icons are non-secret assets and serve without this gate. `/` and
`/index.html` also serve without it, but they are a different case: `createHandler` injects the
per-launch bearer into that HTML before returning it (`createHandler` in `src/ui/server.ts`). The default
listener therefore relies on its `127.0.0.1` bind to keep the token-bearing shell off other machines.
Any local process or other client that can reach that listener can fetch the HTML and read its bearer;
the bearer is not an authentication gate for the page that contains it.

`checkApiRequest` enforces, in order:

1. **Fail closed before bind.** If the expected Host, expected Origin, or token is not yet filled in, it
   returns `503` (`checkApiRequest`).
2. **Host on every method.** `hostAllowed` accepts an exact `host:port` match, or a loopback-equivalent
   spelling (`127.0.0.1`, `localhost`, `[::1]`) **on the same port**; anything else returns `403`
   (`hostAllowed`, `checkApiRequest`). This is the DNS-rebinding defense: it rejects requests
   whose Host is an attacker-controlled hostname resolved to loopback.
3. **GET and HEAD carry no token.** An `<img src>` sends no custom headers, so demanding a token on reads
   would leave any page the person has open, including one on another 127.0.0.1 port, able to fire blind
   requests (image-load and timing oracles for what exists; there are no CORS headers, so a foreign page
   cannot read the body). Instead these methods pass only when the browser-set `Sec-Fetch-Site` is
   `same-origin` (the app's own fetches) or `none` (the address bar); `cross-site`, `same-site` and any
   unrecognised value get `403`. The sandbox origin gets no exception because it never calls `/api`
   (ADR-009). A request with no `Sec-Fetch-Site` is a CLI or test client and passes, except on the
   loopback listener, where one carrying a `Mozilla/` User-Agent is refused too (`refuseForeignRead`).
4. **POST and PATCH demand Origin and token.** The Origin must be loopback-equivalent to the expected origin, and
   a null Origin fails closed (`originAllowed`, `checkApiRequest`). The token is
   compared with `crypto.timingSafeEqual` in constant time, and a zero-length token compares false
   (`tokensEqual`, `checkApiRequest`).
5. Any other method returns `405` (`checkApiRequest`).

### What the gate does not do

Stated plainly, because overclaiming here would be a defect:

- **`localhost` and `[::1]` on the correct port are accepted, not rejected.** Only a wrong port or a
  foreign hostname fails closed (`LOOPBACK_NAMES`, `hostAllowed`). The code's own reasoning: all three
  loopback spellings resolve to the same bound interface, so rejecting `localhost` would paper-cut a user
  with a bookmark while protecting nothing. The gate stops attacker hostnames, not loopback aliases
  (`docs/decisions/ADR-009-sandbox-origin.md`).
- **GET and HEAD are not token-gated.** A header-less client that is not a browser (curl, a CLI, a test) sends no
  `Sec-Fetch-Site` and passes the read gate (`refuseForeignRead`). The read gate is
  deliberately weaker than the mutation gate. Reads that expose entity data rely on the loopback bind and
  the foreign-page refusal, not on the bearer.

### Body caps

Request bodies are streamed with a hard byte cap and a `413` on overflow: `INSPECT_BODY_MAX` is 64MB,
`JSON_BODY_MAX_BYTES` is 32MB (`src/core/media/limits.ts`). `readBodyCapped` (`src/ui/server-security.ts`) checks `Content-Length`
early when present and also enforces a running total as it reads, so a lying or absent length header
still cannot exceed the cap (`readBodyCapped`). This is the same fail-closed posture
the upload adapters use against zip bombs.

## The sandbox origin (shipping code, packaged proof BLOCKED)

Untrusted Lua from the Risu Test Bench runs in a Worker served from a **second** loopback listener on an
ephemeral port, which is a distinct origin from the UI and `/api/*`
(`src/ui/sandbox-host.ts`; `docs/decisions/ADR-009-sandbox-origin.md`). This is
defense-in-depth: a same-origin Worker is a killable thread, not an origin boundary, so if a future
WebView or bundler bug exposed web capabilities, same-origin placement would widen the blast radius
(`docs/decisions/ADR-009-sandbox-origin.md`).

The sandbox host fails closed by construction:

- It serves only `/sandbox/worker.js`, `/sandbox/regex-worker.js`, and `/sandbox/glue.wasm`; every other path returns a `404` with a
  locked-down CSP (`SANDBOX_ALLOWLIST`, `deny`, `src/ui/sandbox-host.ts`). No `/api`, no
  index HTML, no session token, no traversal aliases.
- CORS is limited to the exact UI origin (plus its loopback aliases) so only the trusted UI can construct
  the cross-origin module Worker (`src/ui/sandbox-host.ts`).
- The API token is never injected into anything this host serves
  (`src/ui/sandbox-host.ts`; `docs/decisions/ADR-009-sandbox-origin.md`).

### What is proven, and what is not

This is scaffolding additive to the token (Plan 005) and the sandbox resource quotas (Plan 016), not a
replacement for them (`docs/decisions/ADR-009-sandbox-origin.md`).

- **Proven:** the allowlist, CORS behavior, value-only wire protocol, API denial, and token absence are
  covered by automated Bun tests at the HTTP and handler layer
  (`docs/decisions/ADR-009-sandbox-origin.md`).
- **Not measured:** packaged WebView2 origin isolation. Whether the installed WebView collapses the two
  loopback authorities, whether `crossOriginIsolated` and storage stay separate, and whether a
  credentialed API fetch from the sandbox origin is actually blocked in the packaged host are all
  unmeasured. Plan 017 is **BLOCKED** for its full done criteria until a WebView2 smoke matrix records
  those results (`docs/decisions/ADR-009-sandbox-origin.md`).

Do not describe the sandbox as fully isolated, fully sandboxed, or exploit-proof. Until the packaged
matrix is green, it is defense-in-depth scaffolding whose HTTP-layer behavior is tested and whose
in-WebView authority separation is not. If the sandbox listener fails to bind, the UI falls back to a
same-origin Worker, which is explicitly degraded and not claimed isolated
(`startUi` in `src/ui/server.ts`; `docs/decisions/ADR-009-sandbox-origin.md`).
