---
"@vitest-agent/engine": major
---

## Breaking Changes

* `SessionEnvFileSystem.readFile` now returns a `Uint8Array` of bytes instead of a string. Custom implementations of the port must return bytes; callers decode them as needed.
* The host metadata probe moved here from `@vitest-agent/sdk` and is exported as `probeHostMetadataFromEnv` (#548). Replace imports of the sdk's `probeHostMetadata` with it.
* Removed `parseSessionEnvExports`; session-env files are parsed as bytes through `ShellExports` from `@effected/env`.
* `formatFatalError` is now exported from the engine (removed from the sdk) and renders through `CliFailure`.

## Features

* Exports the `RegistryStore` and `SessionMapStore` keyed stores.

## Bug Fixes

* Settings environment-variable rows are now written correctly by `DataStoreLive.writeSettings`.
* Session-env files containing non-ASCII characters, as produced by macOS bash 3.2 `printf %q`, now decode correctly.
* SQLite pragmas are applied on every connection, not just the first.
* Project discovery no longer fails with `ELOOP` when a symlink points back at an ancestor directory.
* Log-level parsing rejects prototype keys such as `__proto__` instead of resolving them.

## Refactoring

* Git state, `package.json` reads and test discovery go through the `@effected` kit (`@effected/git`, `@effected/package-json`, `@effected/walker`).
