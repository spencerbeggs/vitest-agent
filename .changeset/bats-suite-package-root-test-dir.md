---
"@vitest-agent/claude-code-plugin": patch
---

## Refactoring

Moves the BATS suites and their fixtures to the package root, matching the test layout the rest of the repo follows and the plugin's own `test-discovery` skill prescribes.

* `hooks/__test__/*.bats` and `render-fixture.sh` now live in `__test__/`
* `hooks/fixtures/` now lives in `__test__/fixtures/`

The suites are unchanged and still run under `bats --recursive plugins` via `pnpm test:bats`. Relative traversal inside them was rewritten to match the new depth: the repo-root walk is one level shallower, hook-script and shared-lib resolution reaches back down through `../hooks`, and fixtures resolve from each test file's own directory.

## Documentation

* README instructions for invoking a hook manually now point at `__test__/fixtures/`
