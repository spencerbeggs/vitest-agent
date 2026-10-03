---
"@vitest-agent/ui": patch
---

## Refactoring

`renderAgent` now formats each failure through the dispatcher's shared `formatFailure` helper instead of its own copy. Output is unchanged.
