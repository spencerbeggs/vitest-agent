---
"@vitest-agent/sdk": patch
---

## Bug Fixes

* Replaced the regex-based comment stripper in `detectNonDefaultDiscoverStrategy` with a single-pass scanner, closing the CodeQL polynomial-ReDoS finding on config sources containing many `)/**` repetitions
