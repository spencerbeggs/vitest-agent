# @vitest-agent/sdk

## 2.2.0

### Features

* New `test-location` module exports the canonical test-layout rule as a pure function:

  * `classifyTestPath(workspaces, filePath)` — classifies a file path as `valid` (discoverable under a workspace's `src/` or `__test__/` directory), `excluded` (a `__test__/` helper directory — `fixtures/`, `snapshots/`, or `utils/`), or `invalid` (anywhere else), returning a `suggestedPath` for the invalid case. Returns `null` when no supplied workspace contains the path and when the path crosses a directory discovery never walks into, so callers can fail open instead of treating "no verdict" as invalid.
  * `findOwningWorkspace(workspaces, filePath)` — the deepest-containing-workspace attribution `classifyTestPath` uses, exported so callers that need to reason about a path relative to its owning package agree with the classifier about which package owns it.
  * `isTestFileName(filePathOrName)` — the extension half of the rule as a predicate.
  * `SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX`, `NON_DISCOVERABLE_DIRS` — the constants the rule is built from, also consumed by `@vitest-agent/plugin`'s discovery globs, tag-injection gate, test-file walker, and cache signature, so the layout rule has one implementation rather than one per surface.

  The layout rule is single-sourced here; two things around it are deliberately not. A nested `package.json` marks an independent unit whose tests belong to a different discovery pass, and detecting one needs a filesystem probe, so it stays outside the pure classifier — `@vitest-agent/cli`'s `agent check-test-path` applies it in the caller. And the Claude Code plugin's PreToolUse hook keeps a lexical copy of the extension list in bash as a zero-cost prefilter before it spawns anything; it delegates every judgement about location to the CLI.

  Powers the new `vitest-agent agent check-test-path` CLI subcommand and a PreToolUse hook that flags tests written to an invalid location before they ever silently go uncollected. [#228][#228]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#228]: https://github.com/spencerbeggs/vitest-agent/pull/228

## 2.1.0

### Features

* Exported `coerceErrorText` — coerces any unknown error-field value (message, name, diff, stack, …) into a string that is safe to persist or render. Vitest and Effect can put non-string values (arbitrary success values from `Effect.flip`, a throwing `ConfigError.message` getter) into what is typed as a string error field; this handles every case exception-safely.
* `AgentReport.summary.modules`, `RenderState.collectedModules`, and `RunEvent`'s `RunFinished.collectedModules` — new optional fields that carry the true collected-module count through the report and event pipeline, so a fully-passing run no longer reads as "0 modules"

### Bug Fixes

* `extractSqlReason`, `formatFatalError`, and `normalizeAssertionShape` no longer throw when handed a malformed error shape (a throwing `message`/`cause` getter, a non-string message) — they degrade to a placeholder string instead of crashing report generation
* `buildAgentReport` now also marks a module as failed when one of its suites — not just its tests — is in a failed state or carries its own errors. A `beforeAll`/`afterAll` hook throw is attached to the suite entity, not any individual test, and could previously leave a module reporting as fully passed even though the suite itself failed [#223][#223]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#223]: https://github.com/spencerbeggs/vitest-agent/pull/223

## 2.0.16

### Dependencies

* | Dependency           | Type       | Action  | From    | To      |                                                                       |
  | -------------------- | ---------- | ------- | ------- | ------- | --------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.11.0 | ^0.11.1 | [#221][#221] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#221]: https://github.com/spencerbeggs/vitest-agent/pull/221

## 2.0.15

### Dependencies

* | Dependency              | Type       | Action  | From           | To             |                                                                            |
  | ----------------------- | ---------- | ------- | -------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | @effected/config-file   | dependency | updated | ^0.2.1         | ^0.3.0         |                                                                            |
  | @effected/jsonc         | dependency | updated | ^0.5.2         | ^0.6.0         |                                                                            |
  | @effected/toml          | dependency | updated | ^0.3.2         | ^0.4.0         |                                                                            |
  | @effected/walker        | dependency | updated | ^0.3.4         | ^0.4.0         |                                                                            |
  | @effected/workspaces    | dependency | updated | ^0.10.2        | ^0.11.0        |                                                                            |
  | @effected/xdg           | dependency | updated | ^0.1.10        | ^0.2.0         |                                                                            |
  | @effected/yaml          | dependency | updated | ^0.6.1         | ^0.7.0         |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 | [#219][#219] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#219]: https://github.com/spencerbeggs/vitest-agent/pull/219

## 2.0.14

### Dependencies

* | Dependency           | Type       | Action  | From   | To      |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------- | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.9.4 | ^0.10.2 | [#215][#215] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#215]: https://github.com/spencerbeggs/vitest-agent/pull/215

## 2.0.13

### Dependencies

* | Dependency            | Type       | Action  | From   | To      |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------- | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.2.0 | ^0.2.1  |                                                                            |
  | @effected/jsonc       | dependency | updated | ^0.5.1 | ^0.5.2  |                                                                            |
  | @effected/toml        | dependency | updated | ^0.3.1 | ^0.3.2  |                                                                            |
  | @effected/walker      | dependency | updated | ^0.3.3 | ^0.3.4  |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.9.3 | ^0.9.4  |                                                                            |
  | @effected/xdg         | dependency | updated | ^0.1.9 | ^0.1.10 |                                                                            |
  | @effected/yaml        | dependency | updated | ^0.6.0 | ^0.6.1  | [#210][#210] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#210]: https://github.com/spencerbeggs/vitest-agent/pull/210

## 2.0.12

### Dependencies

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.9.1 | ^0.9.3 | [#208][#208] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#208]: https://github.com/spencerbeggs/vitest-agent/pull/208

## 2.0.11

### Dependencies

* | Dependency | Type       | Action  | From    | To      |                                                                            |
  | ---------- | ---------- | ------- | ------- | ------- | -------------------------------------------------------------------------- |
  | acorn      | dependency | updated | ^8.17.0 | ^8.18.0 | [#205][#205] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#205]: https://github.com/spencerbeggs/vitest-agent/pull/205

## 2.0.10

### Dependencies

* | Dependency            | Type       | Action  | From   | To     |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.1.9 | ^0.2.0 |                                                                            |
  | @effected/walker      | dependency | updated | ^0.3.2 | ^0.3.3 |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.8.0 | ^0.9.1 |                                                                            |
  | @effected/xdg         | dependency | updated | ^0.1.8 | ^0.1.9 | [#198][#198] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#198]: https://github.com/spencerbeggs/vitest-agent/pull/198

## 2.0.9

### Other

* Bump sdk to force rebuild sidecar packages.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 2.0.8

### Dependencies

* | Dependency            | Type       | Action  | From   | To     |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.1.8 | ^0.1.9 |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.6.2 | ^0.8.0 |                                                                            |
  | @effected/yaml        | dependency | updated | ^0.5.1 | ^0.6.0 | [#188][#188] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#188]: https://github.com/spencerbeggs/vitest-agent/pull/188

## 2.0.7

### Dependencies

* | Dependency              | Type       | Action  | From          | To             |                                                                            |
  | ----------------------- | ---------- | ------- | ------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | @effected/config-file   | dependency | updated | ^0.1.7        | ^0.1.8         |                                                                            |
  | @effected/jsonc         | dependency | updated | ^0.5.0        | ^0.5.1         |                                                                            |
  | @effected/toml          | dependency | updated | ^0.3.0        | ^0.3.1         |                                                                            |
  | @effected/walker        | dependency | updated | ^0.3.1        | ^0.3.2         |                                                                            |
  | @effected/workspaces    | dependency | updated | ^0.6.1        | ^0.6.2         |                                                                            |
  | @effected/xdg           | dependency | updated | ^0.1.7        | ^0.1.8         |                                                                            |
  | @effected/yaml          | dependency | updated | ^0.5.0        | ^0.5.1         |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#185][#185] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#185]: https://github.com/spencerbeggs/vitest-agent/pull/185

## 2.0.6

### Dependencies

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.6.0 | ^0.6.1 | [#181][#181] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#181]: https://github.com/spencerbeggs/vitest-agent/pull/181

## 2.0.5

### Bug Fixes

* Added `DataReader.getSessionByTddTaskId`, resolving the session a TDD task was opened under. Powers the MCP `hypothesis` tool's deterministic session binding by `tddTaskId`. [#177][#177]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#177]: https://github.com/spencerbeggs/vitest-agent/pull/177

## 2.0.4

### Dependencies

* | Dependency           | Type       | Action  | From   | To     |                                                                            |
  | -------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/workspaces | dependency | updated | ^0.5.2 | ^0.6.0 | [#173][#173] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#173]: https://github.com/spencerbeggs/vitest-agent/pull/173

## 2.0.3

### Dependencies

* | Dependency            | Type       | Action  | From   | To     |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.1.4 | ^0.1.7 |                                                                            |
  | @effected/jsonc       | dependency | updated | ^0.4.0 | ^0.5.0 |                                                                            |
  | @effected/toml        | dependency | updated | ^0.2.0 | ^0.3.0 |                                                                            |
  | @effected/walker      | dependency | updated | ^0.2.2 | ^0.3.1 |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.4.1 | ^0.5.2 |                                                                            |
  | @effected/xdg         | dependency | updated | ^0.1.4 | ^0.1.7 |                                                                            |
  | @effected/yaml        | dependency | updated | ^0.4.0 | ^0.5.0 | [#170][#170] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#170]: https://github.com/spencerbeggs/vitest-agent/pull/170

## 2.0.2

### Dependencies

* | Dependency              | Type       | Action  | From          | To            |                                                          |
  | ----------------------- | ---------- | ------- | ------------- | ------------- | -------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | effect                  | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

- | Dependency            | Type       | Action  | From   | To     |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.1.3 | ^0.1.4 |                                                                            |
  | @effected/jsonc       | dependency | updated | ^0.3.0 | ^0.4.0 |                                                                            |
  | @effected/toml        | dependency | updated | ^0.1.0 | ^0.2.0 |                                                                            |
  | @effected/walker      | dependency | updated | ^0.2.1 | ^0.2.2 |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.4.0 | ^0.4.1 |                                                                            |
  | @effected/xdg         | dependency | updated | ^0.1.3 | ^0.1.4 |                                                                            |
  | @effected/yaml        | dependency | updated | ^0.3.1 | ^0.4.0 | [#168][#168] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#168]: https://github.com/spencerbeggs/vitest-agent/pull/168

## 2.0.1

### Dependencies

* | Dependency            | Type       | Action  | From   | To     |                                                                            |
  | --------------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | @effected/config-file | dependency | updated | ^0.1.2 | ^0.1.3 |                                                                            |
  | @effected/jsonc       | dependency | updated | ^0.2.0 | ^0.3.0 |                                                                            |
  | @effected/workspaces  | dependency | updated | ^0.3.1 | ^0.4.0 |                                                                            |
  | @effected/xdg         | dependency | updated | ^0.1.2 | ^0.1.3 |                                                                            |
  | @effected/yaml        | dependency | updated | ^0.3.0 | ^0.3.1 | [#164][#164] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#164]: https://github.com/spencerbeggs/vitest-agent/pull/164

## 2.0.0

### Breaking Changes

* ### Effect v4 runtime

  `@vitest-agent/sdk` now runs on Effect v4 (`effect@4.0.0-beta.98`). Consumers embedding the SDK's schemas, services, or layers directly must upgrade to Effect v4 — the v3 API surface (`Effect.catchAll`, `Schema.annotations`, etc.) is no longer compatible.

  ### SQLite driver moved to node:sqlite

  The data layer moved from `better-sqlite3` to Node's built-in `node:sqlite`, via `effect/unstable/sql` and `@effect/sql-sqlite-node`. `better-sqlite3` is no longer a dependency anywhere in the family. This raises the effective Node requirement to `>=24.11.0`.

  ### XDG, config-file, and workspace resolution now use `@effected/*`

  `xdg-effect`, `config-file-effect`, and `workspaces-effect` are replaced by the `@effected` kit (`@effected/xdg`, `@effected/config-file`, `@effected/workspaces`, plus their `@effected/jsonc`, `@effected/toml`, `@effected/yaml`, and `@effected/walker` building blocks). `WorkspaceRootNotFoundError`'s shape changed: the free-form `reason: string` field is replaced by `markers: ReadonlyArray<string>`.

  **Workspace-root discovery no longer treats a bare `.git` directory as a workspace boundary.** A single-package repo with no `pnpm-workspace.yaml` and no `package.json#workspaces` field now fails `WorkspaceRootNotFoundError` where it previously resolved via `.git`. Whether to add a `.git` fallback is still under discussion — treat this as a known caveat rather than a settled design decision.

  ### SQL error unwrapping walks the full cause chain

  `extractSqlReason` now walks the entire `cause` chain instead of unwrapping a single level. The `node:sqlite` driver commonly nests two wrapper errors, and the previous one-level unwrap surfaced the generic "Failed to execute statement" message instead of the real SQLite reason (e.g. "UNIQUE constraint failed: ...").

### Features

* New `countSuiteFailures(report)` utility — counts suite-level (collection/load) failures that `report.summary.failed` does not capture, so downstream reporters can fold them into failure totals.

### Dependencies

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
  | @effected/config-file   | dependency | added   | —       | 0.1.2         |                                                                       |
  | @effected/jsonc         | dependency | added   | —       | 0.2.0         |                                                                       |
  | @effected/toml          | dependency | added   | —       | 0.1.0         |                                                                       |
  | @effected/walker        | dependency | added   | —       | 0.2.1         |                                                                       |
  | @effected/workspaces    | dependency | added   | —       | 0.3.1         |                                                                       |
  | @effected/xdg           | dependency | added   | —       | 0.1.2         |                                                                       |
  | @effected/yaml          | dependency | added   | —       | 0.3.0         |                                                                       |
  | @types/acorn            | dependency | removed | 6.0.4   | —             |                                                                       |
  | config-file-effect      | dependency | removed | 0.3.0   | —             |                                                                       |
  | effect                  | dependency | updated | 3.22.0  | 4.0.0-beta.98 |                                                                       |
  | workspaces-effect       | dependency | removed | 2.1.0   | —             |                                                                       |
  | xdg-effect              | dependency | removed | 2.1.1   | —             | [#161][#161] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Major Changes

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.3.4

### Dependencies

* | Dependency        | Type       | Action  | From   | To     |                                                                            |
  | ----------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------------------------- |
  | workspaces-effect | dependency | updated | ^2.0.3 | ^2.1.0 | [#153][#153] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#153]: https://github.com/spencerbeggs/vitest-agent/pull/153

## 1.3.3

### Bug Fixes

* `writeBaselines` now skips non-finite metric values (e.g. `NaN` produced by ratchet math over an empty coverage run) instead of binding them as SQL `NULL`, which tripped the `NOT NULL` constraint on `coverage_baselines.value` (#130) [#141][#141]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#141]: https://github.com/spencerbeggs/vitest-agent/pull/141

## 1.3.2

### Bug Fixes

* Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

### Dependencies

* | Dependency           | Type       | Action | From | To      |                                                                       |
  | -------------------- | ---------- | ------ | ---- | ------- | --------------------------------------------------------------------- |
  | @effect/experimental | dependency | added  | —    | ^0.60.0 |                                                                       |
  | @effect/workflow     | dependency | added  | —    | ^0.18.2 |                                                                       |
  | @effect/printer      | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/printer-ansi | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/typeclass    | dependency | added  | —    | ^0.40.0 | [#128][#128] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.3.1

### Dependencies

* | Dependency        | Type       | Action  | From   | To     |                                                          |
  | ----------------- | ---------- | ------- | ------ | ------ | -------------------------------------------------------- |
  | workspaces-effect | dependency | updated | ^1.3.0 | ^2.0.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 1.3.0

### Features

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) `TestHistory` schema and the `FlakyTest` / `PersistentFailure` interfaces gain a `modulePath` field
* Exported `historyKey` from `HistoryTracker` — builds the composite `(modulePath, fullName)` key so consumers can key their own lookup maps consistently
* `DataStore.writeHistory` gains a required `modulePath` parameter. Custom reporters or scripts that call `writeHistory` directly need to pass the test module's path:

```ts
// before
yield * store.writeHistory(project, fullName, runId, timestamp, state);

// after
yield *
  store.writeHistory(project, fullName, modulePath, runId, timestamp, state);
```

Pre-2.0 note: this changes the `test_history` table shape. Delete your local `data.db` after upgrading (standing pre-2.0 policy — no incremental migration was written).

### Bug Fixes

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) Test history is now keyed by file, not just by test name. Previously `test_history` rows were identified by `(project, fullName, timestamp)`, so two test files that happened to share a `describe > it` name collided on write (`UNIQUE constraint failed: test_history`) and were conflated on read — flaky/persistent/recovered detection could merge two unrelated tests into one series, potentially hiding a real persistent failure behind a same-named passing test in another file.

- Added a `modulePath` column; history identity is now `(project, modulePath, fullName, timestamp)` end to end

### Dependencies

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) | Dependency | Type | Action | From | To |
  \| ------------------ | ---------- | ------- | ------ | ------ |
  \| config-file-effect | dependency | updated | ^0.2.3 | ^0.3.0 |
  \| workspaces-effect | dependency | updated | ^1.2.0 | ^1.3.0 |
  \| xdg-effect | dependency | updated | ^2.0.1 | ^2.1.0 |

## 1.2.0

### Features

* [`813cf45`](https://github.com/spencerbeggs/vitest-agent/commit/813cf45cb9a8809c1766640d5e20669f1b77a251) Adds phase-transition support for triangulation batches, where a single implementation satisfies several behaviors and only the first produces its own failing run (#115).

- `requiredArtifactForTransition` now requires a `test_failed_run` for `red.triangulate→green` (previously accepted with no evidence at all) — a triangulation batch must still point at a real failing run, just not necessarily the requested behavior's own.
- `validatePhaseTransition` relaxes the phase-window and behavior-match binding rules specifically for `red.triangulate→green`, so a batch's shared failing run can serve as evidence for a later behavior in the same batch.
- New export `transitionEnforcesBehaviorMatch(from, to)` reports whether D2 binding rule 2 (behavior-match) applies to a transition. It is `true` only for `red→green` and `green→refactor`, and `false` for `red.triangulate→green` and `refactor→red` — letting `refactor→red` cross a behavior boundary in one step without a rebind dance.

```ts
import { transitionEnforcesBehaviorMatch } from "@vitest-agent/sdk";

transitionEnforcesBehaviorMatch("red", "green"); // true
transitionEnforcesBehaviorMatch("red.triangulate", "green"); // false
```

## 1.1.0

### Features

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) ### Console Leak Detection API

New public types and utilities for collecting and aggregating stray console output from a Vitest run into a structured signal.

`ConsoleLeaks` and `ConsoleLeakFile` are Effect Schema types:

```ts
import { ConsoleLeaks, ConsoleLeakFile } from "@vitest-agent/sdk";
// ConsoleLeaks: { total: number; byFile: ConsoleLeakFile[]; truncated?: boolean }
// ConsoleLeakFile: { file: string; stdout: number; stderr: number; tests?: string[]; sample?: string }
```

`buildConsoleLeaks(entries)` aggregates a `ConsoleLeakEntry[]` into a `ConsoleLeaks` signal — bucketing by file, splitting stdout/stderr counts, capturing a truncated first-line sample per file, and sorting by total writes descending. The file list is capped at 25 entries with a `truncated` flag when more are present. Returns `undefined` on a clean run so a report carries no signal when no stray console calls occurred.

`collectConsoleLeakEntries(files)` walks a `ConsoleLeakTask[]` tree (the shape returned by `vitest.state.getFiles()`) into flat `ConsoleLeakEntry` values, attributing each captured write to its enclosing file and test name.

`AgentReport` gains an optional `consoleLeaks` field typed as `ConsoleLeaks | undefined`, populated by the `run_tests` MCP tool when stray writes are detected during the run.

### Bug Fixes

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) `@vitest-agent/sdk/testing` now exports the 79 constituent types that appear in `DataStore` and `DataReader` method signatures — errors, schemas, and identity types that API Extractor flagged as forgotten exports from the testing entry point. Both the value and type sides of each Effect Schema const+type pair are covered. The entry point is now complete with zero new suppressions.

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |

## 1.0.1

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. Shared foundation for the family: Effect Schema data definitions, the SQLite data layer and Effect services, formatters, utilities, and the public reporter and dispatcher contracts. Schemas are re-exported for consumer use. No internal dependencies.
