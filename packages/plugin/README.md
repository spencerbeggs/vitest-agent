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
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        coverageThresholds: "standard",
        coverageTargets: "strict",
      }),
    ],
    test: { projects, tags, pool: "forks" },
  });
};
```

## AgentPlugin.discover()

`AgentPlugin.discover(options?)` scans workspace packages for test files
and returns `{ projects, tags }`. Pass `projects` to Vitest's
`test.projects` and `tags` to `test.tags` so Vitest's `--tags-filter`
flag can resolve every tag the plugin's transform injects. The scanner
emits **one project per workspace package** — there are no `:unit`,
`:int`, or `:e2e` project-name suffixes; test-kind classification is
handled by the active `TagStrategy` and surfaces as Vitest tags
instead.

The optional `options` argument accepts either a `({ projects }) =>
void | Promise<void>` callback that mutates the discovered project
list in place, or an object `{ callback?, tagStrategy? }` where
`tagStrategy` is a `TagStrategy` instance or `false` to omit tag
definitions from the returned `tags` array. `discover()` only
controls the returned configuration. The Vite transform that injects
tags at parse time is configured separately via the
`AgentPlugin({ tagStrategy })` constructor option — pass `false` to
both to fully opt out of tagging.

```typescript
import { AgentPlugin, TagStrategy } from "vitest-agent-plugin";

// Custom tag strategy with a 30s timeout for contract tests
const strategy = TagStrategy.default.extend({
  classify: ({ module, inherited }) => {
    if (module.filename.endsWith(".contract.test.ts")) return ["contract"];
    return inherited;
  },
});

const { projects, tags } = await AgentPlugin.discover({
  tagStrategy: strategy,
  callback: ({ projects }) => {
    for (const p of projects) p.override({ test: { retry: 1 } });
  },
});
```

Discovery results are cached per workspace root within the process when
called with no options. Passing a `tagStrategy` or callback skips the
cache so per-config customization always re-runs.

The pre-2.0 per-kind override form (`{ unit?, int?, e2e? }` keyed by
test kind) was removed when discovery consolidated to one project per
package; per-kind shaping now happens through `TagStrategy.classify()`
rather than through projects.

## Tag and TagStrategy

`Tag` and `TagStrategy` are exported alongside `AgentPlugin`. A
strategy declares the available tags (with timeouts, retries) and a
`classify({ module })` function that returns one or more tag names per
test module. The plugin's Vite transform reads the result and injects
the tags into every `test()` and `it()` call. `TagStrategy.default`
ships `unit`, `int` (60s timeout), and `e2e` (120s timeout, retry 2
under CI), keyed off the filename suffix.

```typescript
import { Tag, TagStrategy } from "vitest-agent-plugin";

const strategy = TagStrategy.create({
  tags: [
    Tag.make("unit"),
    Tag.make("smoke", { timeout: 5_000 }),
  ],
  classify: ({ module }) => {
    if (module.filename.endsWith(".smoke.test.ts")) return ["smoke"];
    return ["unit"];
  },
});
```

The plugin also accepts `tagStrategy` directly so the transform and the
discovery surface stay in sync:

```typescript
AgentPlugin({ tagStrategy: strategy });
```

Pass `tagStrategy: false` to disable the Vite transform so no tags
are injected at parse time. The companion `AgentPlugin.discover()`
also accepts `tagStrategy: false` to omit tag definitions from its
returned `tags` array — pass `false` to both calls to fully opt out
of tagging.

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
