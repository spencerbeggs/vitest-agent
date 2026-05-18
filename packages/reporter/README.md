# vitest-agent-reporter

[![npm](https://img.shields.io/npm/v/vitest-agent-reporter?label=npm&color=cb3837)](https://www.npmjs.com/package/vitest-agent-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)

The default reporter package and the reference package for custom-reporter authors. Ships `DefaultVitestAgentReporter` — the production default `VitestAgentReporterFactory` that `vitest-agent-plugin` wires when no custom `reporter` option is set — and owns the live React Ink mount lifecycle end to end. Also gives custom-reporter authors a single import for the reporter contract types and the dispatch helpers. If you only want the default behavior, you do not need to install this package directly — it is a regular dependency of `vitest-agent-plugin` and is pulled in automatically.

## Why this package exists

`DefaultVitestAgentReporter` is the production default: it branches on every `consoleMode`, dispatches through the 12-cell shape × outcome matrix, owns the live React Ink mount lifecycle (mount / rerender / unmount), and emits a footer pointing at the right MCP tool for the dominant outcome. GitHub Actions gets a GFM Step Summary payload alongside. Most users never need to think about reporter wiring.

If the default does not produce the output you want, write a `VitestAgentReporterFactory` and pass it as the plugin's `reporter` option. Read `DefaultVitestAgentReporter`'s source in this package as a worked example. This package also gives your factory everything it needs in one import:

```typescript
import type {
  ReporterKit,
  ReporterRenderInput,
  RenderedOutput,
  ResolvedReporterConfig,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "vitest-agent-reporter";
import {
  buildDispatchInputs,
  resolveCellOptions,
} from "vitest-agent-reporter";
```

## Install

```bash
npm install --save-dev vitest-agent-reporter
# or
pnpm add -D vitest-agent-reporter
```

`vitest-agent-reporter` is a regular dependency of `vitest-agent-plugin`, so a plugin install pulls it in automatically. Install it explicitly only when authoring a custom reporter or when your package manager does not hoist transitive dependencies.

## Building a custom reporter

A reporter factory is invoked once at run start with the resolved `ReporterKit`; the returned object's `render(input, kit)` is called once at run end with the per-project reports and a second health-aware kit. Both kits carry the same `runEvents` channel but the render-time kit has a post-run `detail` level:

```typescript
import type {
  ReporterKit,
  ReporterRenderInput,
  RenderedOutput,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "vitest-agent-reporter";

const myReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => {
  // Construction-time work: subscribe to kit.runEvents for live rendering,
  // open file handles, capture kit.config — use the factory-time kit here.
  return {
    render(input: ReporterRenderInput, renderKit: ReporterKit): ReadonlyArray<RenderedOutput> {
      // Rendering work: use the health-aware render-time kit for config,
      // and input.reports / input.classifications for run results.
      const projectCount = input.reports.length;
      const passed = input.reports.reduce((n, r) => n + r.summary.passed, 0);
      return [{
        target: "stdout",
        content: `${passed} passed across ${projectCount} project(s)\n`,
      }];
    },
  };
};
```

Pass the factory to the plugin:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";

AgentPlugin({
  console: { agent: "agent" },
  reporter: myReporter,
});
```

## What the helpers do

`buildDispatchInputs` and `resolveCellOptions` live in this package (they moved from `vitest-agent-ui` in 2.0):

| Helper | Description |
| --- | --- |
| `buildDispatchInputs(state, input, overrides?)` | Assembles a fully-populated `DispatchInputs` from the reduced `RenderState` and `ReporterRenderInput`. Pre-computes shape, outcome, project aggregates, trend direction, and below-target listings |
| `resolveCellOptions(kit)` | Resolves the per-cell option object from the kit: `noColor` flag and the pre-bound OSC-8 hyperlink helper |
| `renderAgentStringForReport(report)` | One-shot helper: synthesizes events from a stored `AgentReport`, reduces state, and returns the dispatched agent string |
| `renderHumanStringForReport(report, opts?)` | Same as above but renders the Ink half to a string via `ink`'s `renderToString` |

The contract types come from `vitest-agent-sdk` and are re-exported here:

| Type | Description |
| --- | --- |
| `ResolvedReporterConfig` | The resolved facts the plugin computes per run: `consoleMode`, `coverageMode`, `format`, `detail`, environment, executor |
| `ReporterKit` | The bundle handed to a factory at run start and to `render` at run end: `config`, `stdEnv`, `stdOsc8`, and optional `runEvents` channel |
| `ReporterRenderInput` | The input to `render(input, kit)`: per-project `reports`, `classifications`, optional `trendSummary` |
| `RenderedOutput` | One emit target: `{ target: "stdout" \| "github-summary" \| "file", content, contentType }` |
| `VitestAgentReporter` | The object returned by a factory; has one method `render(input, kit)` |
| `VitestAgentReporterFactory` | `(kit: ReporterKit) => VitestAgentReporter \| ReadonlyArray<VitestAgentReporter>` |

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme) and the [configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md) for plugin wiring. The `DefaultVitestAgentReporter` source in this package is the canonical worked example for the `VitestAgentReporterFactory` contract.

## License

[MIT](./LICENSE)
