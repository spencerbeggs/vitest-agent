---
name: configuration
description: Guide @vitest-agent/plugin configuration including thresholds, targets, output format, and plugin options. Use when setting up or modifying the plugin configuration.
disable-model-invocation: true
---

# Vitest Agent Plugin Configuration

## Plugin Options (vitest.config.ts)

The plugin is configured via `AgentPlugin` in your Vitest config:

```typescript
import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    AgentPlugin({
      // Output format: "markdown" | "json" | "vitest-bypass" | "silent"
      format: "markdown",

      // Per-executor console matrix. The plugin auto-detects the
      // executor (human, agent, ci) and picks the matching slot.
      console: {
        human: "passthrough",   // Vitest's reporters render
        agent: "agent",         // markdown final-frame string
        ci: "passthrough",      // Vitest's reporters render
      },

      reporterOptions: {
        // Coverage thresholds (Vitest-native format)
        coverageThresholds: {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },

        // Aspirational goals (informational, not enforced)
        coverageTargets: {
          lines: 95,
          branches: 90,
        },

        // Auto-ratchet baselines toward targets
        autoUpdate: true,

        // Max low-coverage files shown in console
        coverageConsoleLimit: 10,
      },
    }),
  ],
});
```

## Key Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `format` | `"markdown"` | Output format for console |
| `console` | `{}` | Per-executor matrix (`human`/`agent`/`ci`) controlling visible output |
| `onRunEvent` | none | Live `RunEvent` tap, fired in every mode; the `stream` live view does not need it |
| `coverageThresholds` | `{}` | Enforced minimums (fail build) |
| `coverageTargets` | none | Aspirational goals (informational) |
| `autoUpdate` | `true` | Auto-ratchet baselines |

## Checking Current Configuration

Use the `configure` MCP tool to view current settings from the
database. Settings are captured on each test run.

## Common Configurations

### Strict CI mode

```typescript
AgentPlugin({
  format: "markdown",
  console: { agent: "agent" },
  reporterOptions: {
    coverageThresholds: { lines: 90, branches: 85 },
  },
})
```

### Development mode (quiet)

```typescript
AgentPlugin({
  format: "vitest-bypass",
  console: { human: "passthrough" },
})
```

### Live view for humans

`console.human: "stream"` turns on the default reporter's live view. It
is owned by `DefaultVitestAgentReporter` in `@vitest-agent/reporter`
(the kit's `CliUi.live`, started once per run, closed at Vitest's
close); nothing needs importing, and `@vitest-agent/ui` has no live
mount of its own. Every Ink export lives under `@vitest-agent/ui/ink`
and is loaded lazily by the reporter, never by user config.

```typescript
AgentPlugin({
  console: { human: "stream", agent: "agent" },
})
```

### Custom reporter

A custom reporter is a `VitestAgentReporterFactory`: the plugin calls it
once per run with a resolved `ReporterKit` and routes every
`RenderedOutput` it returns by `target`. `@vitest-agent/reporter` ships
the contract types, the dispatch helpers (`buildDispatchInputs`,
`renderAgentStringForReport`, `renderHumanStringForReport`) and `DefaultVitestAgentReporter` as the
worked reference, so one import covers it:

```typescript
import { AgentPlugin } from "@vitest-agent/plugin";
import {
  DefaultVitestAgentReporter,
  renderAgentStringForReport,
  type ReporterKit,
  type VitestAgentReporterFactory,
} from "@vitest-agent/reporter";

// One dispatched block per project, on stdout, only in "agent" mode.
// `render` receives the run-end kit; the factory's kit is resolved at
// run start, before failures are known.
const perProject: VitestAgentReporterFactory = (_kit: ReporterKit) => ({
  render: (input, renderKit) =>
    renderKit.config.consoleMode === "agent"
      ? input.reports.map((report) => ({
          target: "stdout" as const,
          contentType: "text/plain",
          content: renderAgentStringForReport(report),
        }))
      : [],
});

AgentPlugin({
  console: { human: "stream", agent: "agent" },
  // Keep the default output and add the custom one: a factory may return
  // several reporters; the plugin concatenates their outputs.
  reporter: (kit) => [DefaultVitestAgentReporter(kit), perProject(kit)].flat(),
})
```

A no-op reporter (persistence only, no console output) is
`reporter: () => ({ render: () => [] })`.

## Inline projects (monorepo configs)

Under Vitest 5, an inline project object in `test.projects` inherits the
root config — including its `plugins` array — by default. `AgentPlugin`
therefore reaches an inline project automatically; set `extends: false`
on a project to opt it out, which also drops `AgentPlugin` from that
project since inheritance is how the plugin gets there.
