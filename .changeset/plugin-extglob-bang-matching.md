---
"@vitest-agent/plugin": patch
---

## Bug Fixes

Coverage-threshold keys and `test.include` patterns that start with `!(` now match the way Vitest's picomatch does. A leading `!(` is read as an extglob, so `!(src)/**` selects files outside `src` instead of being treated as a negation of the whole pattern. A threshold key of that shape now selects different files than before, so check any `coverage.thresholds` key that begins with `!(`.
