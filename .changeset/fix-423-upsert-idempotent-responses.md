---
"@vitest-agent/engine": patch
---

## Bug Fixes

* Fixed `DataStore.recordIdempotentResponse` inserting with `ON CONFLICT DO NOTHING`, which left a corrupt cached row in place forever — a corrupt row now gets replaced by the handler's fresh result on retry instead of causing every subsequent call to re-execute the write tool
