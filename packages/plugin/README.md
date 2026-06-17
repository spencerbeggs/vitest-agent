# @vitest-agent/plugin

[![npm](https://img.shields.io/npm/v/@vitest-agent/plugin?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Vitest plugin that turns your test suite into a live data source for LLM coding agents. Handles persistence, failure classification, coverage policy enforcement, project discovery and a configurable reporter chain — the CLI and MCP server arrive as required peers and are wired automatically.

## Features

- **`AgentPlugin`** — drop into `vitest.config.ts`; auto-detects human, agent and CI executors and adapts console output accordingly
- **Project discovery** — `AgentPlugin.discover()` scans workspace packages, returns `{ projects, tags }` ready for `test.projects` and `test.tags`
- **Coverage presets** — `COVERAGE_LEVELS` and `COVERAGE_LEVELS_PER_FILE` return dual-output `{ thresholds, coverageTargets }` objects; `COVERAGE_AUTOUPDATE` tolerance functions plug into Vitest's native `autoUpdate`
- **Failure classification** — persists per-test errors, computes failure signatures, classifies tests as stable, new-failure, persistent, flaky or recovered across runs
- **Custom reporters** — pass any `VitestAgentReporterFactory` as the `reporter` option; the default wires `DefaultVitestAgentReporter` from `@vitest-agent/reporter`
- **`onRunEvent` tap** — optional read-only callback receiving every `RunEvent` in parallel with the renderer, safe to throw from

## Install

```bash
npm install --save-dev @vitest-agent/plugin
# or
pnpm add -D @vitest-agent/plugin
```

The required peers `@vitest-agent/cli` and `@vitest-agent/mcp` install automatically with npm 7+ and pnpm (`autoInstallPeers: true`).

## Quick start

```ts
import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.standard;
  return defineConfig({
    plugins: [AgentPlugin({ console: { human: "stream", agent: "agent" }, coverageTargets: coverage.coverageTargets })],
    test: { ...(projects ? { projects } : {}), tags, coverage: { enabled: true, provider: "v8", thresholds: coverage.thresholds } },
  });
};
```

## Documentation

Full guide, configuration reference and the Claude Code plugin docs live at [vitest-agent.dev/guide](https://vitest-agent.dev/guide).

## License

[MIT](LICENSE)
