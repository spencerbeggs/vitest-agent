# @vitest-agent/plugin

## 2.2.0

### Bug Fixes

* ### Behavior change

  `@vitest-agent/plugin@2.1.0` widened test discovery to collect `__test__/` directories nested anywhere in a package tree, not only at the project root next to `src/`. That include glob (`**/__test__/**`) is unanchored, and Vitest matches it literally with no concept of a nested `package.json` boundary. For a workspace at the repository root — which `@effected/workspaces` reports as a workspace of its own — the pattern globbed the entire repository and collected unrelated test suites against the wrong toolchain.

  Discovery now collects tests only from `<package>/src/**` and `<package>/__test__/**`, anchored at the package root. A `__test__/` directory nested anywhere else — `lib/scripts/__test__/`, for example — is no longer discovered. If you moved tests into a nested `__test__/` directory on the strength of the 2.1.0 change, Vitest will silently stop collecting them; move them back under the package's own `src/` or `__test__/` directory. If you use the Claude Code plugin, a new PreToolUse hook now flags an attempt to write a new test file to an invalid location before the mistake happens again. Everyone else can check a suspect path on demand with `npx vitest-agent agent check-test-path <path>`, which prints the same verdict the hook acts on.

  The unanchored `**/dist/**` exclude the widened glob required is gone, replaced by bounded exclusions: `node_modules/`, `.git/` and `dist/` are each excluded under both `src/**` and `__test__/**`. An anchored include already cannot reach a package's own top-level `dist/`; the bounded form additionally covers build output nested deeper, so the emitted config prunes exactly what the walk behind it prunes. Both read the shared `NON_DISCOVERABLE_DIRS` constant in `@vitest-agent/sdk`.

  * Discovery's process-level cache signature (used to detect test files added, removed, moved, or renamed between calls) now fingerprints only each package's `src/` and `__test__/` directories, instead of walking every nested `__test__/` directory and tracking `package.json` boundary markers. [#228][#228]

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.17 | 2.1.0  |
| @vitest-agent/mcp      | dependency | updated | 2.1.2  | 2.1.3  |
| @vitest-agent/reporter | dependency | updated | 2.0.17 | 2.0.18 |
| @vitest-agent/sdk      | dependency | updated | 2.1.0  | 2.2.0  |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#228]: https://github.com/spencerbeggs/vitest-agent/pull/228

## 2.1.0

### Features

* ### Render survives a persistence failure

  When database persistence (or its startup migration) fails, `AgentReporter` now still renders test results to the console instead of aborting the run with no output at all. A follow-up stderr line makes clear the results shown were **not** recorded to history — `vitest-agent: persistence failed — results above were rendered but NOT recorded: <reason>` — so it's never ambiguous whether a shown result also landed in the database.

  ### Nested `__test__/` directory discovery

  Test discovery now recognizes `__test__/` directories anywhere in a package tree, not only at the project root next to `src/` — for example `lib/scripts/__test__/`. A package-boundary walker keeps the broader scan from re-entering a nested package's own tests or a fixture's `node_modules`.

### Bug Fixes

* Per-project test run reason: one failing project's tests no longer mark every other project's row as "failed" in a multi-project run — each project's persisted run reason is now derived from that project's own results
* `stringifyFailureValue` no longer throws when a value's own `String()` conversion throws [#223][#223]

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.16 | 2.0.17 |
| @vitest-agent/mcp      | dependency | updated | 2.1.1  | 2.1.2  |
| @vitest-agent/reporter | dependency | updated | 2.0.16 | 2.0.17 |
| @vitest-agent/sdk      | dependency | updated | 2.0.16 | 2.1.0  |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#223]: https://github.com/spencerbeggs/vitest-agent/pull/223

## 2.0.16

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.15 | 2.0.16 |
| @vitest-agent/mcp      | dependency | updated | 2.1.0  | 2.1.1  |
| @vitest-agent/reporter | dependency | updated | 2.0.15 | 2.0.16 |
| @vitest-agent/sdk      | dependency | updated | 2.0.15 | 2.0.16 |

* | Dependency           | Type       | Action  | From    | To      |                                                                       |
  | -------------------- | ---------- | ------- | ------- | ------- | --------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.11.0 | ^0.11.1 | [#221][#221] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#221]: https://github.com/spencerbeggs/vitest-agent/pull/221

## 2.0.15

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.14 | 2.0.15 |
| @vitest-agent/mcp      | dependency | updated | 2.0.14 | 2.1.0  |
| @vitest-agent/reporter | dependency | updated | 2.0.14 | 2.0.15 |
| @vitest-agent/sdk      | dependency | updated | 2.0.14 | 2.0.15 |

* | Dependency              | Type       | Action  | From           | To             |                                                                            |
  | ----------------------- | ---------- | ------- | -------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | @effected/workspaces    | dependency | updated | ^0.10.2        | ^0.11.0        |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 | [#219][#219] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#219]: https://github.com/spencerbeggs/vitest-agent/pull/219

## 2.0.14

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/mcp      | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/reporter | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/sdk      | dependency | updated | 2.0.13 | 2.0.14 |

* | Dependency           | Type       | Action  | From   | To      |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------- | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.9.4 | ^0.10.2 | [#215][#215] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#215]: https://github.com/spencerbeggs/vitest-agent/pull/215

## 2.0.13

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/mcp      | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/reporter | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/sdk      | dependency | updated | 2.0.12 | 2.0.13 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.9.3 | ^0.9.4 | [#210][#210] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#210]: https://github.com/spencerbeggs/vitest-agent/pull/210

## 2.0.12

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/mcp      | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/reporter | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/sdk      | dependency | updated | 2.0.11 | 2.0.12 |

* | Dependency           | Type           | Action  | From   | To     |                                                                            |
  | -------------------- | -------------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency     | updated | ^0.9.1 | ^0.9.3 |                                                                            |
  | vitest               | peerDependency | updated | 4.1.10 | ^4.1.0 | [#208][#208] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#208]: https://github.com/spencerbeggs/vitest-agent/pull/208

## 2.0.11

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/mcp      | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/reporter | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/sdk      | dependency | updated | 2.0.10 | 2.0.11 |

## 2.0.10

### Dependencies

| Dependency             | Type       | Action  | From  | To     |
| ---------------------- | ---------- | ------- | ----- | ------ |
| @vitest-agent/cli      | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/mcp      | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/reporter | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/sdk      | dependency | updated | 2.0.9 | 2.0.10 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.8.0 | ^0.9.1 | [#198][#198] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#198]: https://github.com/spencerbeggs/vitest-agent/pull/198

## 2.0.9

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/mcp      | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/reporter | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/sdk      | dependency | updated | 2.0.8 | 2.0.9 |

## 2.0.8

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/mcp      | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/reporter | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/sdk      | dependency | updated | 2.0.7 | 2.0.8 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.6.2 | ^0.8.0 | [#188][#188] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#188]: https://github.com/spencerbeggs/vitest-agent/pull/188

## 2.0.7

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/mcp      | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/reporter | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/sdk      | dependency | updated | 2.0.6 | 2.0.7 |

* | Dependency              | Type       | Action  | From          | To             |                                                                            |
  | ----------------------- | ---------- | ------- | ------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | @effected/workspaces    | dependency | updated | ^0.6.1        | ^0.6.2         |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | magic-string            | dependency | updated | ^1.0.0        | ^1.1.0         | [#185][#185] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#185]: https://github.com/spencerbeggs/vitest-agent/pull/185

## 2.0.6

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/mcp      | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/reporter | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/sdk      | dependency | updated | 2.0.5 | 2.0.6 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.6.0 | ^0.6.1 | [#181][#181] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#181]: https://github.com/spencerbeggs/vitest-agent/pull/181

## 2.0.5

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/mcp      | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/reporter | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/sdk      | dependency | updated | 2.0.4 | 2.0.5 |

## 2.0.4

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/mcp      | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/reporter | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/sdk      | dependency | updated | 2.0.3 | 2.0.4 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.5.2 | ^0.6.0 | [#173][#173] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#173]: https://github.com/spencerbeggs/vitest-agent/pull/173

## 2.0.3

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/mcp      | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/reporter | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/sdk      | dependency | updated | 2.0.2 | 2.0.3 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.4.1 | ^0.5.2 | [#170][#170] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#170]: https://github.com/spencerbeggs/vitest-agent/pull/170

## 2.0.2

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/mcp      | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/reporter | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/sdk      | dependency | updated | 2.0.1 | 2.0.2 |

* | Dependency              | Type       | Action  | From          | To            |                                                          |
  | ----------------------- | ---------- | ------- | ------------- | ------------- | -------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | @effected/workspaces    | dependency | updated | ^0.4.0        | ^0.4.1        |                                                          |
  | effect                  | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 2.0.1

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/mcp      | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/reporter | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/sdk      | dependency | updated | 2.0.0 | 2.0.1 |

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.3.1 | ^0.4.0 | [#164][#164] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#164]: https://github.com/spencerbeggs/vitest-agent/pull/164

## 2.0.0

### Breaking Changes

* ### Effect v4

  `@vitest-agent/plugin` now runs on Effect v4 (`effect@4.0.0-beta.98`). `@effect/platform-node`'s `NodeContext` is renamed to `NodeServices`. `better-sqlite3` is no longer a dependency — the data layer runs on Node's built-in `node:sqlite`, which raises the effective Node requirement to `>=24.11.0`.

  ### Workspace discovery via `@effected/workspaces`

  `AgentPlugin.discover()`'s project auto-detection now resolves workspace packages through `@effected/workspaces` instead of `workspaces-effect`.

  ### A suite load failure now fails the run

  The reporter's failure detection (`hasFailures`, and therefore the process exit code) now checks `failedFiles.length` instead of `summary.failed`. Previously, a test file that failed to import could render the run as all green while the process still exited non-zero. If your CI treated that gap as a pass before, it will now correctly fail — the underlying import error was always there.

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 1.0.8 | 2.0.0 |
| @vitest-agent/mcp      | dependency | updated | 1.3.6 | 2.0.0 |
| @vitest-agent/reporter | dependency | updated | 1.0.8 | 2.0.0 |
| @vitest-agent/sdk      | dependency | updated | 1.3.4 | 2.0.0 |

* | Dependency              | Type       | Action  | From    | To            |                                                                       |
  | :---------------------- | :--------- | :------ | :------ | :------------ | --------------------------------------------------------------------- |
  | @effect/cluster         | dependency | removed | 0.59.0  | —             |                                                                       |
  | @effect/experimental    | dependency | removed | 0.60.0  | —             |                                                                       |
  | @effect/platform        | dependency | removed | 0.96.3  | —             |                                                                       |
  | @effect/platform-node   | dependency | updated | 0.107.0 | 4.0.0-beta.98 |                                                                       |
  | @effect/rpc             | dependency | removed | 0.75.1  | —             |                                                                       |
  | @effect/sql             | dependency | removed | 0.51.1  | —             |                                                                       |
  | @effect/sql-sqlite-node | dependency | updated | 0.52.0  | 4.0.0-beta.98 |                                                                       |
  | @effect/workflow        | dependency | removed | 0.18.2  | —             |                                                                       |
  | @effected/workspaces    | dependency | added   | —       | 0.3.1         |                                                                       |
  | effect                  | dependency | updated | 3.22.0  | 4.0.0-beta.98 |                                                                       |
  | magic-string            | dependency | updated | 0.30.21 | 1.0.0         |                                                                       |
  | workspaces-effect       | dependency | removed | 2.1.0   | —             | [#161][#161] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.1.9

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 1.0.7 | 1.0.8 |
| @vitest-agent/mcp      | dependency | updated | 1.3.5 | 1.3.6 |
| @vitest-agent/reporter | dependency | updated | 1.0.7 | 1.0.8 |
| @vitest-agent/sdk      | dependency | updated | 1.3.3 | 1.3.4 |

* | Dependency        | Type       | Action  | From   | To     |                                                                            |
  | ----------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | workspaces-effect | dependency | updated | ^2.0.3 | ^2.1.0 | [#153][#153] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#153]: https://github.com/spencerbeggs/vitest-agent/pull/153

## 1.1.8

### Bug Fixes

* The `tdd-task` agent can now deliver its final report and answer a `shutdown_request` when dispatched as a named teammate — added `SendMessage` to its tool allowlist, since without an explicit reply the orchestrator never saw the agent's result (#137)
* The `tdd-task` agent's tool allowlist also gains `LSP` (post-edit type errors and code navigation during the red-green-refactor loop) and `ReportFindings` (structured finding reports when its test-quality review passes call for them) [#141][#141]

- Fixed `DataStoreError: NOT NULL constraint failed: coverage_baselines.value` on runs with no coverage data (e.g. `vitest run --passWithNoTests` in a workspace with no test files) — an empty coverage map now short-circuits to "no coverage report" instead of producing a report with non-numeric ("Unknown") totals that fed `NaN` into the baseline ratchet math (#130) [#141][#141]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 1.0.6 | 1.0.7 |
| @vitest-agent/mcp      | dependency | updated | 1.3.4 | 1.3.5 |
| @vitest-agent/reporter | dependency | updated | 1.0.6 | 1.0.7 |
| @vitest-agent/sdk      | dependency | updated | 1.3.2 | 1.3.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#141]: https://github.com/spencerbeggs/vitest-agent/pull/141

## 1.1.7

### Bug Fixes

* Fixed a Vite transform bug (#133) where wrapper testers with a `(name, self, timeout)` signature — `@effect/vitest`'s `it.effect`, `it.live`, and `layer()` — were corrupted by argument rewriting, throwing "Cannot use two functions as arguments" and collecting 0 tests. Classification tags are now applied via a guarded file-level prelude at test-collection time, so every declaration form inherits them correctly: native `it`/`test`, `@effect/vitest` testers, `test.extend` aliases, numeric-timeout third-argument calls, and dynamically registered tests. Tests that already declare their own tags now merge with classification tags instead of being skipped, and files degrade to untagged (rather than failing to load) if the required Vitest runner API is unavailable.
* `@vitest-agent/cli` and `@vitest-agent/mcp` now publish as exact-pinned regular dependencies of the plugin instead of `peerDependencies`. The prior peer form could trigger pnpm's auto-install-peers resolution to pull mismatched `effect` versions into consuming projects; their bins are still hoisted automatically. [#134][#134]

### Dependencies

* | Dependency       | Type       | Action  | From    | To |                                                                       |
  | ---------------- | ---------- | ------- | ------- | -- | --------------------------------------------------------------------- |
  | acorn            | dependency | removed | ^8.17.0 | —  |                                                                       |
  | acorn-typescript | dependency | removed | ^1.4.13 | —  | [#134][#134] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/vitest-agent/pull/134

## 1.1.6

### Bug Fixes

* Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 1.0.5 | 1.0.6 |
| @vitest-agent/mcp      | dependency | updated | 1.3.3 | 1.3.4 |
| @vitest-agent/reporter | dependency | updated | 1.0.5 | 1.0.6 |
| @vitest-agent/sdk      | dependency | updated | 1.3.1 | 1.3.2 |

* | Dependency           | Type       | Action | From | To      |                                                                       |
  | -------------------- | ---------- | ------ | ---- | ------- | --------------------------------------------------------------------- |
  | @effect/experimental | dependency | added  | —    | ^0.60.0 |                                                                       |
  | @effect/workflow     | dependency | added  | —    | ^0.18.2 |                                                                       |
  | @effect/printer      | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/printer-ansi | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/typeclass    | dependency | added  | —    | ^0.40.0 | [#128][#128] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.1.5

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 1.0.4 | 1.0.5 |
| @vitest-agent/mcp      | dependency | updated | 1.3.2 | 1.3.3 |
| @vitest-agent/reporter | dependency | updated | 1.0.4 | 1.0.5 |
| @vitest-agent/sdk      | dependency | updated | 1.3.0 | 1.3.1 |

* | Dependency        | Type       | Action  | From   | To     |                                                          |
  | ----------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------- |
  | workspaces-effect | dependency | updated | ^1.3.0 | ^2.0.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 1.1.4

### Bug Fixes

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) The reporter now threads each test's module path into history writes and classification lookups, so identically-named tests in different files are tracked as independent history series instead of colliding (see the `@vitest-agent/sdk` fix for `test_history` identity)
  | Dependency             | Type       | Action  | From  | To    |
  | ---------------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk      | dependency | updated | 1.2.0 | 1.3.0 |
  | @vitest-agent/mcp      | dependency | updated | 1.3.1 | 1.3.2 |
  | @vitest-agent/cli      | dependency | updated | 1.0.3 | 1.0.4 |
  | @vitest-agent/reporter | dependency | updated | 1.0.3 | 1.0.4 |

### Dependencies

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) | Dependency | Type | Action | From | To |
  \| ----------------- | ---------- | ------- | ------ | ------ |
  \| workspaces-effect | dependency | updated | ^1.2.0 | ^1.3.0 |

## 1.1.3

### Patch Changes

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/mcp      | dependency | updated | 1.3.0 | 1.3.1 |
| @vitest-agent/sdk      | dependency | updated | 1.1.0 | 1.2.0 |
| @vitest-agent/cli      | dependency | updated | 1.0.2 | 1.0.3 |
| @vitest-agent/reporter | dependency | updated | 1.0.2 | 1.0.3 |

## 1.1.2

### Bug Fixes

* [`3cf7502`](https://github.com/spencerbeggs/vitest-agent/commit/3cf7502360086e80ed5ea96ab1154bf1e9537ef5) Fixed the discovery project cache persisting for the life of the process with no invalidation, which could serve a long-lived MCP server stale test project include-globs (and stale/"lost" test counts) after test files were added, removed, or moved on disk. The cache now self-invalidates when the on-disk test-file set changes, so moving or adding test files no longer produces phantom count drops and no restart is needed.
* Suppressed the repeated benign `[vite] (ssr) Failed to load source map` warnings that Vite core emits under v8 coverage due to missing `.js.map` files in the TypeScript npm tarball. All other Vite warnings still pass through unchanged, so console output stays clean under coverage with no config required.
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/mcp | dependency | updated | 1.2.0 | 1.3.0 |

## 1.1.1

### Build System

* [`edad2ac`](https://github.com/spencerbeggs/vitest-agent/commit/edad2acebe07258be116f9e7633ca8f66024d8d5) The published `peerDependencies` on `@vitest-agent/cli` and `@vitest-agent/mcp` are now exact-pinned instead of an inexact caret range, so an installed plugin always pulls the exact cli and mcp versions it was built against. They are declared as source `workspace:*` dependencies and promoted back to peers by the build transform.

### Dependencies

* [`edad2ac`](https://github.com/spencerbeggs/vitest-agent/commit/edad2acebe07258be116f9e7633ca8f66024d8d5) | Dependency | Type | Action | From | To |
  \| ----------------- | -------------- | ------- | ------ | ----- |
  \| @vitest-agent/cli | peerDependency | updated | ^1.0.2 | 1.0.2 |
  \| @vitest-agent/mcp | peerDependency | updated | ^1.1.0 | 1.1.0 |
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/mcp | dependency | updated | 1.1.0 | 1.2.0 |

## 1.1.0

### Features

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) ### VITEST\_AGENT\_CONSOLE Env Var

Set `VITEST_AGENT_CONSOLE` to override the console mode that `AgentPlugin` resolves from the `console` option matrix for a single Vitest invocation. Accepted values mirror the per-executor slots:

* `human` executor: `passthrough`, `silent`, `stream`, `agent`
* `agent` executor: `passthrough`, `silent`, `agent`
* `ci` executor: `passthrough`, `silent`, `ci-annotations`

An invalid value for the detected executor is silently ignored and a diagnostic is written to stderr, leaving the config-derived mode in effect. This is an escape hatch for CI pipelines, local debugging sessions, and test setups where modifying `vitest.config.ts` is not practical.

### Bug Fixes

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) `CoverageOptions` is now exported from the `@vitest-agent/plugin` entry point. The interface appears in `CoverageAnalyzer`'s public method signatures and was reachable through type inference but not directly importable. The package now reports zero API Extractor errors with no new suppressions.

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |
  | Dependency             | Type       | Action  | From  | To    |
  | ---------------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk      | dependency | updated | 1.0.1 | 1.1.0 |
  | @vitest-agent/reporter | dependency | updated | 1.0.1 | 1.0.2 |

### Maintenance

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) Removed the cross-package version drift check from `AgentPlugin`. The plugin no longer compares its version against `@vitest-agent/sdk` and `@vitest-agent/reporter` at construction time and no longer writes a version drift warning to stderr. The `CURRENT_PLUGIN_VERSION` constant remains exported for version introspection.

## 1.0.1

### Bug Fixes

* [`3cfd166`](https://github.com/spencerbeggs/vitest-agent/commit/3cfd166de45227d28aa77d16f7b4237053509e27) `AgentPlugin.discover()` no longer picks up or runs test files inside `node_modules`. The custom `test.exclude` emitted for packages with a `__test__` directory now preserves Vitest's default `**/node_modules/**` exclusion.
  | Dependency             | Type       | Action  | From  | To    |
  | ---------------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/mcp      | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/reporter | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/sdk      | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/cli      | dependency | updated | 1.0.0 | 1.0.1 |

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release of the Vitest plugin for LLM coding agents. `AgentPlugin` targets Vitest >= 4.1.0 with four-environment detection, reporter-chain management, Full and UI-only operating modes gated by Vitest's native `coverage.enabled`, a `ConfigValidation` service for coverage-config diagnostics, pluggable rendering via `VitestAgentReporterFactory`, typed `coverageTargets` with `COVERAGE_LEVELS` presets, and per-project trend tracking.

Add it to your `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { AgentPlugin } from "@vitest-agent/plugin";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.basic;
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "stream", agent: "agent" },
        coverageTargets: coverage.coverageTargets,
      }),
    ],
    test: {
      ...(projects ? { projects } : {}),
      tags,
      coverage: {
        enabled: true,
        provider: "v8",
        thresholds: coverage.thresholds,
      },
    },
  });
};
```

For the Claude Code integration, register the marketplace and install the plugin at project scope so it is shared with your whole team (both commands write to `.claude/settings.json`):

```bash
# Register the marketplace for your team
claude plugin marketplace add spencerbeggs/bot --scope project

# Install the plugin from the registered marketplace
claude plugin install vitest-agent@spencerbeggs --scope project
```

### Patch Changes

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/cli      | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/mcp      | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/reporter | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/sdk      | dependency | updated | 0.0.0 | 1.0.0 |
