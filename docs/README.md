# Documentation

## Installation

```bash
npm install vitest-agent-plugin
# or
pnpm add vitest-agent-plugin
# or
yarn add vitest-agent-plugin
```

**Requirements:** Vitest >= 4.1.0 | Node.js >= 22

## Setup

Add `AgentPlugin` to your Vitest config:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.standard;
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "ink", agent: "agent" },
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

The plugin auto-detects the **executor** (`human`, `agent`, or `ci`) using
[std-env](https://github.com/nicolo-ribaudo/std-env), then resolves a single
console mode from the per-executor matrix at `AgentPlugin({ console: { … } })`.
Per-slot defaults:

| Executor | Detection | Default `console` slot | Behavior |
| --- | --- | --- | --- |
| `agent` | `std-env` agent detection (Claude Code, Cursor, Gemini CLI, Codex, etc.) | `"agent"` | Markdown-flavored final-frame string, data persisted to SQLite |
| `ci` | `GITHUB_ACTIONS`, `CI=true` | `"passthrough"` | Keeps Vitest's existing reporters; opt in to `"ci-annotations"` for GHA |
| `human` | No agent/CI detected | `"passthrough"` | Keeps Vitest's existing reporters; set to `"ink"` for the live React Ink view |

Set `console.human: "ink"` to get the live React Ink view on a human run. The plugin owns the live-mount lifecycle internally — there is no `createLiveInk` import to wire and no `onRunEvent` callback to forward. Test data is always persisted to the SQLite database regardless of console mode.

Set `console.agent: "agent"` to get the markdown-flavored end-of-run frame on agent runs. The frame carries a footer line pointing at the right MCP tool for the dominant outcome — e.g. ``Use `test_errors` for failure detail; `failure_signature_get` to check known patterns.``

## Guides

| Guide | Description |
| --- | --- |
| [Configuration](configuration.md) | Plugin and reporter options, thresholds, targets, trends, cache resolution, environment detection |
| [Direct Reporter Usage](reporter.md) | Using `AgentReporter` without the plugin, lifecycle hooks, advanced configuration |
| [vitest-agent-ui](../packages/ui/README.md) | Shared event-sourced renderer: the shape-tailored dispatcher matrix, the preassembled default reporter, the live React Ink mount |
| [Schemas](schemas.md) | Effect Schema definitions, programmatic database access, type inference |
| [CLI Commands](cli.md) | Status, overview, coverage, history, trends, cache, doctor, and the live `show` renderer |
| [MCP Server](mcp.md) | MCP server reference: tools, resources, prompts and notes system |
| [Failure History](history.md) | Test classification and failure tracking across runs |
| [Claude Code Plugin](../plugin/README.md) | Plugin installation, hooks, skills, and commands |
| [Dogfooding](dogfooding.md) | Contributor guide to testing the vitest-agent system on its own playground |
