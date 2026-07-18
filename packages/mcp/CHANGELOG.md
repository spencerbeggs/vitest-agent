# @vitest-agent/mcp

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
