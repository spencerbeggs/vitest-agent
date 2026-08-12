---
"@vitest-agent/plugin": minor
---

## Features

### Render survives a persistence failure

When database persistence (or its startup migration) fails, `AgentReporter` now still renders test results to the console instead of aborting the run with no output at all. A follow-up stderr line makes clear the results shown were **not** recorded to history — `vitest-agent: persistence failed — results above were rendered but NOT recorded: <reason>` — so it's never ambiguous whether a shown result also landed in the database.

### Nested `__test__/` directory discovery

Test discovery now recognizes `__test__/` directories anywhere in a package tree, not only at the project root next to `src/` — for example `lib/scripts/__test__/`. A package-boundary walker keeps the broader scan from re-entering a nested package's own tests or a fixture's `node_modules`.

## Bug Fixes

* Per-project test run reason: one failing project's tests no longer mark every other project's row as "failed" in a multi-project run — each project's persisted run reason is now derived from that project's own results
* `stringifyFailureValue` no longer throws when a value's own `String()` conversion throws
