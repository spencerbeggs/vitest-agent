---
"@vitest-agent/plugin": minor
---

## Features

* The reporter applies the run-retention policy at the end of its persist transaction, after the run's own rows are written: by default the newest 200 runs per project are kept and older ones are pruned from `data.db`, so the database no longer grows without bound. Configure it in `vitest-agent.config.toml` under `[retention]` (`keepRuns`, `maxAgeDays`, `enabled = false` to turn it off). A prune failure is logged and never fails the run's persistence.
