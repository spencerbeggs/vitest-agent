# @vitest-agent/plugin

## 2.5.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 2.4.13 | 2.4.14 |

## 2.5.5

### Bug Fixes

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now distinguishes a bats invocation from a vitest/jest one and passes `--suite bats` to `agent record tdd-artifact` on a bats match, so a bats-only behavior can now pass `red→green` and `green→refactor` through the phase-transition gate (#363). [#366][#366]

* The live `RunFinished` event now populates `unhandledErrors`, so a process-level unhandled error captured during a run is no longer dropped before it reaches the reporter (#240). [#356][#356]

- The Claude Code plugin's `test-location.sh` PreToolUse hook gained a `VITEST_AGENT_TEST_LOCATION_HOOK=off` opt-out, checked before anything else, so a project hitting a false-positive deny (a custom `DiscoverStrategy` the CLI's lexical detector doesn't understand) can disable the check entirely without editing `hooks.json` (#230).
- The hook's deny and additional-context messages now say "Under the default discovery layout" and name the opt-out, instead of stating the discoverable-test-layout rule as an unconditional fact (#230). [#359][#359]

* For the `agent` executor with coverage enabled, `configureVitest` now rewrites `coverage.reportsDirectory` to a per-process temp directory (removed on close), so two concurrent plain-CLI `vitest run` invocations in one checkout no longer clobber each other's `coverage/.tmp` files. `VITEST_AGENT_COVERAGE_DIR_ISOLATION=off` opts out and `VITEST_AGENT_COVERAGE_DIR=<path>` pins an explicit directory instead; human and CI executors are untouched (#194). [#366][#366]

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now forwards `VITEST_AGENT_TDD_TASK_ID` (when set in the subagent's environment) to `agent record tdd-artifact` as `--tdd-task-id`, so a TDD subagent whose hooks attribute to a detached session no longer gets every phase transition denied for missing evidence (#144). [#359][#359]

* The reporter now persists the resolved `coverage.thresholds` and `coverageTargets` on every run that configures them, so `test_coverage` can render the enforced threshold and the aspirational target as distinct facets instead of reporting the target as if it were the enforced threshold (#237).
* A scoped or partial run (`files` / `project` / `tags` filter, or fewer test files started than exist in the project) is now detected and routed through a separate coverage-processing path that suppresses `ThresholdViolation` events and neutralizes Vitest's native `coverage.thresholds` check for that run, instead of letting Vitest fail thresholds against the whole-project denominator on a subset of files. `test_runs.scoped` is persisted for every run (#160). [#358][#358]

- The Claude Code plugin's `tdd-artifact.sh` PostToolUse hook now recognizes `bats` invocations and records run-level `test_failed_run` / `test_passed_run` artifacts from the exit code, so a bats-driven test run is no longer invisible to TDD phase-transition evidence (#360). [#364][#364]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.18.3 | ^0.19.0 |
| @vitest-agent/cli | dependency | updated | 2.2.13 | 2.2.14 |
| @vitest-agent/mcp | dependency | updated | 2.4.12 | 2.4.13 |
| @vitest-agent/reporter | dependency | updated | 2.2.2 | 2.2.3 |
| @vitest-agent/sdk | dependency | updated | 2.4.13 | 2.5.0 |

[#367][#367]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#356]: https://github.com/spencerbeggs/vitest-agent/pull/356

[#358]: https://github.com/spencerbeggs/vitest-agent/pull/358

[#359]: https://github.com/spencerbeggs/vitest-agent/pull/359

[#364]: https://github.com/spencerbeggs/vitest-agent/pull/364

[#366]: https://github.com/spencerbeggs/vitest-agent/pull/366

[#367]: https://github.com/spencerbeggs/vitest-agent/pull/367

## 2.5.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 2.4.11 | 2.4.12 |

## 2.5.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.12 | 2.2.13 |
| @vitest-agent/mcp | dependency | updated | 2.4.10 | 2.4.11 |
| @vitest-agent/reporter | dependency | updated | 2.2.1 | 2.2.2 |
| @vitest-agent/sdk | dependency | updated | 2.4.12 | 2.4.13 |

## 2.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 2.4.9 | 2.4.10 |

## 2.5.1

### Bug Fixes

- `discoverProjects` now accepts `maxDepth` and forwards it to workspace package
  enumeration so deeply nested workspace packages can be discovered when callers
  opt in. `AgentPlugin.discover({ maxDepth })` now forwards the same override
  through its options-object form.

- Default behavior is unchanged when `maxDepth` is omitted (the&#10;`@effected/workspaces` default depth still applies).

- Existing output shape and caller compatibility remain unchanged. [#326][#326]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.11 | 2.2.12 |
| @vitest-agent/mcp | dependency | updated | 2.4.8 | 2.4.9 |
| @vitest-agent/reporter | dependency | updated | 2.2.0 | 2.2.1 |
| @vitest-agent/sdk | dependency | updated | 2.4.11 | 2.4.12 |
| magic-string | dependency | updated | ^1.2.2 | ^1.2.3 |

[#328][#328]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#326]: https://github.com/spencerbeggs/vitest-agent/pull/326

[#328]: https://github.com/spencerbeggs/vitest-agent/pull/328

## 2.5.0

### Features

#### Guaranteed GitHub Actions reporter

- Under GitHub Actions, `AgentPlugin` now explicitly ensures Vitest's built-in `github-actions` reporter is present in the reporter chain. Vitest only auto-appends that reporter when `reporters` resolves empty, so it silently dropped out as soon as any reporter was configured — including the plugin's own. Failure annotations now reach the run summary reliably instead of depending on config shape.

#### Collapsed run summary in the Actions log

- `DefaultVitestAgentReporter` now emits a compact `::group::vitest-agent` block at the end of a run when GitHub Actions is detected. It reports per-project pass/fail/skip counts, how many files sit below their coverage target, any non-stable test classifications (`flaky`, `new-failure`, `persistent`, `recovered`), and the database path results were persisted to.

- The block is collapsed by default, and Vitest's own reporters are left alone: the `ci` console slot still defaults to `passthrough`, so the `default` reporter continues to own the job-log body. The two are complements — `github-actions` emits annotations only, and carries no counts or summary of its own. [#309][#309]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.18.2 | ^0.18.3 |
| @vitest-agent/cli | dependency | updated | 2.2.10 | 2.2.11 |
| @vitest-agent/mcp | dependency | updated | 2.4.7 | 2.4.8 |
| @vitest-agent/reporter | dependency | updated | 2.1.11 | 2.2.0 |
| @vitest-agent/sdk | dependency | updated | 2.4.10 | 2.4.11 |

[#312][#312]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#309]: https://github.com/spencerbeggs/vitest-agent/pull/309

[#312]: https://github.com/spencerbeggs/vitest-agent/pull/312

## 2.4.10

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 2.4.6 | 2.4.7 |

## 2.4.9

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.18.1 | ^0.18.2 |
| @vitest-agent/cli | dependency | updated | 2.2.9 | 2.2.10 |
| @vitest-agent/mcp | dependency | updated | 2.4.5 | 2.4.6 |
| @vitest-agent/reporter | dependency | updated | 2.1.10 | 2.1.11 |
| @vitest-agent/sdk | dependency | updated | 2.4.9 | 2.4.10 |

[#294][#294]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#294]: https://github.com/spencerbeggs/vitest-agent/pull/294

## 2.4.8

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | ^0.18.0 | ^0.18.1 |
| @vitest-agent/cli | dependency | updated | 2.2.8 | 2.2.9 |
| @vitest-agent/mcp | dependency | updated | 2.4.4 | 2.4.5 |
| @vitest-agent/reporter | dependency | updated | 2.1.9 | 2.1.10 |
| @vitest-agent/sdk | dependency | updated | 2.4.8 | 2.4.9 |

[#289][#289]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#289]: https://github.com/spencerbeggs/vitest-agent/pull/289

## 2.4.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.7 | 2.2.8 |
| @vitest-agent/mcp | dependency | updated | 2.4.3 | 2.4.4 |
| @vitest-agent/reporter | dependency | updated | 2.1.8 | 2.1.9 |
| @vitest-agent/sdk | dependency | updated | 2.4.7 | 2.4.8 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.17.2 | ^0.18.0 | [#284][#284] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#284]: https://github.com/spencerbeggs/vitest-agent/pull/284

## 2.4.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.6 | 2.2.7 |
| @vitest-agent/mcp | dependency | updated | 2.4.2 | 2.4.3 |
| @vitest-agent/reporter | dependency | updated | 2.1.7 | 2.1.8 |
| @vitest-agent/sdk | dependency | updated | 2.4.6 | 2.4.7 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.17.1 | ^0.17.2 | [#282][#282] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#282]: https://github.com/spencerbeggs/vitest-agent/pull/282

## 2.4.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.5 | 2.2.6 |
| @vitest-agent/mcp | dependency | updated | 2.4.1 | 2.4.2 |
| @vitest-agent/reporter | dependency | updated | 2.1.6 | 2.1.7 |
| @vitest-agent/sdk | dependency | updated | 2.4.5 | 2.4.6 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.17.0 | ^0.17.1 | [#280][#280] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#280]: https://github.com/spencerbeggs/vitest-agent/pull/280

## 2.4.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 2.4.0 | 2.4.1 |
| @vitest-agent/reporter | dependency | updated | 2.1.5 | 2.1.6 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | vitest | peerDependency | updated | 4.1.11 | ^4.1.0 | [#278][#278] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#278]: https://github.com/spencerbeggs/vitest-agent/pull/278

## 2.4.3

### Bug Fixes

- Discovery's helper-directory exclusion (`__test__/utils/`, etc.) no longer matches at any depth under `__test__/`. It now anchors directly beneath the test root, matching how the include glob is anchored, so a nested suite such as `__test__/unit/utils/parse.test.ts` is no longer silently dropped from discovery — only a helper directory named directly under `__test__/` (e.g. `__test__/utils/`) is excluded. [#276][#276]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.4 | 2.2.5 |
| @vitest-agent/mcp | dependency | updated | 2.3.4 | 2.4.0 |
| @vitest-agent/reporter | dependency | updated | 2.1.4 | 2.1.5 |
| @vitest-agent/sdk | dependency | updated | 2.4.4 | 2.4.5 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#276]: https://github.com/spencerbeggs/vitest-agent/pull/276

## 2.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.3 | 2.2.4 |
| @vitest-agent/mcp | dependency | updated | 2.3.3 | 2.3.4 |
| @vitest-agent/reporter | dependency | updated | 2.1.3 | 2.1.4 |
| @vitest-agent/sdk | dependency | updated | 2.4.3 | 2.4.4 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.16.0 | ^0.17.0 | [#272][#272] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#272]: https://github.com/spencerbeggs/vitest-agent/pull/272

## 2.4.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | magic-string | dependency | updated | ^1.2.1 | ^1.2.2 | [#269][#269] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#269]: https://github.com/spencerbeggs/vitest-agent/pull/269

## 2.4.0

### Features

- ### Injectable filesystem port for discovery
  The four discovery walkers (`findTestFiles`, `isTestShapedPackage`, `discoverProjects`, and `DiscoverStrategy.buildProject`) now read through a small filesystem port instead of calling `node:fs` directly. Every call site still defaults to the real filesystem, so production behavior is unchanged — this only opens the door to testing discovery against a virtual volume instead of a real temporary directory.
  ```ts
  import type { WalkerFileSystem } from "@vitest-agent/plugin";
  import { findTestFiles } from "@vitest-agent/plugin";

  const fs: WalkerFileSystem = {
    readDirectory: async (dir) => [],
    statEntry: async (path) => null,
  };

  await findTestFiles("/repo/packages/foo", ["**/*.test.ts"], fs);
  ```
  New exports from the package index: the `WalkerFileSystem`, `WalkerEntry`, and `WalkerEntryStat` types, plus the `nodeWalkerFs` binding (the default used everywhere).

  Three existing shapes gained optional opt-in points, each defaulting to previous behavior:
  - `findTestFiles(dir, patterns, fs?)` — new trailing `fs` parameter
  - `DiscoverProjectsOptions` — new `fs?` and `syncOps?` fields
  - `DiscoverInput` (passed to `DiscoverStrategy.buildProject`) — new `fs?` field

  Anyone implementing a custom `DiscoverStrategy`, or testing project discovery, can now hand in a virtual filesystem instead of building and tearing down a real temp directory. [#267][#267]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.2 | 2.2.3 |
| @vitest-agent/mcp | dependency | updated | 2.3.2 | 2.3.3 |
| @vitest-agent/reporter | dependency | updated | 2.1.2 | 2.1.3 |
| @vitest-agent/sdk | dependency | updated | 2.4.2 | 2.4.3 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.15.1 | ^0.16.0 | [#267][#267] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#267]: https://github.com/spencerbeggs/vitest-agent/pull/267

## 2.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.1 | 2.2.2 |
| @vitest-agent/mcp | dependency | updated | 2.3.1 | 2.3.2 |
| @vitest-agent/reporter | dependency | updated | 2.1.1 | 2.1.2 |
| @vitest-agent/sdk | dependency | updated | 2.4.1 | 2.4.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.14.2 | ^0.15.1 |  |
  | magic-string | dependency | updated | ^1.2.0 | ^1.2.1 | [#264][#264] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#264]: https://github.com/spencerbeggs/vitest-agent/pull/264

## 2.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.2.0 | 2.2.1 |
| @vitest-agent/mcp | dependency | updated | 2.3.0 | 2.3.1 |
| @vitest-agent/reporter | dependency | updated | 2.1.0 | 2.1.1 |
| @vitest-agent/sdk | dependency | updated | 2.4.0 | 2.4.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.14.0 | ^0.14.2 |  |
  | @vitest/coverage-istanbul | peerDependency | updated | 4.1.10 | 4.1.11 |  |
  | @vitest/coverage-v8 | peerDependency | updated | 4.1.10 | 4.1.11 | [#260][#260] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#260]: https://github.com/spencerbeggs/vitest-agent/pull/260

## 2.3.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.1.3 | 2.2.0 |
| @vitest-agent/mcp | dependency | updated | 2.2.1 | 2.3.0 |
| @vitest-agent/reporter | dependency | updated | 2.0.21 | 2.1.0 |
| @vitest-agent/sdk | dependency | updated | 2.3.1 | 2.4.0 |

### Maintenance

- Bumps all packages to use `effect@rc.109`

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 2.2.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.1.2 | 2.1.3 |
| @vitest-agent/mcp | dependency | updated | 2.2.0 | 2.2.1 |
| @vitest-agent/reporter | dependency | updated | 2.0.20 | 2.0.21 |
| @vitest-agent/sdk | dependency | updated | 2.3.0 | 2.3.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.12.0 | ^0.13.0 | [#253][#253] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#253]: https://github.com/spencerbeggs/vitest-agent/pull/253

## 2.2.2

### Bug Fixes

- An invalid `VITEST_AGENT_CONSOLE` override now lists the console modes actually accepted for the detected executor (`human` / `agent` / `ci`) in its stderr warning, instead of a generic message.
- Discovery warns once per package (stderr) when a package that looks test-shaped — a `__test__/` directory, or `src/` files matching the test-file naming convention — is declined by the discover strategy, and points at the `check-test-path` probe. Previously this was a silent skip (#229).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.1.1 | 2.1.2 |
| @vitest-agent/mcp | dependency | updated | 2.1.4 | 2.2.0 |
| @vitest-agent/reporter | dependency | updated | 2.0.19 | 2.0.20 |
| @vitest-agent/sdk | dependency | updated | 2.2.1 | 2.3.0 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | magic-string | dependency | updated | ^1.1.0 | ^1.2.0 | [#238][#238] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

* | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.11.2 | ^0.12.0 | [#249][#249] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Other

- `AgentPlugin.runScript` now takes a file-based advisory lock (under `$XDG_DATA_HOME/vitest-agent/runscript-locks/`, with stale-lock takeover and a recently-built short-circuit) so concurrent `vitest` invocations in the same checkout run a `globalSetup` build exactly once instead of racing (#191). Lock timings are tunable via `VITEST_AGENT_RUNSCRIPT_LOCK_*` env vars. [#243][#243]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#238]: https://github.com/spencerbeggs/vitest-agent/pull/238

[#243]: https://github.com/spencerbeggs/vitest-agent/pull/243

[#249]: https://github.com/spencerbeggs/vitest-agent/pull/249

## 2.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.1.0 | 2.1.1 |
| @vitest-agent/mcp | dependency | updated | 2.1.3 | 2.1.4 |
| @vitest-agent/reporter | dependency | updated | 2.0.18 | 2.0.19 |
| @vitest-agent/sdk | dependency | updated | 2.2.0 | 2.2.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.11.1 | ^0.11.2 | [#234][#234] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#234]: https://github.com/spencerbeggs/vitest-agent/pull/234

## 2.2.0

### Bug Fixes

- ### Behavior change
  `@vitest-agent/plugin@2.1.0` widened test discovery to collect `__test__/` directories nested anywhere in a package tree, not only at the project root next to `src/`. That include glob (`**/__test__/**`) is unanchored, and Vitest matches it literally with no concept of a nested `package.json` boundary. For a workspace at the repository root — which `@effected/workspaces` reports as a workspace of its own — the pattern globbed the entire repository and collected unrelated test suites against the wrong toolchain.

  Discovery now collects tests only from `<package>/src/**` and `<package>/__test__/**`, anchored at the package root. A `__test__/` directory nested anywhere else — `lib/scripts/__test__/`, for example — is no longer discovered. If you moved tests into a nested `__test__/` directory on the strength of the 2.1.0 change, Vitest will silently stop collecting them; move them back under the package's own `src/` or `__test__/` directory. If you use the Claude Code plugin, a new PreToolUse hook now flags an attempt to write a new test file to an invalid location before the mistake happens again. Everyone else can check a suspect path on demand with `npx vitest-agent agent check-test-path <path>`, which prints the same verdict the hook acts on.

  The unanchored `**/dist/**` exclude the widened glob required is gone, replaced by bounded exclusions: `node_modules/`, `.git/` and `dist/` are each excluded under both `src/**` and `__test__/**`. An anchored include already cannot reach a package's own top-level `dist/`; the bounded form additionally covers build output nested deeper, so the emitted config prunes exactly what the walk behind it prunes. Both read the shared `NON_DISCOVERABLE_DIRS` constant in `@vitest-agent/sdk`.
  - Discovery's process-level cache signature (used to detect test files added, removed, moved, or renamed between calls) now fingerprints only each package's `src/` and `__test__/` directories, instead of walking every nested `__test__/` directory and tracking `package.json` boundary markers. [#228][#228]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.17 | 2.1.0 |
| @vitest-agent/mcp | dependency | updated | 2.1.2 | 2.1.3 |
| @vitest-agent/reporter | dependency | updated | 2.0.17 | 2.0.18 |
| @vitest-agent/sdk | dependency | updated | 2.1.0 | 2.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#228]: https://github.com/spencerbeggs/vitest-agent/pull/228

## 2.1.0

### Features

- ### Render survives a persistence failure
  When database persistence (or its startup migration) fails, `AgentReporter` now still renders test results to the console instead of aborting the run with no output at all. A follow-up stderr line makes clear the results shown were **not** recorded to history — `vitest-agent: persistence failed — results above were rendered but NOT recorded: <reason>` — so it's never ambiguous whether a shown result also landed in the database.
  ### Nested `__test__/` directory discovery
  Test discovery now recognizes `__test__/` directories anywhere in a package tree, not only at the project root next to `src/` — for example `lib/scripts/__test__/`. A package-boundary walker keeps the broader scan from re-entering a nested package's own tests or a fixture's `node_modules`.

### Bug Fixes

- Per-project test run reason: one failing project's tests no longer mark every other project's row as "failed" in a multi-project run — each project's persisted run reason is now derived from that project's own results
- `stringifyFailureValue` no longer throws when a value's own `String()` conversion throws [#223][#223]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.16 | 2.0.17 |
| @vitest-agent/mcp | dependency | updated | 2.1.1 | 2.1.2 |
| @vitest-agent/reporter | dependency | updated | 2.0.16 | 2.0.17 |
| @vitest-agent/sdk | dependency | updated | 2.0.16 | 2.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#223]: https://github.com/spencerbeggs/vitest-agent/pull/223

## 2.0.16

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.15 | 2.0.16 |
| @vitest-agent/mcp | dependency | updated | 2.1.0 | 2.1.1 |
| @vitest-agent/reporter | dependency | updated | 2.0.15 | 2.0.16 |
| @vitest-agent/sdk | dependency | updated | 2.0.15 | 2.0.16 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.11.0 | ^0.11.1 | [#221][#221] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#221]: https://github.com/spencerbeggs/vitest-agent/pull/221

## 2.0.15

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.14 | 2.0.15 |
| @vitest-agent/mcp | dependency | updated | 2.0.14 | 2.1.0 |
| @vitest-agent/reporter | dependency | updated | 2.0.14 | 2.0.15 |
| @vitest-agent/sdk | dependency | updated | 2.0.14 | 2.0.15 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/platform-node | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |  |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |  |
  | @effected/workspaces | dependency | updated | ^0.10.2 | ^0.11.0 |  |
  | effect | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 | [#219][#219] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#219]: https://github.com/spencerbeggs/vitest-agent/pull/219

## 2.0.14

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/mcp | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/reporter | dependency | updated | 2.0.13 | 2.0.14 |
| @vitest-agent/sdk | dependency | updated | 2.0.13 | 2.0.14 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.9.4 | ^0.10.2 | [#215][#215] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#215]: https://github.com/spencerbeggs/vitest-agent/pull/215

## 2.0.13

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/mcp | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/reporter | dependency | updated | 2.0.12 | 2.0.13 |
| @vitest-agent/sdk | dependency | updated | 2.0.12 | 2.0.13 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.9.3 | ^0.9.4 | [#210][#210] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#210]: https://github.com/spencerbeggs/vitest-agent/pull/210

## 2.0.12

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/mcp | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/reporter | dependency | updated | 2.0.11 | 2.0.12 |
| @vitest-agent/sdk | dependency | updated | 2.0.11 | 2.0.12 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.9.1 | ^0.9.3 |  |
  | vitest | peerDependency | updated | 4.1.10 | ^4.1.0 | [#208][#208] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#208]: https://github.com/spencerbeggs/vitest-agent/pull/208

## 2.0.11

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/mcp | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/reporter | dependency | updated | 2.0.10 | 2.0.11 |
| @vitest-agent/sdk | dependency | updated | 2.0.10 | 2.0.11 |

## 2.0.10

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/mcp | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/reporter | dependency | updated | 2.0.9 | 2.0.10 |
| @vitest-agent/sdk | dependency | updated | 2.0.9 | 2.0.10 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.8.0 | ^0.9.1 | [#198][#198] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#198]: https://github.com/spencerbeggs/vitest-agent/pull/198

## 2.0.9

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/mcp | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/reporter | dependency | updated | 2.0.8 | 2.0.9 |
| @vitest-agent/sdk | dependency | updated | 2.0.8 | 2.0.9 |

## 2.0.8

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/mcp | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/reporter | dependency | updated | 2.0.7 | 2.0.8 |
| @vitest-agent/sdk | dependency | updated | 2.0.7 | 2.0.8 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.6.2 | ^0.8.0 | [#188][#188] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#188]: https://github.com/spencerbeggs/vitest-agent/pull/188

## 2.0.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/mcp | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/reporter | dependency | updated | 2.0.6 | 2.0.7 |
| @vitest-agent/sdk | dependency | updated | 2.0.6 | 2.0.7 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/platform-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |  |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |  |
  | @effected/workspaces | dependency | updated | ^0.6.1 | ^0.6.2 |  |
  | effect | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |  |
  | magic-string | dependency | updated | ^1.0.0 | ^1.1.0 | [#185][#185] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#185]: https://github.com/spencerbeggs/vitest-agent/pull/185

## 2.0.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/mcp | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/reporter | dependency | updated | 2.0.5 | 2.0.6 |
| @vitest-agent/sdk | dependency | updated | 2.0.5 | 2.0.6 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.6.0 | ^0.6.1 | [#181][#181] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#181]: https://github.com/spencerbeggs/vitest-agent/pull/181

## 2.0.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/mcp | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/reporter | dependency | updated | 2.0.4 | 2.0.5 |
| @vitest-agent/sdk | dependency | updated | 2.0.4 | 2.0.5 |

## 2.0.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/mcp | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/reporter | dependency | updated | 2.0.3 | 2.0.4 |
| @vitest-agent/sdk | dependency | updated | 2.0.3 | 2.0.4 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.5.2 | ^0.6.0 | [#173][#173] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#173]: https://github.com/spencerbeggs/vitest-agent/pull/173

## 2.0.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/mcp | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/reporter | dependency | updated | 2.0.2 | 2.0.3 |
| @vitest-agent/sdk | dependency | updated | 2.0.2 | 2.0.3 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.4.1 | ^0.5.2 | [#170][#170] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#170]: https://github.com/spencerbeggs/vitest-agent/pull/170

## 2.0.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/mcp | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/reporter | dependency | updated | 2.0.1 | 2.0.2 |
| @vitest-agent/sdk | dependency | updated | 2.0.1 | 2.0.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/platform-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |  |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |  |
  | @effected/workspaces | dependency | updated | ^0.4.0 | ^0.4.1 |  |
  | effect | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 2.0.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/mcp | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/reporter | dependency | updated | 2.0.0 | 2.0.1 |
| @vitest-agent/sdk | dependency | updated | 2.0.0 | 2.0.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/workspaces | dependency | updated | ^0.3.1 | ^0.4.0 | [#164][#164] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#164]: https://github.com/spencerbeggs/vitest-agent/pull/164

## 2.0.0

### Breaking Changes

- ### Effect v4
  `@vitest-agent/plugin` now runs on Effect v4 (`effect@4.0.0-beta.98`). `@effect/platform-node`'s `NodeContext` is renamed to `NodeServices`. `better-sqlite3` is no longer a dependency — the data layer runs on Node's built-in `node:sqlite`, which raises the effective Node requirement to `>=24.11.0`.
  ### Workspace discovery via `@effected/workspaces`
  `AgentPlugin.discover()`'s project auto-detection now resolves workspace packages through `@effected/workspaces` instead of `workspaces-effect`.
  ### A suite load failure now fails the run
  The reporter's failure detection (`hasFailures`, and therefore the process exit code) now checks `failedFiles.length` instead of `summary.failed`. Previously, a test file that failed to import could render the run as all green while the process still exited non-zero. If your CI treated that gap as a pass before, it will now correctly fail — the underlying import error was always there.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 1.0.8 | 2.0.0 |
| @vitest-agent/mcp | dependency | updated | 1.3.6 | 2.0.0 |
| @vitest-agent/reporter | dependency | updated | 1.0.8 | 2.0.0 |
| @vitest-agent/sdk | dependency | updated | 1.3.4 | 2.0.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | @effect/cluster | dependency | removed | 0.59.0 | — |  |
  | @effect/experimental | dependency | removed | 0.60.0 | — |  |
  | @effect/platform | dependency | removed | 0.96.3 | — |  |
  | @effect/platform-node | dependency | updated | 0.107.0 | 4.0.0-beta.98 |  |
  | @effect/rpc | dependency | removed | 0.75.1 | — |  |
  | @effect/sql | dependency | removed | 0.51.1 | — |  |
  | @effect/sql-sqlite-node | dependency | updated | 0.52.0 | 4.0.0-beta.98 |  |
  | @effect/workflow | dependency | removed | 0.18.2 | — |  |
  | @effected/workspaces | dependency | added | — | 0.3.1 |  |
  | effect | dependency | updated | 3.22.0 | 4.0.0-beta.98 |  |
  | magic-string | dependency | updated | 0.30.21 | 1.0.0 |  |
  | workspaces-effect | dependency | removed | 2.1.0 | — | [#161][#161] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.1.9

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 1.0.7 | 1.0.8 |
| @vitest-agent/mcp | dependency | updated | 1.3.5 | 1.3.6 |
| @vitest-agent/reporter | dependency | updated | 1.0.7 | 1.0.8 |
| @vitest-agent/sdk | dependency | updated | 1.3.3 | 1.3.4 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | workspaces-effect | dependency | updated | ^2.0.3 | ^2.1.0 | [#153][#153] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#153]: https://github.com/spencerbeggs/vitest-agent/pull/153

## 1.1.8

### Bug Fixes

- The `tdd-task` agent can now deliver its final report and answer a `shutdown_request` when dispatched as a named teammate — added `SendMessage` to its tool allowlist, since without an explicit reply the orchestrator never saw the agent's result (#137)
- The `tdd-task` agent's tool allowlist also gains `LSP` (post-edit type errors and code navigation during the red-green-refactor loop) and `ReportFindings` (structured finding reports when its test-quality review passes call for them) [#141][#141]

* Fixed `DataStoreError: NOT NULL constraint failed: coverage_baselines.value` on runs with no coverage data (e.g. `vitest run --passWithNoTests` in a workspace with no test files) — an empty coverage map now short-circuits to "no coverage report" instead of producing a report with non-numeric ("Unknown") totals that fed `NaN` into the baseline ratchet math (#130) [#141][#141]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 1.0.6 | 1.0.7 |
| @vitest-agent/mcp | dependency | updated | 1.3.4 | 1.3.5 |
| @vitest-agent/reporter | dependency | updated | 1.0.6 | 1.0.7 |
| @vitest-agent/sdk | dependency | updated | 1.3.2 | 1.3.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#141]: https://github.com/spencerbeggs/vitest-agent/pull/141

## 1.1.7

### Bug Fixes

- Fixed a Vite transform bug (#133) where wrapper testers with a `(name, self, timeout)` signature — `@effect/vitest`'s `it.effect`, `it.live`, and `layer()` — were corrupted by argument rewriting, throwing "Cannot use two functions as arguments" and collecting 0 tests. Classification tags are now applied via a guarded file-level prelude at test-collection time, so every declaration form inherits them correctly: native `it`/`test`, `@effect/vitest` testers, `test.extend` aliases, numeric-timeout third-argument calls, and dynamically registered tests. Tests that already declare their own tags now merge with classification tags instead of being skipped, and files degrade to untagged (rather than failing to load) if the required Vitest runner API is unavailable.
- `@vitest-agent/cli` and `@vitest-agent/mcp` now publish as exact-pinned regular dependencies of the plugin instead of `peerDependencies`. The prior peer form could trigger pnpm's auto-install-peers resolution to pull mismatched `effect` versions into consuming projects; their bins are still hoisted automatically. [#134][#134]

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | acorn | dependency | removed | ^8.17.0 | — |  |
  | acorn-typescript | dependency | removed | ^1.4.13 | — | [#134][#134] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/vitest-agent/pull/134

## 1.1.6

### Bug Fixes

- Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 1.0.5 | 1.0.6 |
| @vitest-agent/mcp | dependency | updated | 1.3.3 | 1.3.4 |
| @vitest-agent/reporter | dependency | updated | 1.0.5 | 1.0.6 |
| @vitest-agent/sdk | dependency | updated | 1.3.1 | 1.3.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effect/experimental | dependency | added | — | ^0.60.0 |  |
  | @effect/workflow | dependency | added | — | ^0.18.2 |  |
  | @effect/printer | dependency | added | — | ^0.49.0 |  |
  | @effect/printer-ansi | dependency | added | — | ^0.49.0 |  |
  | @effect/typeclass | dependency | added | — | ^0.40.0 | [#128][#128] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.1.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 1.0.4 | 1.0.5 |
| @vitest-agent/mcp | dependency | updated | 1.3.2 | 1.3.3 |
| @vitest-agent/reporter | dependency | updated | 1.0.4 | 1.0.5 |
| @vitest-agent/sdk | dependency | updated | 1.3.0 | 1.3.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | workspaces-effect | dependency | updated | ^1.3.0 | ^2.0.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 1.1.4

### Bug Fixes

- [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) The reporter now threads each test's module path into history writes and classification lookups, so identically-named tests in different files are tracked as independent history series instead of colliding (see the `@vitest-agent/sdk` fix for `test_history` identity)

  | Dependency | Type | Action | From | To |
  | --- | --- | --- | --- | --- |
  | @vitest-agent/sdk | dependency | updated | 1.2.0 | 1.3.0 |
  | @vitest-agent/mcp | dependency | updated | 1.3.1 | 1.3.2 |
  | @vitest-agent/cli | dependency | updated | 1.0.3 | 1.0.4 |
  | @vitest-agent/reporter | dependency | updated | 1.0.3 | 1.0.4 |

### Dependencies

- [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) \| Dependency \| Type \| Action \| From \| To \|
  \| ----------------- \| ---------- \| ------- \| ------ \| ------ \|
  \| workspaces-effect \| dependency \| updated \| ^1.2.0 \| ^1.3.0 \|

## 1.1.3

### Patch Changes

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 1.3.0 | 1.3.1 |
| @vitest-agent/sdk | dependency | updated | 1.1.0 | 1.2.0 |
| @vitest-agent/cli | dependency | updated | 1.0.2 | 1.0.3 |
| @vitest-agent/reporter | dependency | updated | 1.0.2 | 1.0.3 |

## 1.1.2

### Bug Fixes

- [`3cf7502`](https://github.com/spencerbeggs/vitest-agent/commit/3cf7502360086e80ed5ea96ab1154bf1e9537ef5) Fixed the discovery project cache persisting for the life of the process with no invalidation, which could serve a long-lived MCP server stale test project include-globs (and stale/"lost" test counts) after test files were added, removed, or moved on disk. The cache now self-invalidates when the on-disk test-file set changes, so moving or adding test files no longer produces phantom count drops and no restart is needed.
- Suppressed the repeated benign `[vite] (ssr) Failed to load source map` warnings that Vite core emits under v8 coverage due to missing `.js.map` files in the TypeScript npm tarball. All other Vite warnings still pass through unchanged, so console output stays clean under coverage with no config required.

  | Dependency | Type | Action | From | To |
  | --- | --- | --- | --- | --- |
  | @vitest-agent/mcp | dependency | updated | 1.2.0 | 1.3.0 |

## 1.1.1

### Build System

- [`edad2ac`](https://github.com/spencerbeggs/vitest-agent/commit/edad2acebe07258be116f9e7633ca8f66024d8d5) The published `peerDependencies` on `@vitest-agent/cli` and `@vitest-agent/mcp` are now exact-pinned instead of an inexact caret range, so an installed plugin always pulls the exact cli and mcp versions it was built against. They are declared as source `workspace:*` dependencies and promoted back to peers by the build transform.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/mcp | dependency | updated | 1.1.0 | 1.2.0 |

- [`edad2ac`](https://github.com/spencerbeggs/vitest-agent/commit/edad2acebe07258be116f9e7633ca8f66024d8d5) \| Dependency \| Type \| Action \| From \| To \|
  \| ----------------- \| -------------- \| ------- \| ------ \| ----- \|
  \| @vitest-agent/cli \| peerDependency \| updated \| ^1.0.2 \| 1.0.2 \|
  \| @vitest-agent/mcp \| peerDependency \| updated \| ^1.1.0 \| 1.1.0 \|

## 1.1.0

### Features

- [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) ### VITEST_AGENT_CONSOLE Env Var

Set `VITEST_AGENT_CONSOLE` to override the console mode that `AgentPlugin` resolves from the `console` option matrix for a single Vitest invocation. Accepted values mirror the per-executor slots:

- `human` executor: `passthrough`, `silent`, `stream`, `agent`
- `agent` executor: `passthrough`, `silent`, `agent`
- `ci` executor: `passthrough`, `silent`, `ci-annotations`

An invalid value for the detected executor is silently ignored and a diagnostic is written to stderr, leaving the config-derived mode in effect. This is an escape hatch for CI pipelines, local debugging sessions, and test setups where modifying `vitest.config.ts` is not practical.

### Bug Fixes

- [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) `CoverageOptions` is now exported from the `@vitest-agent/plugin` entry point. The interface appears in `CoverageAnalyzer`'s public method signatures and was reachable through type inference but not directly importable. The package now reports zero API Extractor errors with no new suppressions.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/reporter | dependency | updated | 1.0.1 | 1.0.2 |
| @vitest-agent/sdk | dependency | updated | 1.0.1 | 1.1.0 |

- [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) \| Dependency \| Type \| Action \| From \| To \|
  \| ------------------ \| ------------- \| ------- \| ------- \| ------ \|
  \| @savvy-web/bundler \| devDependency \| updated \| ^0.11.1 \| ^1.0.1 \|

### Maintenance

- [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) Removed the cross-package version drift check from `AgentPlugin`. The plugin no longer compares its version against `@vitest-agent/sdk` and `@vitest-agent/reporter` at construction time and no longer writes a version drift warning to stderr. The `CURRENT_PLUGIN_VERSION` constant remains exported for version introspection.

## 1.0.1

### Bug Fixes

- [`3cfd166`](https://github.com/spencerbeggs/vitest-agent/commit/3cfd166de45227d28aa77d16f7b4237053509e27) `AgentPlugin.discover()` no longer picks up or runs test files inside `node_modules`. The custom `test.exclude` emitted for packages with a `__test__` directory now preserves Vitest's default `**/node_modules/**` exclusion.

  | Dependency | Type | Action | From | To |
  | --- | --- | --- | --- | --- |
  | @vitest-agent/mcp | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/reporter | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/sdk | dependency | updated | 1.0.0 | 1.0.1 |
  | @vitest-agent/cli | dependency | updated | 1.0.0 | 1.0.1 |

## 1.0.0

### Features

- [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release of the Vitest plugin for LLM coding agents. `AgentPlugin` targets Vitest >= 4.1.0 with four-environment detection, reporter-chain management, Full and UI-only operating modes gated by Vitest's native `coverage.enabled`, a `ConfigValidation` service for coverage-config diagnostics, pluggable rendering via `VitestAgentReporterFactory`, typed `coverageTargets` with `COVERAGE_LEVELS` presets, and per-project trend tracking.

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

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/mcp | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/reporter | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/sdk | dependency | updated | 0.0.0 | 1.0.0 |
