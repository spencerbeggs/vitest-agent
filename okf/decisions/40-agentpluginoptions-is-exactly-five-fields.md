---
type: Decision
title: AgentPluginOptions Is a Closed, Minimal Shape
description: AgentPluginOptions carries only the option surface no other owner already covers, pushing coverage enforcement, renderer internals, and derived flags to their existing owners instead of duplicating them.
status: stable
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: c93e1f18b183eb00f1fa084a85dc3ec9377fab377f1877dc6d6e7518d7d21153
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# AgentPluginOptions Is a Closed, Minimal Shape

## Context

`AgentPluginOptions` used to be a grab bag of coverage thresholds,
console-formatting knobs, cache-directory overrides, and log settings,
duplicated a second time on a parallel `AgentReporterOptions` schema. The
2.0 cleanup pruned it to a deliberately small, closed shape and pushed
every removed concern to an existing owner instead of inventing a new one.
The cleanup originally landed at five fields (`console`, `coverageTargets`,
`reporter`, `onRunEvent`, `transport`); the current code carries six —
`console`, `coverageTargets`, `transport`, `report` on the schema-decodable
struct (`packages/sdk/src/schemas/Options.ts`) plus the function-typed
`reporter` and `onRunEvent` on the companion interface
(`packages/plugin/src/plugin.ts`) — after a `report` field was added
to control `.vitest/<scope>/` report-file writes
(`packages/plugin/src/plugin.ts`).

## Decision

`AgentPluginOptions` (`packages/sdk/src/schemas/Options.ts`) is an
Effect Schema struct carrying exactly the four data-shaped fields:
`console` (the per-executor console-output matrix), `coverageTargets`, an
optional `transport` (a single-member discriminated union today, `{ kind:
"local" }`, modeled as `Schema.Union` rather than a bare struct so a future
cloud-backend swap lands as new union members rather than a schema-shape
diff), and `report` (`ReportOption` — `false` to disable `.vitest/<scope>/`
writes, or `{ scope }` to rename the directory;
`packages/sdk/src/schemas/Options.ts`). `AgentPluginConstructorOptions`
(`packages/plugin/src/plugin.ts`) extends that struct with the two
function-typed fields Effect Schema cannot encode cleanly — `reporter`
(the `VitestAgentReporterFactory` override) and `onRunEvent` (the
read-only per-event tap) — plus `discoverStrategy`, which the interface
comment (`packages/plugin/src/plugin.ts`) explicitly frames as
orthogonal to the data-shaped options rather than a seventh member of "the
options": it is a genuine extension point, not a user-facing setting most
callers ever touch.

Three concerns were deliberately kept off this surface because another part
of the system already owns them. Coverage enforcement (`coverageThresholds`,
`autoUpdate`) is handed back to Vitest's own `coverage.thresholds` and
`coverage.thresholds.autoUpdate` fields — see
[Decision 38](./38-coverage-policy-presets-configvalidation-full-and-ui-only-modes.md).
Renderer-internal formatting (`format`, `consoleOutput`, `detail`,
`coverageConsoleLimit`, `githubSummary`, `githubSummaryFile`) has no
user-facing knob at all — the plugin owns the default reporter outright
(see [Decision 41](./41-shape-tailored-dispatcher-matrix.md)), and a custom
reporter via `VitestAgentReporterFactory` is the override path when a
consumer needs different output. `mcp` and `githubActions` are auto-derived
rather than declared: `mcp` is `executor === "agent"`
(`packages/plugin/src/plugin.ts`) since the agent slot is the only
one that owns the MCP attribution path, and `githubActions` follows the
same executor-plus-console-mode derivation, so a user who wants to suppress
the GitHub Step Summary sets the `ci` console slot to `"silent"` instead of
declaring a second flag that could contradict it. `cacheDir` moved to
`vitest-agent.config.toml`, and `logLevel`/`logFile` moved to the
`VITEST_REPORTER_LOG_LEVEL` / `VITEST_REPORTER_LOG_FILE` env vars.

`AgentReporterOptions` (`packages/sdk/src/schemas/Options.ts`) is
intentionally tiny — one field, `projectFilter`, set by the plugin
per-project for per-project report scoping. It is not a second copy of
`AgentPluginOptions`; the substantive reporter contract for custom-reporter
authors is `ResolvedReporterConfig` / `ReporterKit` / `ReporterRenderInput`
/ `VitestAgentReporter` / `VitestAgentReporterFactory` in
`packages/sdk/src/contracts/reporter.ts`. Most consumers never construct
`AgentReporterOptions` directly — they wire `AgentPlugin({ reporter })` and
the factory receives a fully-resolved `ReporterKit`.

`CoverageTargets` and `Transport` live in their own schema files
(`packages/sdk/src/schemas/CoverageTargets.ts`,
`packages/sdk/src/schemas/Transport.ts`) rather than being inlined into
`Options.ts`, keeping each schema independently reviewable and reusable
from other contracts (`ResolvedReporterConfig.transport`, for example).

## Alternatives rejected

- **Keep a flat grab-bag options struct** covering coverage thresholds,
  renderer internals, and cache/log paths on `AgentPluginOptions`: rejected
  because every one of those concerns already has, or gained, a more
  specific owner (Vitest's native coverage config, the plugin's own default
  renderer, `vitest-agent.config.toml`, env vars), and duplicating the
  setting on the plugin options only created a second place the two could
  disagree.
- **A parallel `AgentReporterOptions` mirroring the full option surface** so
  custom reporters could see everything the plugin sees: rejected in favor
  of a fully-resolved `ReporterKit` passed to the factory at render time —
  a custom reporter author reads resolved facts (`ResolvedReporterConfig`)
  rather than re-deriving them from a second copy of raw user input.
- **A deprecation cycle for the removed fields** (aliasing, soft warnings):
  rejected because pre-2.0 was the deliberate moment to break the surface
  cleanly; a regression sweep test
  (`packages/sdk/__test__/options-removed.test.ts`) greps the removed field
  names across `packages/*/src/` so any copy-paste of old option names trips
  CI instead of silently flowing through.
- **Folding `discoverStrategy` into the schema-decodable struct** alongside
  `console`/`coverageTargets`/`transport`/`report`: rejected because it is
  a class-instance extension point, not schema-decodable user data, and
  belongs with the other function-typed companion-interface fields instead.

## Consequences

- A consumer adding a new plugin-facing setting must first ask whether an
  existing owner (Vitest's native config, the renderer, the TOML config
  file, an env var) already covers it before adding a field to
  `AgentPluginOptions` — the closed-shape intent means growth here is the
  exception, not the default.
- `AgentPluginOptions` staying schema-decodable (no functions) means any
  future field that must carry a function belongs on the companion
  `AgentPluginConstructorOptions` interface, following the `reporter` /
  `onRunEvent` / `discoverStrategy` precedent, not on the published Effect
  Schema.
- The regression sweep test is the enforcement mechanism for the removed
  fields; anyone restoring one of the old names anywhere under
  `packages/*/src/` fails CI immediately rather than shipping a silent
  regression.

## Related

- [Decision 38 — Coverage Policy — Presets, ConfigValidation, Full and UI-only Modes](./38-coverage-policy-presets-configvalidation-full-and-ui-only-modes.md)
- [Decision 41 — Shape-Tailored Dispatcher Matrix](./41-shape-tailored-dispatcher-matrix.md)
- [Interface: agent-plugin-options](../interfaces/agent-plugin-options.md)
