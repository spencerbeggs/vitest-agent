---
"@vitest-agent/plugin": major
---

## Breaking Changes

* Removed the `WalkerFileSystem`, `WalkerEntry`, `WalkerEntryStat` and `nodeWalkerFs` exports. The filesystem port for discovery is now `WalkerSyncOps` from `@effected/walker`, exported as a type from this package. Custom discovery strategies and tests that injected a `WalkerFileSystem` must supply `WalkerSyncOps` instead.
* Discovery now follows symlinked directories and files, which the former walker skipped, so a linked test directory is collected. A link back to an ancestor directory is skipped by the walker's cycle guard.
* `runScript` no longer skips a command because an earlier process finished it within the last 30 seconds. Set `VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` to opt back into that window.
* The `@vitest/coverage-v8` and `@vitest/coverage-istanbul` peers are now optional, so installing only the provider you use no longer warns.

## Bug Fixes

* Test globs are matched with `GlobPattern`, so brace patterns such as `{a,b}` now match correctly.
* `runScript` runs through `RunOnce.commandSync` and, on Windows, spawns `cmd.exe /d /s /c "<cmd>"` verbatim so quoting is preserved.
