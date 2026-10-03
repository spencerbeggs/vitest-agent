---
"@vitest-agent/ui": minor
---

## Bug Fixes

* A project run is no longer mislabeled as a single file. The run shape is now classified on the number of modules that ran (`collectedModules`) rather than the modules that produced events, so a project run where one file fails renders the project headline with `across N files` instead of one file's path carrying the project-wide totals.
* A failing `beforeAll` or `afterAll` hook in a file that loaded and collected tests is no longer reported as "test suite failed to load". It is labeled "test suite failed"; the load label is kept for files that collected nothing (import errors, top-level throws).

## Features

* Added the `SUITE_FAILURE_LABEL` export, the synthetic test name used for a suite-level failure in a module that collected tests. `SUITE_LOAD_FAILURE_LABEL` is unchanged.
