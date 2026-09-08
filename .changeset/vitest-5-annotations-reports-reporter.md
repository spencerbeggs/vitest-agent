---
"@vitest-agent/reporter": minor
---

## Features

The default reporter now writes `run.json` and `summary.md` report files whenever the plugin's report option is on.

## Bug Fixes

The summary now always starts with a Totals table (Project / Passed / Failed / Timed out / Skipped / Duration), so a green run no longer renders a blank GitHub Actions job summary — a gap left by Phase 1's job-summary change, where Vitest's own counts were relied on and stopped appearing once report files took over emitting the summary body.
