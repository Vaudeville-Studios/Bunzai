# Fail-fast verification fixture

Date: 2026-11-01. Pinned Bun: 1.3.14. This is a task-local package fixture in
`C:/Users/chiev/AppData/Local/Temp/codex-verify-bail-8ab9300b56dd4dfaa2e46597e299838f`;
it is not part of source discovery or the product test suite.

The only product change replaces `bun run test &&` with
`bun run test --bail=1 &&` in `package.json`'s `verify:ci` value. The `test` script,
test selection, timeout, subsequent commands and gate order remain unchanged.

The fixture's passing case ran `bun run verify:ci`, exited 0, and logged both
tests (`first`, `second`) followed by the post-test command (`post`). Bun printed
the nested command as:

```text
$ bun test ./tests --timeout 5000 "--bail=1"
```

The deliberate-failure case used the same command and exited 1. Its log contained
only `failed-test-ran`; `later-test-ran` and `post` were absent. The nested command
still contained `--bail=1`. This confirms argument forwarding, that all tests and
later commands run after success, and that a test failure stops the runner and
the `&&` chain.

An initial fixture invocation mistakenly supplied `--cwd` as a Bun argument,
which started the repository's `verify:ci` at typecheck. That owned process was
immediately interrupted and process inspection confirmed no matching runner
remained. It is recorded as an interrupted attempt, not a passing or failing gate
result. No full repository suite was run for this change.
