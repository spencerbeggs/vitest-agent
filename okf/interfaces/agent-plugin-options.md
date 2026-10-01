---
type: Interface
title: "AgentPluginOptions"
description: "The AgentPlugin({ ... }) options shape: exactly six fields, the coverage-level presets, and the executor→console-mode matrix."
kind: api
resource: ../../packages/sdk/src/schemas/Options.ts
status: stable
tags:
  - dx
  - compat
  - testing
generated:
  by: okfit/claude-code
  at: 2026-10-01T02:30:42Z
  body_sha256: bba1375ad6ac5f5795b9c61b359c4a61eb09e1c8735d97ef02e99df01471bcea
---

# AgentPluginOptions

## What stays stable

`AgentPlugin(options?)` from [`@vitest-agent/plugin`](../modules/plugin.md)
accepts exactly six fields, no more. Four are Effect Schema-decodable and
live in `AgentPluginOptions` itself (`packages/sdk/src/schemas/Options.ts`);
two are function-typed and live on the plugin's
`AgentPluginConstructorOptions` companion interface
(`packages/plugin/src/plugin.ts:69`) because Effect Schema cannot encode
functions cleanly. A major version may add a field to either shape; it may
not silently repurpose an existing field's meaning, and any field this
document does not list is either resolved internally (never user-facing)
or lives on Vitest's own native config.

| Field | Shape | Where it lives | Default when omitted |
| ----- | ----- | --------------- | --------------------- |
| `console` | `{ human?, agent?, ci? }` (`ConsoleOutputs`) | `AgentPluginOptions` | per-slot: `human → passthrough`, `agent → agent`, `ci → passthrough` |
| `coverageTargets` | `CoverageTargets` record | `AgentPluginOptions` | unset — no aspirational targets tracked |
| `transport` | `Transport` (single-member union today) | `AgentPluginOptions` | `{ kind: "local" }` |
| `report` | `false \| { scope? }` (`ReportOption`) | `AgentPluginOptions` | on for `agent`/`ci` executors, off for `human`; scope `vitest-agent` |
| `reporter` | `VitestAgentReporterFactory` | `AgentPluginConstructorOptions` | `DefaultVitestAgentReporter` from `@vitest-agent/reporter` |
| `onRunEvent` | `(event: RunEvent) => void` | `AgentPluginConstructorOptions` | no-op — the internal channel still runs |

A seventh field, `discoverStrategy?: DiscoverStrategy | false`, lives on
`AgentPluginConstructorOptions` alongside `reporter` and `onRunEvent` but
governs [project discovery](./discover-api.md) rather than run-time
plugin behavior, and is documented there rather than here.

## `console` — the per-executor matrix

```ts
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "stream" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
});
```

The three slots accept three different literal unions —
`HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode` — because a value
legal for one executor is genuinely invalid for another (`stream` only
makes sense for a human at a terminal; `ci-annotations` only for CI). The
plugin auto-detects the executor and resolves a single `ConsoleMode` from
the matching slot. Any non-`passthrough` resolved mode means the plugin
owns stdout for the run: Vitest's built-in console reporters are stripped
and `coverage.reporter` is zeroed. `VITEST_AGENT_CONSOLE` overrides the
configured slot at runtime, but only with a value legal for the *detected*
executor, matched case-insensitively; an illegal value is ignored with one
stderr line per run, `[vitest-agent:plugin] ignoring
VITEST_AGENT_CONSOLE=<value>: not accepted for the <executor> audience
(accepts <a>|<b>|…)`.
The wording is diagnostic, not a contract to pattern-match.

## `coverageTargets` — aspirational goals, not enforcement

`CoverageTargets` (`packages/sdk/src/schemas/CoverageTargets.ts`) is a
`Schema.Record` whose keys are either a top-level metric name (`lines`,
`functions`, `branches`, `statements`) or a glob pattern for per-file
scoping (`src/**.ts`), and whose values are a strictly-positive number, the
literal `true` (valid only at the reserved key `"100"`, meaning "100%
across all metrics"), or a nested `{ lines?, functions?, branches?,
statements?, 100?: true, perFile? }` object for a glob entry. Negatives and
zeros are rejected at decode time; `perFile` at the top level is rejected
(set it on Vitest's own `coverage.thresholds.perFile`, or on the matching
glob entry, since Vitest 5 glob-pattern thresholds do not inherit the
top-level setting). This is one of three distinct coverage facets: Vitest's
native `coverage.thresholds` enforces a build failure, `coverageTargets`
tracks an aspirational goal, and `coverage_baselines` auto-ratchets a
high-water mark — a project can carry "must not regress" and "still
climbing" simultaneously.
[`ConfigValidation`](../modules/plugin.md) is the service that compares
`coverageTargets` against Vitest's native thresholds and flags a mismatch.

## `transport` — a forward-declared union, not a live choice

`Transport` (`packages/sdk/src/schemas/Transport.ts`) is
`Schema.Union([Schema.Struct({ kind: Schema.Literal("local") })])` — a
single-member discriminated union from day one, closed with `.annotate()`
so a later cloud-backend swap (a Turso-backed transport, for example)
lands as a pure addition of a new union member rather than a schema-shape
change. Every 2.x consumer that sets `transport` sets `{ kind: "local" }`;
the field exists now so the eventual addition is not a breaking change to
the option's *type*. The plugin threads the resolved value onto
`ResolvedReporterConfig.transport` so a custom reporter can branch on
backend kind without a rewrite when a second member ships.

## `report` — report-file control

`false` disables `.vitest/<scope>/` writes entirely; `{ scope }` renames
the directory (default scope is `vitest-agent`, so the default path is
`.vitest/vitest-agent/`). `scope` rejects `/`, `\`, `.`, and `..` at decode
time — it names a single directory resolved directly under `.vitest/` and
cannot nest or escape. Default resolution is on for the `agent` and `ci`
executors and off for `human`. See
[Report Files](./report-files.md) for the file contract this option
gates.

## `reporter` and `onRunEvent` — the function-typed pair

`reporter?: VitestAgentReporterFactory` swaps the entire rendering
pipeline; there is no composition slot; a user-supplied factory replaces
`DefaultVitestAgentReporter` outright rather than layering on top of it.
`onRunEvent?: (event: RunEvent) => void` is a read-only tee onto the
internal run-event `PubSub` channel, fired for every `consoleMode` — not a
gating switch — and a throwing tap is caught and logged to stderr so it
can never break persistence or rendering.

## `AgentPlugin.discover()` entry

`AgentPlugin.discover(strategy?)` is a separate static entry point, not a
field on `AgentPluginOptions` — it must run during Vitest config
evaluation, before `configureVitest` hooks are available. See
[Discovery API](./discover-api.md) for its contract.

## Coverage-level presets and the executor→console-mode matrix

`AgentPlugin.COVERAGE_LEVELS` and `AgentPlugin.COVERAGE_LEVELS_PER_FILE`
are namespace statics, not options — records of five preset names (`none`,
`basic`, `standard`, `strict`, `full`) each mapped to a dual-output
`CoverageLevelPreset` (`{ thresholds, coverageTargets }`), so a caller
passes `preset.thresholds` to Vitest's native `coverage.thresholds` and
`preset.coverageTargets` to `AgentPlugin({ coverageTargets })` from one
source of truth. The `coverageTargets` half of each preset is one level
above the matching `thresholds` half (`none → basic`, ..., `full → full`,
capped). `AgentPlugin.COVERAGE_AUTOUPDATE` is a frozen record of three
`(newThreshold: number, previousThreshold: number) => number` tolerance
functions (`standard`, `strict`, `lenient`) for Vitest's own
`coverage.thresholds.autoUpdate` field — the plugin never sets or reads
`autoUpdate` itself.

The executor→console-mode matrix is the per-slot default table under
`console` above; there is no separate resolved value a consumer reads
directly — a custom reporter reads the plugin's resolution off
`ResolvedReporterConfig.consoleMode` instead.

## What a major may change

Adding a field to either `AgentPluginOptions` or
`AgentPluginConstructorOptions` is additive and not a major. Removing a
field, narrowing an accepted literal union (for example, dropping a
`console.human` mode), or changing a field's resolved default is a
breaking change to the public contract and needs a major plus a
changeset naming `@vitest-agent/plugin`. `coverageThresholds` moving off
this options shape entirely, onto Vitest's native `coverage.thresholds`,
is the precedent: it was a removal, not a rename, and shipped as a major.
