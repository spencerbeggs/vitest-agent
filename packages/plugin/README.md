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
(`vitest-agent-reporter`, `vitest-agent-ui`, `vitest-agent-cli`,
`vitest-agent-mcp`). If your package manager skips peers, install them
explicitly:

```bash
pnpm add -D vitest-agent-plugin vitest-agent-reporter vitest-agent-ui vitest-agent-cli vitest-agent-mcp
```

If a partial upgrade leaves the `vitest-agent-*` packages at different
versions, the plugin writes a single stderr line at startup
(`[vitest-agent-plugin] version drift: …`) and continues. Reinstall
the packages so they match. See
[Configuration > Cross-package Version Drift](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md#cross-package-version-drift)
for the full check.

## Setup

Add `AgentPlugin` to your Vitest config. Use an async export so
`AgentPlugin.discover()` resolves workspace projects before Vitest reads the
config:

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
      pool: "forks",
      coverage: {
        enabled: true,
        provider: "v8",
        thresholds: coverage.thresholds,
      },
    },
  });
};
```

Most users do not pass `reporter` or `onRunEvent` explicitly — the plugin ships a preassembled default reporter and owns the live-Ink mount when `console.human === "ink"`. In 2.0 the plugin reads coverage thresholds from Vitest's native `test.coverage.thresholds`. See [Coverage Level Presets](#coverage-level-presets) below for the dual-output wiring pattern.

## Console matrix and options

`AgentPlugin` 2.0 controls console output through a per-executor matrix. The plugin auto-detects the executor (`human` / `agent` / `ci`) and resolves a single `ConsoleMode` value:

```typescript
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "ink" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
  coverageTargets?: CoverageTargets,
  transport?: Transport,                  // forward-declared; single-member union today
  reporter?: VitestAgentReporterFactory,  // override the built-in default reporter
  onRunEvent?: (event: RunEvent) => void, // optional stream-tee callback
});
```

Per-slot defaults: `human` → `"passthrough"`, `agent` → `"agent"`, `ci` → `"passthrough"`. Any non-`"passthrough"` value strips Vitest's built-in console reporters and the native coverage text reporter — the plugin owns stdout for the run.

When `console.human` resolves to `"ink"`, the plugin mounts the live React Ink view itself. There is no `createLiveInk` import to wire and no live-event callback to forward — the lifecycle is fully internal.

`onRunEvent` is an optional read-only tee. The plugin forwards every per-test and per-module `RunEvent` to your callback alongside the built-in renderer; it runs in parallel, not in place of the default. Throwing taps are caught and logged to stderr so persistence never breaks because a callback has a bug.

The `reporter` option overrides the plugin's built-in default. When unset, the plugin wires the preassembled default reporter from `vitest-agent-ui`, which classifies the run into one of four shapes (single-test, single-file, single-project, workspace) and three outcomes (all-pass, some-fail, threshold-violation) and dispatches to the matching cell. Each render carries a footer line pointing at the right MCP tool for the dominant outcome (e.g. ``Use `test_errors` for failure detail; `failure_signature_get` to check known patterns.``). Custom reporters depend on `vitest-agent-reporter` to pull the contract types and dispatch helpers from a single import — see that package's README for the escape-hatch SDK surface.

## AgentPlugin.discover()

`AgentPlugin.discover(strategy?)` scans workspace packages for test
files and returns a thenable `DiscoverBuilder` that resolves to
`{ projects, tags }`. `projects` is
`TestProjectInlineConfiguration[] | undefined` — Vitest's native
inline-project shape, suitable to pass directly to `test.projects`.
The scanner emits **one project per workspace package** — there are
no `:unit`, `:int`, or `:e2e` project-name suffixes; test-kind
classification is handled by the active `DiscoverStrategy` and
surfaces as Vitest tags instead.

The argument is overloaded: no argument uses the default strategy at
the current working directory; pass a `DiscoverStrategy` instance to
override the defaults; pass `{ strategy?, cwd? }` to also override the
workspace root.

The builder is a thenable, not a Promise — chain `.addProject({ name,
path })` to register folders that hold tests but are not pnpm
workspace packages, then `await` (or `.then`) to materialize. The
builder is **immutable**: every `.addProject()` call returns a fresh
builder.

```typescript
import {
  AgentPlugin,
  DefaultDiscoverStrategy,
  Tag,
} from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

// Custom strategy: extend the default with a 30s contract-test tag.
const strategy = new DefaultDiscoverStrategy().extend({
  additionalTags: [Tag.make("contract", { timeout: 30_000 })],
  classify: ({ module, inherited }) => {
    if (module.filename.endsWith(".contract.test.ts")) return ["contract"];
    return inherited;
  },
});

export default async () => {
  const { projects, tags } = await AgentPlugin.discover(strategy)
    .addProject({ name: "integration", path: "./test-only" });
  return defineConfig({
    plugins: [AgentPlugin({ discoverStrategy: strategy })],
    test: { ...(projects ? { projects } : {}), tags, pool: "forks" },
  });
};
```

The same `strategy` is passed to both `discover()` and the plugin's
`discoverStrategy` option so the returned configuration and the
parse-time Vite transform stay in sync. On resolution, the scanner
runs `strategy.buildProject` over both workspace packages and
`.addProject` entries with name and normalized-path conflict
detection — a clash between an added entry and a workspace package
throws, and a null `buildProject` return for an added entry throws
(returning null for a workspace package is a silent skip).

Discovery results are cached per workspace root within the process
only when called with no argument and no `.addProject()` chain. Any
explicit strategy, custom `cwd`, or `.addProject()` call bypasses the
cache so per-config customization always re-runs.

The pre-2.0 `({ projects }) => void | Promise<void>` callback form
and the legacy per-kind override form (`{ unit?, int?, e2e? }` keyed
by test kind) were removed when discovery consolidated to a single
`DiscoverStrategy` contract. Callers that need to mutate projects
post-discovery either extend the strategy or destructure the result
and mutate the array before spreading.

## DiscoverStrategy

`DiscoverStrategy` (abstract class), `DefaultDiscoverStrategy`
(concrete default), and `Tag` are exported alongside `AgentPlugin`.
A strategy declares the available tags (with timeouts, retries), a
`classify({ module })` function that returns one or more tag names
per test module, and a `buildProject(input)` function that returns
a `TestProjectInlineConfiguration` for the package (or `null` to
skip). The plugin's Vite transform reads the `classify` result and
injects the tags into every `test()` and `it()` call.
`DefaultDiscoverStrategy` ships `unit`, `int` (60s timeout), and
`e2e` (120s timeout, retry 2 under CI), classifies by filename
suffix, and skips packages that have no `src/` or `__test__/` test
files.

Compose with `.extend({ additionalTags?, classify?, buildProject? })`
to chain layers on top of an existing strategy without rewriting it,
or use `DiscoverStrategy.create({ tags, classify, buildProject })`
for a strategy authored from scratch:

```typescript
import { DiscoverStrategy, Tag } from "vitest-agent-plugin";

const strategy = DiscoverStrategy.create({
  tags: [Tag.make("unit"), Tag.make("smoke", { timeout: 5_000 })],
  classify: ({ module }) => {
    if (module.filename.endsWith(".smoke.test.ts")) return ["smoke"];
    return ["unit"];
  },
  buildProject: async (input) => ({
    extends: true,
    test: {
      name: input.name,
      environment: "node",
      include: [`${input.path}/src/**/*.{test,spec}.{ts,tsx,js,jsx}`],
    },
  }),
});
```

The plugin also accepts `discoverStrategy` directly so the transform
and the discovery surface stay in sync:

```typescript
AgentPlugin({ discoverStrategy: strategy });
```

Pass `discoverStrategy: false` to disable the Vite transform so no
tags are injected at parse time. For pure tag-classification logic
(no `buildProject` changes) the plugin also exports
`classifyByFilename`, `classifyByDirectory`, and
`combineClassifiers` — composable `ClassifyFn` builders that plug
into `DiscoverStrategy.create({ classify })` or
`.extend({ classify })`.

## Coverage Level Presets

`AgentPlugin.COVERAGE_LEVELS` and `AgentPlugin.COVERAGE_LEVELS_PER_FILE` are
namespace constants. Each named preset returns a dual-output object with a
`thresholds` half (passed to Vitest's native `coverage.thresholds`) and a
`coverageTargets` half (passed to `AgentPlugin({ coverageTargets })`):

| Level | thresholds | coverageTargets |
| --- | --- | --- |
| `none` | lines/functions/branches/statements 0 | next-level-up: `basic` |
| `basic` | 50 / 50 / 50 / 50 | next-level-up: `standard` |
| `standard` | 70 / 70 / 65 / 70 | next-level-up: `strict` |
| `strict` | 80 / 80 / 75 / 80 | next-level-up: `full` |
| `full` | 90 / 90 / 85 / 90 | capped at `full` |

Canonical 2.0 wiring — destructure a preset once, then pass each half to
its rightful owner (Vitest for thresholds; the plugin for targets):

```typescript
const preset = AgentPlugin.COVERAGE_LEVELS.standard;

export default defineConfig({
  plugins: [AgentPlugin({ coverageTargets: preset.coverageTargets })],
  test: {
    coverage: {
      thresholds: preset.thresholds,
    },
  },
});
```

`COVERAGE_LEVELS_PER_FILE` is the same table with `perFile: true` applied
to the `thresholds` half only — `coverageTargets` inherits `perFile` from
`coverage.thresholds.perFile`, so duplicating it on the targets half would
just risk drift.

`AgentPlugin.COVERAGE_AUTOUPDATE` exposes three tolerance functions for
Vitest's `coverage.thresholds.autoUpdate` field
(`(newThreshold: number) => number`):

| Function | Behavior |
| --- | --- |
| `standard` | Floors the new threshold. |
| `strict` | Ceils the new threshold. |
| `lenient` | Floors the new threshold and subtracts 2 (clamped to 0). |

```typescript
defineConfig({
  test: {
    coverage: {
      thresholds: {
        autoUpdate: AgentPlugin.COVERAGE_AUTOUPDATE.standard,
        lines: 80,
      },
    },
  },
});
```

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
