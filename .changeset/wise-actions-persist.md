---
"@vitest-agent/plugin": minor
---

## Features

* Coverage-config validation warnings now appear as suggested actions in the rendered report
* Stray output captured during a run is persisted for triage, history and status

## Bug Fixes

* The GitHub step summary, `::group::` log block and annotations are now decided by whether the run is in GitHub Actions, not by the console audience, so an agent running inside Actions keeps them
