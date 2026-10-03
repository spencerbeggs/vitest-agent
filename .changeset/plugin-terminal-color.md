---
"@vitest-agent/plugin": patch
---

## Bug Fixes

The reporter now decides colour from `@effected/env`'s terminal rule instead of `NO_COLOR` alone, so `FORCE_COLOR`, `NODE_DISABLE_COLORS`, `TERM=dumb` and a non-TTY stdout are honoured the same way the CLI honours them.
