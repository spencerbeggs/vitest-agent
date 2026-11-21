---
"@vitest-agent/ui": patch
---

## Bug Fixes

- `synthesizeRunEvents` takes each test's error and timeout flag from the attempt that decided its outcome, matching the plugin's live events: a test retried after a timeout and then failing on an assertion is no longer marked as timed out, and a test that passed on a retry carries no error.
