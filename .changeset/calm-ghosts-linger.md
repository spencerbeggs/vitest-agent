---
"@vitest-agent/engine": major
---

## Breaking Changes

Service shapes widen for the features below, which breaks any consumer that implements them by hand (the `Layer.succeed(EnvironmentDetector, ...)` or `DataReader` stub pattern `./testing` encourages): `EnvironmentDetector` gains a required `ci` member, `DataReader` a required `getStrayOutputHistory`, `ProjectRunSummary` a required `strayOutput`, and `ProjectIdentity.resolve` can now fail with `ProjectIdentitySourceError`. Add the members to your implementation or build on the shipped test layers.

## Features

### Stray output persistence

Each test run now records the stray output it captured. Migration `0004_stray_output` adds five nullable `stray_*` columns to `test_runs`, so existing databases upgrade in place.

* `TestRunInput.strayOutput` carries the capture into `DataStore`
* `ProjectRunSummary.strayOutput` is now a required field on run summaries
* `DataReader.getStrayOutputHistory` reads the per-run history
* The triage brief gains a stray-output line

### CI detection

`EnvironmentDetector` gains a `ci` member that reports whether the process is running in CI, independent of the console audience.

## Bug Fixes

* `ProjectIdentity.resolve` now fails with `ProjectIdentitySourceError` when the config file is malformed or unreadable, instead of silently falling back to the default identity
