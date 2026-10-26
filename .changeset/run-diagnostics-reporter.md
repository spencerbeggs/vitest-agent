---
"@vitest-agent/reporter": minor
---

## Features

* `run.json` written by `DefaultVitestAgentReporter` now includes `runDiagnostics` (performance hints, post-run timing, persistence status) (#544)
* In `stream` mode the suggested-actions block, including diagnostic actions, is printed once after the live view closes at Vitest's close, rather than inside the live frame
