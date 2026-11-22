---
"@vitest-agent/plugin": minor
---

## Features

- The reporter reads the one `internal:browserTrace` artifact (Vitest 5.1 `experimental.traceTimeline`) of a failed test's deciding attempt, normalises its steps defensively, persists them to `test_trace_steps`, and attaches them to the failure it renders. The artifact stays out of `test_artifacts`, and a malformed artifact never breaks persistence or rendering.
