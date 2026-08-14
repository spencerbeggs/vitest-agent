---
"@vitest-agent/ui": patch
---

## Bug Fixes

- A run whose only non-passing signal was one or more timed-out tests was previously classified as all-pass. `classifyOutcome` now routes any `timeoutCount > 0` to `some-fail` (real failures still take precedence), and headers/totals fold "N timed out" into the printed counts wherever they're shown (#224).
