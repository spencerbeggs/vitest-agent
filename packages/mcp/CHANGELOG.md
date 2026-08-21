# @vitest-agent/mcp

## 2.3.4

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.4.3 | 2.4.4 |

## 2.3.3

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.4.2 | 2.4.3 |

## 2.3.2

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.4.1 | 2.4.2 |

## 2.3.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.4.0 | 2.4.1 |

## 2.3.0

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.3.1 | 2.4.0 |

### Maintenance

* Bumps all packages to use `effect@rc.109`

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 2.2.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.3.0 | 2.3.1 |

## 2.2.0

### Features

* Every served tool's input schema is now strict — an unknown key is rejected with an error naming the offending key(s) and the full list of accepted params, instead of being silently stripped. A mistyped `run_tests` param used to run the entire workspace and time out at the 120s default instead of surfacing the typo.

* `run_tests` gained working `tags` and `passWithNoTests` params — both were declared on the tool's internal implementation but never reached the served schema, so a real client's tag filter was dropped and the run went wide (#200). The `ok` result also gained a `scope` field echoing the resolved run:

  ```ts
  const result = await run_tests({ project: "sdk", tags: { any: ["int"] } });
  // result.scope -> { project: "sdk", files: [], tags: { any: ["int"] } }
  ```

* `test_history` accepts optional `testName`, `modulePath`, and `limit` params, pushed down as SQL predicates with a per-test run cap (default 20). Narrowing to one test or module avoids the multi-hundred-KB whole-project payload the tool used to return for every call.

### Bug Fixes

* `test({ action: "get" })` now scopes its history lookup to the matched test's own module. Previously, two same-named tests in different modules could return each other's history (#241).
* The server survives a stray `unhandledRejection` / `uncaughtException` raised after the transport connects — it logs to stderr and the stdio transport stays alive instead of dying mid-session. A tool resolver that throws unexpectedly now returns a structured error result instead of crashing the call. [#243][#243]

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.2.1 | 2.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#243]: https://github.com/spencerbeggs/vitest-agent/pull/243

## 2.1.4

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.2.0 | 2.2.1 |

## 2.1.3

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.1.0 | 2.2.0 |

## 2.1.2

### Bug Fixes

* `run_tests` now gives each MCP-driven invocation its own coverage `reportsDirectory` (via `mkdtemp`), fixing collisions where two concurrent runs deleted each other's in-flight coverage report files
* Scope: this fix covers runs launched through the MCP server's `run_tests` tool. Concurrent direct `vitest` process invocations outside the MCP tool still share the default coverage directory and can still collide [#223][#223]

### Dependencies

| Dependency        | Type       | Action  | From   | To    |
| ----------------- | ---------- | ------- | ------ | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.16 | 2.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#223]: https://github.com/spencerbeggs/vitest-agent/pull/223

## 2.1.1

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.15 | 2.0.16 |

## 2.1.0

### Bug Fixes

* Restores the field descriptions that MCP tools advertise on numeric values in their `outputSchema`.

  Effect 4.0.0-beta.107 lowers `Schema.Number` to `anyOf: [number, "NaN", "Infinity", "-Infinity"]` and drops any `title` / `description` / `examples` annotation on the way, so every annotated numeric field across the tool surface silently lost its documentation. Numeric result fields now use `Schema.Finite`, which keeps the annotation and lowers to a plain `number` — a closer match for JSON output, where the non-finite values were never representable anyway.

  * 29 numeric result fields across 11 tools now carry their descriptions again
  * Numeric fields lower to `type: number` instead of a four-branch `anyOf`
  * The values these fields carry — row counts, primary keys, durations, and the four `acceptance_metrics` ratios — were already finite, so no tool changes what it emits

  ### Annotation lifting in the Effect-to-zod bridge

  `effectToZodSchema` now hoists JSON Schema annotation keywords out of the `allOf` wrapper that Effect emits for a checked schema, so they reach the served tool schema instead of being buried a level down. Only the annotation vocabulary moves; constraint keywords stay exactly where the lowering put them. [#219][#219]

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.14 | 2.0.15 |

* | Dependency              | Type       | Action  | From           | To             |                                                                            |
  | ----------------------- | ---------- | ------- | -------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 | [#219][#219] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#219]: https://github.com/spencerbeggs/vitest-agent/pull/219

## 2.0.14

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.13 | 2.0.14 |

## 2.0.13

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.12 | 2.0.13 |

## 2.0.12

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.11 | 2.0.12 |

## 2.0.11

### Dependencies

| Dependency        | Type       | Action  | From   | To     |
| ----------------- | ---------- | ------- | ------ | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.10 | 2.0.11 |

* | Dependency                | Type       | Action  | From    | To      |                                                                            |
  | ------------------------- | ---------- | ------- | ------- | ------- | -------------------------------------------------------------------------- |
  | @modelcontextprotocol/sdk | dependency | updated | ^1.29.0 | ^1.30.0 | [#205][#205] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#205]: https://github.com/spencerbeggs/vitest-agent/pull/205

## 2.0.10

### Dependencies

| Dependency        | Type       | Action  | From  | To     |
| ----------------- | ---------- | ------- | ----- | ------ |
| @vitest-agent/sdk | dependency | updated | 2.0.9 | 2.0.10 |

## 2.0.9

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.8 | 2.0.9 |

## 2.0.8

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.7 | 2.0.8 |

## 2.0.7

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.6 | 2.0.7 |

* | Dependency              | Type       | Action  | From          | To             |                                                                            |
  | ----------------------- | ---------- | ------- | ------------- | -------------- | -------------------------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 |                                                                            |
  | effect                  | dependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#185][#185] Thanks [@spencerbeggs](https://github.com/apps/spencerbeggs)! |

### Patch Changes

[#185]: https://github.com/spencerbeggs/vitest-agent/pull/185

## 2.0.6

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.5 | 2.0.6 |

## 2.0.5

### Bug Fixes

* The `hypothesis` tool's `record` action now accepts a `tddTaskId` (number or numeric string) to bind the hypothesis deterministically to the session the TDD task was opened under; an unknown `tddTaskId` now fails with a typed error instead of silently misattributing the hypothesis. `sessionId` remains only as a dev/test fallback and is no longer the primary binding path.
* Synced the MCP-SDK-side `hypothesis` tool registration to declare and forward `tddTaskId` — previously it was wired only on the tRPC side, making the deterministic binding unreachable from real MCP clients.
* The server's recovered session context now heals lazily at the first tool call from the Claude Code plugin's per-session env files when boot-time recovery found nothing, surviving both a fresh-launch boot race and a `/reload-plugins` restart.
* Exposed `buildMcpServer` (transport-free server construction for testing served tool schemas), `parseSessionEnvExports`, and `recoverSessionContextFromSessionEnv` as public exports. [#177][#177]

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.4 | 2.0.5 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#177]: https://github.com/spencerbeggs/vitest-agent/pull/177

## 2.0.4

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.3 | 2.0.4 |

## 2.0.3

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.2 | 2.0.3 |

## 2.0.2

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.1 | 2.0.2 |

* | Dependency              | Type       | Action  | From          | To            |                                                          |
  | ----------------------- | ---------- | ------- | ------------- | ------------- | -------------------------------------------------------- |
  | @effect/platform-node   | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | @effect/sql-sqlite-node | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 |                                                          |
  | effect                  | dependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 2.0.1

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 2.0.0 | 2.0.1 |

## 2.0.0

### Breaking Changes

* ### Effect v4

  `@vitest-agent/mcp` now runs on Effect v4 (`effect@4.0.0-beta.98`). The SQL/data layer moves to `effect/unstable/sql` on Node's built-in `node:sqlite` (via `@vitest-agent/sdk`), which raises the effective Node requirement to `>=24.11.0`.

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.4 | 2.0.0 |

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
  | effect                  | dependency | updated | 3.22.0  | 4.0.0-beta.98 | [#161][#161] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#161]: https://github.com/spencerbeggs/vitest-agent/pull/161

## 1.3.6

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.3 | 1.3.4 |

## 1.3.5

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.2 | 1.3.3 |

## 1.3.4

### Bug Fixes

* Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.1 | 1.3.2 |

* | Dependency           | Type       | Action | From | To      |                                                                       |
  | -------------------- | ---------- | ------ | ---- | ------- | --------------------------------------------------------------------- |
  | @effect/experimental | dependency | added  | —    | ^0.60.0 |                                                                       |
  | @effect/workflow     | dependency | added  | —    | ^0.18.2 |                                                                       |
  | @effect/printer      | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/printer-ansi | dependency | added  | —    | ^0.49.0 |                                                                       |
  | @effect/typeclass    | dependency | added  | —    | ^0.40.0 | [#128][#128] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#128]: https://github.com/spencerbeggs/vitest-agent/pull/128

## 1.3.3

### Dependencies

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.3.0 | 1.3.1 |

## 1.3.2

### Features

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) `test_history` tool output rows (`FlakyTestRow`, `PersistentFailureRow`, `RecoveredTestRow`) and the generated markdown now include `modulePath`, so same-named tests in different files are distinguishable in the results
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.2.0 | 1.3.0 |

### Bug Fixes

* [`45529da`](https://github.com/spencerbeggs/vitest-agent/commit/45529da0b14ea7f828dce0fec941b166cac1bdb5) `test_history`'s "Recovered" detection previously compared the last two entries in `runs` as if the array were oldest-first; `runs` is actually ordered most-recent-first, so the comparison had it backwards. Fixed the ordering so recovered tests (previously failing, now passing) are detected correctly.

## 1.3.1

### Bug Fixes

* [`813cf45`](https://github.com/spencerbeggs/vitest-agent/commit/813cf45cb9a8809c1766640d5e20669f1b77a251) Fixes `tdd_phase_transition_request` artifact auto-resolution picking the newest matching artifact for the whole task, ignoring which behavior it belonged to (#115).

- The lookup is now scoped by `behaviorId` only on transitions where behavior-match binding actually applies (`red→green` and `green→refactor`), using the sdk's `transitionEnforcesBehaviorMatch` predicate.
- `red.triangulate→green` and `refactor→red` remain unscoped, since their evidence legitimately belongs to a different behavior than the one being requested.
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.1.0 | 1.2.0 |

## 1.3.0

### Features

* [`3cf7502`](https://github.com/spencerbeggs/vitest-agent/commit/3cf7502360086e80ed5ea96ab1154bf1e9537ef5) Added `discoveryLastScannedAt` to the `run_tests` tool result (`RunTestsOk`) — an ISO timestamp of the most recent real disk scan performed by discovery, or `null` if discovery hasn't scanned disk yet in this process. Lets an agent confirm whether a suspicious test count reflects a fresh scan rather than a stale cache. Additive and backward-compatible.

## 1.2.0

### Refactoring

* [`edad2ac`](https://github.com/spencerbeggs/vitest-agent/commit/edad2acebe07258be116f9e7633ca8f66024d8d5) ### Removed the MCP resource subsystem

The four MCP resources served under the `vitest://docs/` and `vitest-agent://patterns/` URI schemes have been removed, along with the vendored Vitest documentation corpus, the curated patterns library, and the snapshot-maintenance build pipeline that generated them.

Removing the resource corpus also fixes a boot failure ("cannot locate the served corpus") that occurred when the server was built with `@savvy-web/bundler` 1.0.0 or later.

All 29 tRPC-backed tools and the six framing prompts are unaffected. Agents that fetched documentation or pattern content via resource URIs should instead read the equivalent content from the public docs site at vitest-agent.dev; there is no direct resource-URI replacement.

## 1.1.0

### Features

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) ### Console Leak Signal in run\_tests

The `run_tests` tool now collects stray console output during the test run and folds it into the `AgentReport` as an optional `consoleLeaks` field. The structured signal includes:

* Total write count across the run
* Per-file stdout/stderr split with up to 10 attributable test names per file
* A truncated first-line sample of the first write seen per file
* A `truncated` flag when more than 25 files produced stray output

The tool's markdown output includes a one-line warning when leaks are present:

```text
⚠ N stray console writes across M+ files (see consoleLeaks)
```

No configuration is required. The signal is omitted entirely on runs with no stray output.

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.0.1 | 1.1.0 |

### Maintenance

* [`4b4f91e`](https://github.com/spencerbeggs/vitest-agent/commit/4b4f91ec09e713cec7ffbc3464c70cfac4637e94) Removed the cross-package version drift check from the MCP server startup path. `vitest-agent-mcp` no longer compares its version against `@vitest-agent/sdk` at init and no longer writes a version drift warning to stderr. The `CURRENT_MCP_VERSION` constant remains exported for version introspection.

## 1.0.1

### Bug Fixes

* [`cd32395`](https://github.com/spencerbeggs/vitest-agent/commit/cd32395ce1a6950811f75b83a6d60a15140ac673) Fixes `ENOENT` errors when MCP clients read from `vitest://docs/` or `vitest-agent://patterns/` resources. The vendored Vitest documentation and curated testing pattern corpora were missing from the published package; both resource URI schemes now serve their content correctly.
  | Dependency        | Type       | Action  | From  | To    |
  | ----------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk | dependency | updated | 1.0.0 | 1.0.1 |

### Documentation

* [`b51e7f6`](https://github.com/spencerbeggs/vitest-agent/commit/b51e7f6a5177915a0818c6d95c71a888443d6594) Adds four agent-facing patterns to the `vitest-agent://patterns/` corpus: an operating-as-an-agent orientation index, a run\_tests operability reference, a silencing-leaking-output cookbook, and a known-issues-and-caveats troubleshooting page. Closes the dogfooding documentation gaps reported in #101, #102, and #103.

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. The `vitest-agent-mcp` server exposes the test landscape and TDD workflow to agents through an action-keyed tRPC tool surface, plus MCP resources and framing prompts.

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 0.0.0 | 1.0.0 |
