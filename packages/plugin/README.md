# vitest-agent-plugin

Vitest plugin for the `vitest-agent` ecosystem. Owns persistence, history
classification, baselines, trend tracking, failure-signature computation,
and Vitest reporter-chain wiring. Dispatches the rendering stage to a
configurable reporter.

## Install

```bash
npm install vitest-agent-plugin
```

Modern pnpm and npm auto-install the required peer dependencies
(`vitest-agent-reporter`, `vitest-agent-cli`, `vitest-agent-mcp`). If your
package manager skips peers, install them explicitly:

```bash
pnpm add -D vitest-agent-plugin vitest-agent-reporter vitest-agent-cli vitest-agent-mcp
```

## Setup

Add `AgentPlugin` to your Vitest config. Use an async export so
`AgentPlugin.discover()` resolves workspace projects before Vitest reads the
config:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const projects = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        coverageThresholds: "standard",
        coverageTargets: "strict",
      }),
    ],
    test: { projects, pool: "forks" },
  });
};
```

## AgentPlugin.discover()

`AgentPlugin.discover(options?)` scans workspace packages for test files and
returns a `TestProjectInlineConfiguration[]` for `test.projects`. Files are
classified by name suffix: `.e2e.test.ts` for e2e, `.int.test.ts` for
integration, everything else for unit.

The optional `options` argument accepts either a callback to mutate the full
list in-place, or a per-kind override object:

```typescript
// Per-kind config overrides
const projects = await AgentPlugin.discover({
  unit: { testTimeout: 5_000 },
  e2e: { testTimeout: 120_000 },
});

// Callback for full control
const projects = await AgentPlugin.discover(({ projects }) => {
  for (const p of projects) {
    if (p.kind === "int") p.override({ test: { retry: 2 } });
  }
});
```

Discovery results are cached per workspace root within the process.

## Coverage Level Presets

`AgentPlugin.COVERAGE_LEVELS` and `AgentPlugin.COVERAGE_LEVELS_PER_FILE` are
namespace constants with preset threshold objects:

| Level | lines | functions | branches | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 40 | 50 |
| `standard` | 75 | 75 | 65 | 75 |
| `strict` | 90 | 90 | 85 | 90 |
| `full` | 100 | 100 | 100 | 100 |

Pass a level name directly or use the constant to extend a preset:

```typescript
import { CoverageLevel } from "vitest-agent-sdk";

AgentPlugin({
  coverageThresholds: "standard",
  coverageTargets: AgentPlugin.COVERAGE_LEVELS.strict.extend({ lines: 95 }),
});
```

`COVERAGE_LEVELS_PER_FILE` is the same table with `perFile: true` applied to
each level.

## AgentPlugin.runScript()

`AgentPlugin.runScript(command)` runs a shell command, suppressing all output
unless the command fails. Useful in Vitest `globalSetup` files to build
packages before tests without polluting agent stdout:

```typescript
// vitest.setup.ts
import { AgentPlugin } from "vitest-agent-plugin";

export function setup() {
  AgentPlugin.runScript("pnpm exec turbo run build:dev --output-logs=errors-only");
}
```

On failure the captured stderr and stdout are replayed to their respective
streams before rethrowing.

## Documentation

See the
[main README](https://github.com/spencerbeggs/vitest-agent#readme)
and the
[configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md).

## License

MIT
