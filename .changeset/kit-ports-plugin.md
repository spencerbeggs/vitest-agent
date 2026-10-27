---
"@vitest-agent/plugin": major
---

## Breaking Changes

* Removed the `WalkerFileSystem`, `WalkerEntry`, `WalkerEntryStat` and `nodeWalkerFs` exports. The filesystem port for discovery is now `WalkerSyncOps` from `@effected/walker`, exported as a type from this package. Custom discovery strategies and tests that injected a `WalkerFileSystem` must supply `WalkerSyncOps` instead.
* Symlinked directories are no longer entered during discovery unless they are followed explicitly.
* `runScript` no longer skips a command because an earlier process finished it within the last 30 seconds. Set `VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` to opt back into that window. The lock is now keyed on the workspace root plus the command.
* The `@vitest/coverage-v8` and `@vitest/coverage-istanbul` peers are now optional, so installing only the provider you use no longer warns.

## Bug Fixes

* Test globs are matched with `GlobPattern`, so brace patterns such as `{a,b}` now match correctly.
* Discovery walks no longer fail with `ELOOP` on symlink cycles.
* `runScript` runs through `RunOnce.commandSync` and, on Windows, spawns `cmd.exe /d /s /c "<cmd>"` verbatim so quoting is preserved.
