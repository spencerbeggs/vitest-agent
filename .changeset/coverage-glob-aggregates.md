---
"@vitest-agent/sdk": minor
"@vitest-agent/plugin": minor
"@vitest-agent/ui": minor
---

## Features

* The coverage report gains an optional `globShortfalls` field listing each threshold glob whose aggregate coverage (summed covered over total across the files it matches, as Vitest evaluates it) is below its metric numbers, even when every matched file passes an object `perFile`. The agent view lists each shortfall under "Glob aggregates below threshold". Shortfalls are not persisted to SQLite and are never reported on scoped runs.
