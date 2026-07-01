# @vitest-agent/mcp

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
