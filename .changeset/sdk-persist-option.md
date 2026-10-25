---
"@vitest-agent/sdk": minor
---

## Features

### `persist` option and `ResolvedReporterConfig.persist`

* `AgentPluginOptions` gains `persist?: boolean` (default `true`): the explicit opt-out of SQLite persistence for a runner where nothing reads `data.db` back. Its TSDoc spells out what still happens with persistence off (every render, every `RunEvent`, Vitest's own threshold enforcement), what is skipped (run rows, test cases, history, coverage rows, trends, baselines), that classifications are empty and coverage carries no baseline delta without history, that `VITEST_AGENT_PERSIST` overrides it either way, and that `coverage.enabled: false` already skips persistence (UI-only mode).
* `ResolvedReporterConfig` gains an optional `persist` field so a custom reporter can tell a recorded run from an unrecorded one. The plugin always populates it; treat an absent value as `true`.
