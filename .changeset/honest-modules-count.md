---
"@vitest-agent/ui": minor
---

## Features

* New "0 tests collected" warning when a run reports zero passed/failed/skipped/timed-out tests — flags a likely misconfiguration (wrong working directory, a filter that matched nothing, a load-time error) instead of rendering a silent, uninformative pass
* The totals line now appends "across N files" when the collected module count is known

## Bug Fixes

* Module counts ("N modules all-passed") now read from the true collected-module count instead of `moduleOrder.length`, which only tracks failing modules — a fully green report replay no longer misreports as "0 modules all-passed"
* The zero-test guard now accounts for timed-out tests, so a run whose only test timed out no longer prints "0 tests collected"
