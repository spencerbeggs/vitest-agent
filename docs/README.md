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
  const projects = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { projects, pool: "forks" },
  });
};
```

The plugin auto-detects the environment using
[std-env](https://github.com/nicolo-ribaudo/std-env):

| Environment | Detection | Behavior |
| --- | --- | --- |
| Agent | `std-env` agent detection (Claude Code, Cursor, Gemini CLI, Codex, etc.) | Structured markdown output, data persisted to SQLite |
| CI | `GITHUB_ACTIONS`, `CI=true` | Keeps existing reporters, adds GFM to `GITHUB_STEP_SUMMARY` |
| Human | No agent/CI detected | Keeps existing reporters, runs silently |

Test data is always persisted to the SQLite database regardless of
environment.

## Guides

| Guide | Description |
| --- | --- |
| [Configuration](configuration.md) | Plugin and reporter options, thresholds, targets, trends, cache resolution, environment detection |
| [Direct Reporter Usage](reporter.md) | Using `AgentReporter` without the plugin, lifecycle hooks, advanced configuration |
| [Schemas](schemas.md) | Effect Schema definitions, programmatic database access, type inference |
| [CLI Commands](cli.md) | Status, overview, coverage, history, trends, cache, and doctor commands |
| [MCP Server](mcp.md) | MCP server reference: tools, resources, prompts and notes system |
| [Failure History](history.md) | Test classification and failure tracking across runs |
| [Claude Code Plugin](../plugin/README.md) | Plugin installation, hooks, skills, and commands |
| [Dogfooding](dogfooding.md) | Contributor guide to testing the vitest-agent system on its own playground |
