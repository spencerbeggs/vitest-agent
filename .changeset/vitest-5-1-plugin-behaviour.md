---
"@vitest-agent/plugin": minor
---

## Bug Fixes

- Runs started with `--last-failed` or `--since-last-run` are treated as partial runs, so coverage thresholds are not scored against the subset and no baseline or trend is written. In watch mode only the first run counts, matching how Vitest narrows it.
- `test_cases.retry_count` and `repeat_count`, and `test_history.retry_count`, now record Vitest's real counts instead of 0.
- Live events, history and timeout tallies use the error of the attempt that decided the outcome; a test that passed on a retry no longer reports an earlier attempt's error.
- `failure_signatures.occurrence_count` counts once per distinct signature per failed test per run, so retries no longer inflate it. Tests that pass on a retry keep the signature hash on their error rows without adding to the count.
