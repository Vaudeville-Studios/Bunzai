# DOM teardown counterexample

Date: 2026-11-01. Checkout: `2307cd6`, Bun 1.3.14. All tests ran through
`C:/Users/chiev/AppData/Local/Temp/codex-bunzai-repair-run.ts`, which assigns a
task-owned profile and clears inherited provider/account variables.

## Helper-level result

The temporary test `C:/Users/chiev/AppData/Local/Temp/codex-dom-teardown-probe-20261101.test.ts`
installs DOM A, calls `a.teardown()` without awaiting, installs DOM B, waits six
`setImmediate` turns, then checks that `globalThis.document` is B's document and
`IS_REACT_ACT_ENVIRONMENT` is B's value. It fails: both observations are false.
The paired control awaits A teardown before installing B and passes (1 test, 2
assertions).

This matches `src/ui/_shared/test-dom.ts:102-110`: teardown removes itself from
the live set, drains three macrotasks, closes its JSDOM, then restores the global
descriptors captured before installation.

## Actual callsite inventory

Only these `installDom` test owners discard the teardown promise inside a block
callback:

- `src/ui/components/light-rays/light-rays.test.tsx:25`
- `src/ui/apps/settings/room.test.tsx:29`
- `src/ui/apps/scenes/messenger/shell/shell-actions.test.tsx:30`

Callbacks shaped as `afterAll(() => installed.teardown())` return the promise;
async callbacks with `await`, and callbacks explicitly returning teardown are
also awaited. They are not discarded callsites. This inventory excludes the
separate OpenTUI render helper.

## Bounded real-pair status

Command:

```powershell
& 'C:\Users\chiev\AppData\Local\Temp\codex-bun-windows-1.3.14-20261101\bun-windows-x64\bun.exe' 'C:\Users\chiev\AppData\Local\Temp\codex-bunzai-repair-run.ts' test ./src/ui/components/light-rays/light-rays.test.tsx ./src/ui/components/ink-dialog/index.test.tsx --timeout 120000
```

The pair passed 16 tests / 32 assertions on three consecutive reruns. Therefore
the helper-level race is confirmed, but this named pair did not reproduce it in
the current isolated runner and is not evidence of a deterministic public-pair
failure. At that checkpoint, the public-pair reproduction remained open. Root
later authorized the narrow three-caller repair based on the helper-level race
and the confirmed discarded promises; this does not attribute the full UI/Kit
failure cascade to this pair.

Kit counterexample status remains separate: `app.test.tsx` plus
`app-layout.test.tsx` passed 20 tests / 54 assertions; no Kit act change is
justified by this DOM result.

## Approved caller repair check

Plan 007 authorizes the three discarded teardown callers above to await cleanup;
the asynchronous three-immediate drain in `test-dom.ts` remains unchanged. After
that repair, one isolated Bun invocation ran all three callers, both DOM helper
suites, the formerly paired ink-dialog suite, and representative virtual-list,
Workbench lore, Scenes lore, and Kit app/layout suites:

```powershell
& 'C:\Users\chiev\AppData\Local\Temp\codex-bun-windows-1.3.14-20261101\bun-windows-x64\bun.exe' 'C:\Users\chiev\AppData\Local\Temp\codex-bunzai-repair-run.ts' test ./src/ui/components/light-rays/light-rays.test.tsx ./src/ui/apps/settings/room.test.tsx ./src/ui/apps/scenes/messenger/shell/shell-actions.test.tsx ./src/ui/_shared/test-dom.test.ts ./src/ui/_shared/test-dom-teardown.test.ts ./src/ui/components/ink-dialog/index.test.tsx ./src/ui/_shared/virtual-list/core.test.tsx ./src/ui/apps/workbench/lore/rehearsal-pane.test.tsx ./src/ui/apps/scenes/scene-lore-wing.test.tsx ./src/kit/render/app.test.tsx ./src/kit/render/app-layout.test.tsx --timeout 120000
```

Result: 105 tests passed, 0 failed, 311 assertions, 24.27 seconds. The existing
React warning about an invalid `className` prop on a `<small>` in the shell-actions
suite remains visible; it was not suppressed and did not fail this bounded run.
This targeted result does not explain the full 1,253-case release snapshot.
