---
"@vitest-agent/plugin": major
---

## Breaking Changes

### Requires Vitest 5

The `vitest`, `@vitest/coverage-v8`, and `@vitest/coverage-istanbul` peer
ranges move to `^5.0.0`. Vitest 4 is no longer supported. Vitest 5 also
declares `vite` as a required peer dependency rather than a regular one,
so a project that never installed `vite` explicitly now must. Vitest 5
accepts vite 6.4 or newer — 6, 7, or 8 all work.

```bash
npm install -D vitest@^5 vite @vitest/coverage-v8@^5
```

### `TagOptions` no longer accepts `sequential`

`TagOptions` is `Omit<TestTagDefinition, "name">`, and Vitest 5 removed
the `sequential` test option, so `Tag.make("slow", { sequential: true })`
is now a type error. `timeout` and `retry` are unaffected, and the
built-in tag definitions never used `sequential`.

### `COVERAGE_AUTOUPDATE` functions take two arguments

Vitest 5 calls `coverage.thresholds.autoUpdate` with
`(newThreshold, previousThreshold)`. All three tolerance functions now
declare both parameters. `standard` and `strict` behave exactly as
before. `lenient` now uses the second argument as a floor: it still
floors the new value and subtracts a two-point buffer, but never returns
a value below the previous threshold, so a temporary coverage dip cannot
ratchet the configured floor downward.

### Test history resets for parameterised titles

Vitest 5 renders interpolated `test.each` / `test.for` titles through
`pretty-format` instead of `loupe` and drops the quotes around
interpolated strings, and it truncates each interpolated value at 40
characters. Test history, failure classification, and trends are keyed on
a test's full name, so every parameterised test whose title interpolates
a value gets a new history key on the first Vitest 5 run. There is no
deterministic mapping between the old and new titles and therefore no
migration: affected tests start a fresh history window, and one that
fails on that first run classifies as `new-failure` rather than
`persistent` or `flaky`. Tests with static titles are unaffected.

### Glob-scoped `perFile` no longer inherits the top-level setting

Vitest 5 widened `coverage.thresholds.perFile` to accept a per-metric
object, and stopped letting a glob-pattern threshold entry inherit the
top-level `perFile` flag. The plugin now resolves an object-valued
`perFile` instead of normalizing it to `false`, and applies a `perFile`
declared inside a glob-pattern entry only to that pattern rather than to
every glob. If you relied on a top-level `perFile: true` reaching your
per-glob thresholds, add `perFile` explicitly to each glob entry that
needs it.

### `coverage.include` and `coverage.exclude` are root-relative

Vitest 5 matches both lists against each file's path relative to the
project root that owns it, not the workspace root, so a workspace-anchored
entry such as `packages/cli/src/bin.ts` never matches from inside that
package. Re-anchor those patterns as `**/cli/src/bin.ts` and set
`coverage.excludeAfterRemap: true` so a file reached only through another
file's source map is still excluded. The Vitest 5 upgrade guide walks
through it.

## Features

### Tag-set changes invalidate the cached tag prelude

The plugin now registers a `fsModuleCache` cache-key generator via Vitest
5's `defineCacheKeyGenerator`. Changing the set of classification tags
declared in config now busts the cached tag prelude automatically instead
of requiring a manual cache clear.

### `github-actions` job summary no longer duplicates

Vitest 5's `github-actions` reporter writes a markdown job summary by
default, and Vitest seeds the reporter into its own defaults whenever
`GITHUB_ACTIONS=true`. Under the `ci-github` environment the plugin now
normalizes whatever entry it finds to
`["github-actions", { jobSummary: { enabled: false } }]` — preserving the
entry's other options and its position in the array, and appending one
when none exists — so the inline `::error::` annotations stay while the
summary is left to the plugin. An entry that sets
`jobSummary: { enabled: true }` reads as a deliberate opt-in: the plugin
leaves it alone and raises the new `GITHUB_JOB_SUMMARY_COLLISION`
configuration warning instead.

## Bug Fixes

* `stripConsoleReporters` now removes Vitest's `minimal` reporter, which
  is the default whenever `std-env`'s `isAgent` is true under Vitest 5.
  Without this the runner's own console output double-printed in the
  `agent`, `stream`, and `ci-annotations` console modes.

## Dependencies

| Dependency | Type | Action | From | To |
| :--------- | :--- | :----- | :--- | :-- |
| vitest | peerDependency | updated | ^4.1.0 | ^5.0.0 |
| @vitest/coverage-v8 | peerDependency | updated | ^4.1.0 | ^5.0.0 |
| @vitest/coverage-istanbul | peerDependency | updated | ^4.1.0 | ^5.0.0 |
| @vitest/runner | devDependency | removed | ^4.1.10 | — |
