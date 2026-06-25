# @vitest-agent/plugin

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
