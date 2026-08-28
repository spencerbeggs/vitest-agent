---
"@vitest-agent/mcp": patch
---

## Refactoring

* Replace the `run_tests` in-process Promise-chain lock with an Effect semaphore to keep concurrent test invocations serialized with native v4 synchronization primitives.
