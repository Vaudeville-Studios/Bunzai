# Owned Chrome startup readiness

The unchanged public Linux suite failed at the old fixed 2.5-second CDP attach in
manual runs 41294103064 and 41295707733. In the latter run, the separately owned
fresh-profile probe observed the child's DevTools announcement after 2.391 seconds
and nonce-matched CDP readiness after 4.423 seconds. The probe and public profiles
were different; this supports replacing the startup guess, rather than claiming
that one observed delay explains every previous failure.

`scripts/theme-measure/driver.ts` remains the launch owner. It keeps the manual
Chrome flags and caller port, creates a fresh owned profile, and accepts only a
complete loopback DevTools websocket announcement from that child's bounded
stderr. A 20-second monotonic budget covers announcement and connection attempts.
An outer deadline also bounds a connector that ignores its timeout; a late
connection is disposed. Startup failure closes the connection and owned child.
Inherited stderr that remains open after the child exits is an explicit cleanup
failure, and the owned stream is released. Profile removal verifies the fresh
absolute path beneath the canonical work directory.

The manual diagnostic's existing Chrome shim now relays its bounded captured
stderr to the parent, so the production owner receives the real announcement.
A broken parent pipe stops the owned browser and remains nonpassing. No browser
flags, authentication, release gates, or sandbox policy changed.

Windows actual public proof: the unchanged
`src/ui/shell/protected-browser.test.ts` passed 9 tests and 33 assertions, exit 0,
signal null, under Bun 1.4.2 (744846f84), Node 22.20.0, installed Chrome and a fresh
task-only profile. The wrapper carried `THEME_MEASURE_PORT_OFFSET=14000`; port
23591 was checked unused before startup. This is headless Windows source evidence,
not packaged or Linux proof. Linux proof will use the exact reviewed validation
commit through the existing manual workflow before Mainstage delivery.

The final driver and test files passed focused TypeScript checking with strict
types and noUncheckedIndexedAccess. YAML parsed and its extracted Python compiled.
The existing five exact-workflow argv/cap/cleanup checks passed. Two added real
pipe checks proved exact nonce stderr forwarding and nonzero, clean owned shutdown
when the parent closes its pipe. Temporary protocol evidence is under
`/tmp/codex-browser-capture-v2-uidyee4g` and
`/tmp/codex-browser-tee-9azu8f56` (task-owned, not repository artifacts).

The new real-child tests cover delayed readiness beyond 2.5 seconds, split lines,
unexpected endpoint rejection, bounded diagnostic retention, early exit, connection
after child exit, missing announcement, an unresponsive connector, late connector
disposal, unavailable executables, and descendant-held stderr. The inherited-stream
case runs an actual Node parent because Bun's child close event differs on Windows;
the fixture descendant is explicitly detached and killed only by its recorded PID.
The full final owner suite passed 17 tests and 81 assertions, exit 0/signal null
(71.43 seconds, including three real 20-second timeout exercises). A subsequent
test-only cleanup correction buffers the descendant PID through its complete line
and adds explicit probe watchdogs; its actual Node regression passed 1 test and
3 assertions, and focused strict TypeScript checking passed again. The final
production source's Windows public rerun also passed 9/33 (19.62 seconds).

Independent review caught and required the outer connector deadline, late-resource
disposal, inherited-stream cleanup failure, and exact complete-line fixture PID
ownership. Reviewer `extension_plan_review` approved the final source and fixture
correction for the validation branch. This approval does not establish Linux or
full-release readiness; those remain separate gates.

Root independently inspected the final lifecycle, endpoint and profile changes,
ran combined whole-project typecheck under Bun 1.4.2 (exit 0/signal null), and
reran three real-child checks (split endpoint, early failure and ignored-timeout
child exit): 3 passed, 7 assertions. Root approved the combined runtime/startup
commit for the validation branch, with Mainstage gated on the exact Linux result.
