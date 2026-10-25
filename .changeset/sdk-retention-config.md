---
"@vitest-agent/sdk": minor
---

## Features

* `VitestAgentConfig` gains an optional `retention` table (`RetentionConfig`): `enabled`, `keepRuns` and `maxAgeDays`, the latter two positive integers.
* `RunRetentionPolicy` — the resolved policy a `data.db` prune applies, with `RunRetentionPolicy.fromConfig(config)` (the default of `DEFAULT_KEEP_RUNS = 200` newest runs per project when the table is absent; `Option.none()` when `enabled = false`).
