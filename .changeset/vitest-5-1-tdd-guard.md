---
"@vitest-agent/ai-plugins": patch
---

## Bug Fixes

- The tdd-task Bash guard also denies a bare trailing `--bail` (accepted by Vitest 5.1 as `--bail=1`) and the `--last-failed` / `--lastFailed` and `--since-last-run` / `--sinceLastRun` rerun flags, which would let an agent mistake a narrowed run for the whole suite.
