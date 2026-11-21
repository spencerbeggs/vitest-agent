---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- The `why-flaky` prompt notes that fake timers patch `node:timers` and `node:timers/promises` only with `vi.useFakeTimers({ fakeNodeBuiltins: true })`, names the `hypothesis` tool instead of the removed `hypothesis_record`, and explains that `occurrenceCount: 0` marks a signature seen only on attempts that later passed.
- The `failure_signature_get` `occurrenceCount` description now says it counts failed-test occurrences once per test per run and excludes sightings on tests that passed on a retry.
