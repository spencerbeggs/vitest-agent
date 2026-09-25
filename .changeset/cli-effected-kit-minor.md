---
"@vitest-agent/cli": minor
---

## Features

* The CLI now runs on `@effected/cli`'s `CliRuntime.main` and `CliColor`, replacing the previous hand-rolled entry point.
* `--version` now prints `vitest-agent X.Y.Z` (the leading `v` is dropped) and, when launched through the `@vitest-agent/plugin` carrier, appends ` via @vitest-agent/plugin <version>`.
* `main(options?)` accepts a `MainOptions` object for programmatic invocation.

## Breaking Changes

* Usage and parse errors now exit with code `64` instead of `1`, matching the BSD `sysexits.h` convention (`EX_USAGE`).
* Platform-level failures are now reported as a single stderr line instead of a multi-line dump.
