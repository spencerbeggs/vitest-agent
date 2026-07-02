# @vitest-agent/cli

## 1.0.4

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.2.0 | 1.3.0 |

## 1.0.3

### Patch Changes

| Dependency        | Type       | Action  | From  | To    |
| ----------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk | dependency | updated | 1.1.0 | 1.2.0 |

## 1.0.2

### Dependencies

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) | Dependency | Type | Action | From | To |
  \| ------------------ | ------------- | ------- | ------- | ------ |
  \| @savvy-web/bundler | devDependency | updated | ^0.11.1 | ^1.0.1 |

### Maintenance

* [`3e0cfe3`](https://github.com/spencerbeggs/vitest-agent/commit/3e0cfe38157ef21bfe1d817f557914ce79a43885) Removed the cross-package version drift check from the CLI bin entrypoint. The `vitest-agent` CLI no longer compares its version against `@vitest-agent/sdk` at startup and no longer writes a version drift warning to stderr. The `CURRENT_CLI_VERSION` constant remains exported for version introspection.
  | Dependency            | Type       | Action  | From  | To    |
  | --------------------- | ---------- | ------- | ----- | ----- |
  | @vitest-agent/sdk     | dependency | updated | 1.0.1 | 1.1.0 |
  | @vitest-agent/sidecar | dependency | updated | 1.0.1 | 1.0.2 |

## 1.0.1

### Patch Changes

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk     | dependency | updated | 1.0.0 | 1.0.1 |
| @vitest-agent/sidecar | dependency | updated | 1.0.0 | 1.0.1 |

## 1.0.0

### Features

* [`e509228`](https://github.com/spencerbeggs/vitest-agent/commit/e5092289c0f64446dddc8ad0abc25856d8d08e97) Initial stable release. The `vitest-agent` CLI: a `doctor` command, a `db` command group (`path`, `prune`, `reset`, `query`), and an `agent` namespace for hook-driven plumbing (`triage`, `wrapup`, `record`, `register-agent`, `end-agent`, `inject-env`, `sidecar-path`).

### Patch Changes

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @vitest-agent/sdk     | dependency | updated | 0.0.0 | 1.0.0 |
| @vitest-agent/sidecar | dependency | updated | 0.0.0 | 1.0.0 |
