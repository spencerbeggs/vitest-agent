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
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { projects, tags, pool: "forks" },
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
| `human` | No agent/CI detected | `"passthrough"` | Keeps Vitest's existing reporters; opt in to `"ink"` for the live React Ink view |

To run the live React Ink view in interactive terminals, opt in per slot and
wire the `onRunEvent` tap to `createLiveInk` from `vitest-agent-ui`:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { createLiveInk } from "vitest-agent-ui";
import { defineConfig } from "vitest/config";

const live = createLiveInk();

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "ink" },
        onRunEvent: live.event,
      }),
    ],
    test: { projects, tags, pool: "forks" },
  });
};
```

Test data is always persisted to the SQLite database regardless of
console mode. The plugin only forwards `onRunEvent` to the live renderer
when the resolved mode is `"ink"` — other modes suppress the tap so an Ink
mount cannot leak into `"silent"`, `"passthrough"`, `"agent"`, or
`"ci-annotations"`.

## Guides

| Guide | Description |
| --- | --- |
| [Configuration](configuration.md) | Plugin and reporter options, thresholds, targets, trends, cache resolution, environment detection |
| [Direct Reporter Usage](reporter.md) | Using `AgentReporter` without the plugin, lifecycle hooks, advanced configuration |
| [vitest-agent-ui](../packages/ui/README.md) | Shared event-sourced renderer: `renderRun`, `createLiveInk`, `eventSourcedReporter`, the live React Ink view |
| [Schemas](schemas.md) | Effect Schema definitions, programmatic database access, type inference |
| [CLI Commands](cli.md) | Status, overview, coverage, history, trends, cache, doctor, and the live `show` renderer |
| [MCP Server](mcp.md) | MCP server reference: tools, resources, prompts and notes system |
| [Failure History](history.md) | Test classification and failure tracking across runs |
| [Claude Code Plugin](../plugin/README.md) | Plugin installation, hooks, skills, and commands |
| [Dogfooding](dogfooding.md) | Contributor guide to testing the vitest-agent system on its own playground |
