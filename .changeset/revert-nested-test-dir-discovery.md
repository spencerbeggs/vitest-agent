---
"@vitest-agent/plugin": minor
---

## Bug Fixes

### Behavior change

`@vitest-agent/plugin@2.1.0` widened test discovery to collect `__test__/` directories nested anywhere in a package tree, not only at the project root next to `src/`. That include glob (`**/__test__/**`) is unanchored, and Vitest matches it literally with no concept of a nested `package.json` boundary. For a workspace at the repository root — which `@effected/workspaces` reports as a workspace of its own — the pattern globbed the entire repository and collected unrelated test suites against the wrong toolchain.

Discovery now collects tests only from `<package>/src/**` and `<package>/__test__/**`, anchored at the package root. A `__test__/` directory nested anywhere else — `lib/scripts/__test__/`, for example — is no longer discovered. If you moved tests into a nested `__test__/` directory on the strength of the 2.1.0 change, Vitest will silently stop collecting them; move them back under the package's own `src/` or `__test__/` directory. A new PreToolUse hook (see `@vitest-agent/cli`'s `agent check-test-path`) now flags an attempt to write a new test file to an invalid location before the mistake happens again.

The `**/dist/**` exclude that the widened glob required is also gone — an anchored include can no longer reach build output, so nothing needs to exclude it.

* Discovery's process-level cache signature (used to detect test files added, removed, moved, or renamed between calls) now fingerprints only each package's `src/` and `__test__/` directories, instead of walking every nested `__test__/` directory and tracking `package.json` boundary markers.
