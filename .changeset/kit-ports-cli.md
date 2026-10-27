---
"@vitest-agent/cli": patch
---

## Bug Fixes

* Flag defaults are computed when a command runs rather than at import time.

## Refactoring

* Version ranges, the version string and failures render through the kit's `Fmt`, version and failure helpers.
* Vitest config filenames come from the shared list in `@vitest-agent/sdk`.
