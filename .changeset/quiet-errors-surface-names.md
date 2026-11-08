---
"@vitest-agent/engine": minor
---

## Features

* Re-exports the `ConfigCodecError` and `ConfigReadError` types from the root entry, so dependents can name the errors `PlatformLive` can fail with without depending on `@effected/config-file` themselves.
