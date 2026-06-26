# @vitest-agent/mcp

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
