---
"@vitest-agent/cli": minor
---

## Features

* `vitest-agent db prune` now also applies the run-retention policy: `--keep-runs N` keeps the newest N runs per project and `--max-age-days D` drops runs older than D days, each overriding the matching `[retention]` field of `vitest-agent.config.toml`; with neither flag the configured policy applies (default: keep the newest 200 runs per project), and a flag re-enables a table set to `enabled = false`. The session-turn prune (`--keep-recent`) is unchanged. After pruning, the command runs `PRAGMA wal_checkpoint(TRUNCATE)` so the freed pages reach the main file at once.
