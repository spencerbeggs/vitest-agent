# @vitest-agent/plugin

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
