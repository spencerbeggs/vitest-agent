---
type: Module
title: "@vitest-agent/sdk"
description: The platform-free core of the vitest-agent family — schemas, contracts, errors, formatters, and pure utilities.
kind: package
layer: L1
resource: ../../packages/sdk
tags:
  - architecture
  - effect
  - bundle
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
  body_sha256: 2fa783eb1240081622841d10343c7630f7c6a89e3827da86e1a58991e6982f5e
sources:
  - id: sdk-index
    resource: ../../packages/sdk/src/index.ts
  - id: sdk-package-json
    resource: ../../packages/sdk/package.json
  - id: sdk-boundaries-test
    resource: ../../packages/sdk/__test__/boundaries.test.ts
  - id: sdk-coerce-error-text
    resource: ../../packages/sdk/src/utils/coerce-error-text.ts
  - id: sdk-build-report
    resource: ../../packages/sdk/src/utils/build-report.ts
  - id: sdk-reporter-contract
    resource: ../../packages/sdk/src/contracts/reporter.ts
  - id: published-schemas-dir
    resource: ../../schemas
  - id: sdk-schemastore-config
    resource: ../../packages/sdk/lib/configs/schemastore.config.ts
  - id: sdk-build-config
    resource: ../../packages/sdk/savvy.build.ts
  - id: sdk-dispatch-barrel
    resource: ../../packages/sdk/src/dispatch.ts
  - id: sdk-version
    resource: ../../packages/sdk/src/version.ts
---

# @vitest-agent/sdk

## Purpose

`@vitest-agent/sdk` is rank 1 in the repository's ranked layering: it has no
workspace dependencies, and every other family package depends on it either
directly or transitively, so a public-export change here ripples outward to
all of them.[^sdk-package-json] It owns the Effect Schema definitions that
are the single source of truth for every data structure in the family, the
public reporter and dispatcher contract types shared between the plugin,
reporter, and ui packages, the tagged error types for Effect failure
channels, the pure formatters, and a set of pure utility functions. Its
runtime dependencies are `effect` (v4, `catalog:effect`) and
`acorn`/`acorn-typescript` — nothing else.[^sdk-package-json]

The package kept the `@vitest-agent/sdk` name through the engine/sdk split
on purpose: it is the package that ships `./schemas/*.json` and
`RUN_REPORT_FILE_SCHEMA_URL`, so every consumer's
`from "@vitest-agent/sdk"` schema import stays valid.

## Boundary

`packages/sdk/__test__/boundaries.test.ts` walks every `.ts` file under
`src/` and enforces two rules mechanically (see
[Invariant: package boundaries](../invariants/package-boundaries.md)):

- no file imports `node:*`, `@effect/platform-node`,
  `@effect/sql-sqlite-node`, or any `@effected/*` package;
- no file references `process.`, with a single exemption: the exact token
  `process.env.__PACKAGE_VERSION__` may appear only in
  `src/version.ts`.[^sdk-boundaries-test]

Consequences of holding this line: path handling goes through the pure
`utils/posix-path.ts` helpers instead of `node:path`, so every path-taking
function accepts a required `cwd` parameter rather than reading an ambient
working directory — `FormatterContext.cwd`, `relativePath(filePath, cwd)`,
and `DispatchIo.cwd` all take it explicitly. Anything that needed
`node:crypto` (the idempotency cache key, the failure-signature hash) moved
to `@vitest-agent/engine` instead. The package may not import
`@vitest-agent/engine`, `plugin`, `reporter`, `cli`, `mcp`, or `ui` — the
boundary is one-directional; those packages depend on this one, never the
reverse.

## Public surface

Entry points, from `package.json` `exports`:[^sdk-package-json]

- `.` (`src/index.ts`) — the main barrel: contracts, schemas, errors,
  formatters, and utilities.
- `./dispatch` (`src/dispatch.ts`) — the pure sidecar dispatch core (below).
- `./schemas/*.json` — the published JSON Schema documents, copied from
  the repo-root `schemas/` tree at build time.

There is no `./testing` subpath in this package; that moved to
`@vitest-agent/engine/testing` with the engine split.

## Key files

### Pure path helpers (`utils/posix-path.ts`)

The path operations the core needs, implemented over normalized
forward-slash strings so nothing here imports `node:path`: `toPosix(p)`,
`basenamePosix(p)` (trailing separators ignored), `joinPosix(...parts)`
(collapses duplicate separators, skips empty parts), and the
relative/dirname helpers `test-location.ts` and the terminal formatter
consume. Every helper normalizes Windows-style backslash input via
`toPosix` at entry, so a caller never has to know which separator the
platform used.

### Error types (`src/errors/`)

Tagged error types for Effect failure channels:

- `DataStoreError` — `{ operation, table, reason }`, with a derived message
  set via `Object.defineProperty` so `Cause.pretty()` surfaces the
  operation/table/reason instead of a generic message. Also exports
  `extractSqlReason(e)`, which walks the full `cause` chain (with cycle
  guards) to the deepest useful SQLite error text, because the
  `@effect/sql-sqlite-node` driver (on Node's built-in `node:sqlite`)
  double-wraps the underlying error. Every property read in that walk
  (`.message`, `.cause`) and the terminal `String(e)` fallback is
  individually wrapped in `try`/`catch`, because an error object whose
  `message` is a throwing getter (Effect's `ConfigError` is the canonical
  case) must not turn a SQL failure into an unhandled throw.
- `DiscoveryError` — the same derived-message pattern, scoped to
  glob/read/stat operations.
- `PathResolutionError` — raised when the data directory can't be resolved;
  covers path-resolution failures that don't already have a
  more-specific tagged error (the common missing-workspace-identity case
  surfaces as `WorkspaceRootNotFoundError` instead).
- `TddErrors` — tagged errors for the goal/behavior CRUD surface
  (`GoalNotFoundError`, `BehaviorNotFoundError`, `TddTaskNotFoundError`,
  `TddTaskAlreadyEndedError`, `IllegalStatusTransitionError`). Validation
  lives at the DataStore boundary rather than in SQL triggers, because a
  trigger failure would surface as a raw `SqlError` and defeat the
  typed-error contract.

### Untrusted failure values (`utils/coerce-error-text.ts`)

Two exported helpers, `coerceErrorText(value: unknown): string | undefined`
and `coerceErrorField(source: unknown, key: string): string | undefined`.[^sdk-coerce-error-text]
Vitest types the error fields it hands a reporter (`message`, `name`,
`diff`, `actual`, `expected`, `stack`) as strings, but a test can throw
anything: `Effect.flip` on an unexpectedly-succeeding effect puts an
arbitrary success value into the error channel, and Effect's
`ConfigError.message` is a getter that throws when its cause lacks
`toString`. Left unguarded, either shape crashes the run — a non-string
bound to a SQLite `TEXT` column raises a `TypeError`, and a throwing getter
escapes the reporter entirely.

The coercion ladder: `undefined`/`null` → `undefined` (the caller decides
between `NULL` and a sentinel); string → unchanged; other primitives →
`String(value)`; objects → `JSON.stringify`, falling back to `String(value)`,
falling back to `"<unserializable>"`. Every step is exception-safe.

`coerceErrorField` guards the property *read* itself, which
`coerceErrorText` cannot: `coerceErrorText(e.message)` evaluates the getter
at the call site, before the helper is ever entered, so a throwing
`ConfigError.message` still escapes past it. `coerceErrorField(e,
"message")` wraps the access in its own `try` — a non-object (or `null`)
source yields `undefined`, a getter that throws yields the
`"<unreadable field>"` sentinel, and anything else falls through to
`coerceErrorText`. The convention this produces: read a field off a raw
Vitest error object with `coerceErrorField`; coerce a value already in
hand with `coerceErrorText`. Spreading a raw error (`{ ...e }`) is equally
unsafe, since the spread invokes every enumerable getter.

The same exception-safety premise — a formatter on the failure path must
never itself throw — extends to `extractSqlReason` (above),
`formatFatalError` (`utils/format-fatal-error.ts`, which guards the
`err.stack`/`err.message` read and the `String(err)` fallback, including
its own `err.constructor?.name` read in the recovery branch), and the
engine's `normalizeAssertionShape`, which returns `""` for a non-string
input instead of calling `.match` on it.

### Pure utilities (`utils/`)

The pure helpers that stayed in the core after the engine split, grouped
by concern:

- **Report and failure shaping** — `build-report.ts` (`buildAgentReport`,
  below), `classify-test.ts`, `coerce-error-text.ts` (above),
  `compress-lines.ts`, `compute-trend.ts`, `console-leaks.ts`,
  `detect-timeout.ts`, `format-fatal-error.ts`, `function-boundary.ts` (the
  `acorn`/`acorn-typescript` walk that identifies the smallest enclosing
  function for a given source line, feeding the engine's stable
  failure-signature hash).
- **Formatting** — `ansi.ts`, `hyperlink.ts` (OSC-8), `format-console.ts`,
  `format-gfm.ts`, `format-terminal.ts`, `format-scoped-coverage-note.ts`
  (the single source of the "partial run" sentence, described under
  Formatters below).
- **Paths and identity** — `posix-path.ts` (above), `test-location.ts`
  (`classifyTestPath` and its constants), `safe-filename.ts`,
  `normalize-workspace-key.ts` (path-segment normalizer: `/` → `__`,
  anything outside `[A-Za-z0-9._@-]` → `_`, runs collapsed),
  `canonicalize-git-url.ts` (every git URL form folds to one
  `host/org/repo` shape).
- **Host and command detection** — `detect-pm.ts` (package-manager
  detection behind an injected filesystem port), `match-vitest-command.ts`
  (the Vitest invocation patterns `injectEnv` recognizes, including a
  `package.json#scripts` one-hop indirection through an injected reader),
  `probe-host-metadata.ts` (the `host_source`/`host_value`/`host_metadata`
  triple, most-specific probe first), `detect-non-default-discover-strategy.ts`
  (pure lexical detection of a custom `DiscoverStrategy`).
- **Policy validation** — `validate-coverage-targets-shape.ts`,
  `validate-phase-transition.ts` (the pure TDD phase-transition evidence
  validator; exports `ArtifactKind`, `ArtifactSuite`, `Phase`,
  `transitionEnforcesBehaviorMatch`).

Every one of these is a plain function over its arguments — no `process`,
no `node:*`, no Effect service. The stateful counterparts
(`ProjectIdentity.resolve`, `resolveProjectKeyFromCwd`,
`computeFailureSignature`, `ensureMigrated`, `resolveDataPath`) are engine
exports.

### Report building (`utils/build-report.ts`)

`buildAgentReport` is the pure duck-typed walk that turns Vitest's
`TestModule[]` into an `AgentReport`.[^sdk-build-report] Both the plugin's
`onTestRunEnd` (Full and UI-only paths) and the MCP `run_tests` tool call
it, which is why it lives in the SDK rather than in the plugin.

Two properties of its failure gate are deliberately anti-false-green:

- **A module lands in `failed[]` when any of three things is true** — a
  test case failed, the module's own `state()` is `"failed"` (regardless
  of whether Vitest also populated `errors()`), or a suite scan
  (`children.allSuites()`) found a failed suite or suite-attached errors.
  This last path exists because a `beforeAll`/`afterAll` throw attaches to
  the suite entity and can leave `module.state()` green.
- **`reason` self-corrects.** A caller that computed `"passed"` from a
  narrower signal gets `"failed"` back when the walk produced any
  `failedFiles` or unhandled errors. The MCP tool relies on this: it
  passes a preliminary reason and lets the walk correct it.

`summary` stays a pure test-case count, with one addition:
`summary.modules` carries the count of every collected module (passing
ones included), so a green run can still report how many files ran.

### Schemas (`src/schemas/`)

The single source of truth for every data structure in the family. Each
schema defines an Effect `Schema` with `typeof Schema.Type` deriving the
TypeScript type, and `Schema.decodeUnknownEffect`/`Schema.encodeUnknownEffect`
for JSON encode/decode.[^sdk-index] Notable members:

- `Common.ts` — shared literals (`TestState`, `Environment`, `Executor`,
  `OutputFormat`, `DetailLevel`, and the console-mode union).
- `AgentReport.ts` — the test-run report shape and its constituents.
- `Coverage.ts` — coverage report shapes; `CoverageReport` carries three
  distinct policy facets (`thresholds`/`targets`/`baselines`) plus an
  optional `totalFiles` a scoped run's note renders as "N of M".
- `RunReportFile.ts` — the `.vitest/<scope>/run.json` envelope
  (`$schema`, `schemaVersion`, `generatedAt`, `reports[]`) plus
  `RUN_REPORT_FILE_SCHEMA_URL`, a versioned public contract published as a
  JSON Schema document (see Published JSON Schema documents below).
- `CoverageLevel.ts` — the `CoverageLevel` Effect Schema class with five
  named presets (`none`, `basic`, `standard`, `strict`, `full`), a
  `.withPerFile()` builder, and an `.extend({})` override method.
- `Options.ts` — `ConsoleOutputs`, `AgentPluginOptions` (the plugin's
  five-field schema surface — see
  [Interface: agent-plugin-options](../interfaces/agent-plugin-options.md)),
  and `AgentReporterOptions` (a deliberately tiny per-instance config bag,
  one field: `projectFilter`).
- `CoverageTargets.ts` — `CoverageTargets`, a `Schema.Record` whose keys
  are arbitrary strings (a top-level metric name or a glob pattern) and
  whose values reject `true` at any key other than `"100"` at decode time,
  so `{ statements: true }` fails parse rather than silently flowing
  through to a runtime parser that only honors the canonical shorthand.
- `Transport.ts` — a single-member discriminated union
  (`Schema.Union(Schema.Struct({ kind: Schema.Literal("local") }))`),
  modeled as a union from day one so a future cloud-backend option lands
  as a pure addition of union members rather than a schema-shape change.
- `RunEvent.ts` — the discriminated union over `RunEvent` variants, one
  per Vitest reporter hook that fits the event-sourced model. Fed by the
  plugin's streaming callbacks and consumed by `@vitest-agent/ui`'s
  reducer — see [Module: ui](./ui.md) and
  [DataModel: run-events](../models/run-events.md).
- `RenderState.ts` — the projected shape the ui reducer folds events into.
- `History.ts`, `Config.ts`, `Tdd.ts`, `ChannelEvent.ts`, `turns/` — test
  history, the optional `vitest-agent.config.toml` shape (see
  [Interface: config-toml](../interfaces/config-toml.md)), the
  application-level TDD hierarchy shapes, the orchestrator's progress
  event union, and the discriminated `TurnPayload` union the `record` CLI
  validates JSON-stringified payloads against.

Istanbul duck-type interfaces (below) remain as TypeScript interfaces, not
schemas — they describe an external library's shape this package only
observes.

### Public reporter contract (`src/contracts/reporter.ts`)

The plugin/reporter split's load-bearing types: `ResolvedReporterConfig`,
`ReporterKit`, `ReporterRenderInput`, `VitestAgentReporter`,
`VitestAgentReporterFactory`, `RenderedOutput`.[^sdk-reporter-contract]
These live in the SDK, rather than in the plugin or the reporter package,
so the two can share them without either taking a runtime dependency on
the other. `ResolvedReporterConfig` carries a required
`readonly coverageMode: "full" | "ui-only"` field, which the plugin
resolves from Vitest's native `coverage.enabled` and threads through
`buildReporterKit` into every reporter's kit. See
[Interface: reporter-contract](../interfaces/reporter-contract.md) for the
consumer-facing promise.

`RenderedOutput` (`src/formatters/types.ts`) is a discriminated union on
`target`: the `stdout`/`github-summary`/`file` member is
`{ content, contentType }`, and the `report` member adds a flat `filename`
for Vitest 5's `.vitest/<scope>/` report directory.

### Formatters (`src/formatters/`)

Pluggable output formatters implementing a `Formatter` interface
(`{ format, render(reports, context) }`), each producing `RenderedOutput[]`.
The set covers structured console markdown, GFM for
`GITHUB_STEP_SUMMARY`, raw JSON, silent (no output), terminal (plain text
plus optional ANSI/OSC-8), and `ci-annotations` (GitHub Actions workflow
commands, auto-selected when `environment === "ci-github"` and
`executor === "ci"`). Every formatter is pure: paths are relativized
against the required `FormatterContext.cwd` — never against an ambient
working directory — and the markdown formatter's OSC-8 hyperlinks are
gated on `target === "stdout"` and `!ctx.noColor`, so MCP responses never
receive terminal escape codes.

`utils/format-scoped-coverage-note.ts` exports the pure
`formatScopedCoverageNote(testedFileCount, totalFileCount?)`, producing
`"Coverage thresholds skipped: partial run (N of M test files)"` (or
`"(N test files)"` when the total is unknown). It is the single source of
that sentence across every surface that needs it: the terminal formatter's
coverage section, the console/markdown formatter, the MCP `run_tests`
summary, and both `@vitest-agent/ui` dispatch entry points.

### Published JSON Schema documents (`schemas/`)

The repo-root `schemas/` tree holds the generated, committed JSON Schema
document this package publishes today: `schemas/5.0/run.json`, whose
`$id` is the GitHub raw URL of that committed file
(`RUN_REPORT_FILE_SCHEMA_URL`).[^published-schemas-dir]
`@effected/schemastore-cli` generates it (`schema:build` / `schema:check`
scripts, `schemastore build` / `schemastore check`) from
`lib/configs/schemastore.config.ts`, whose hosted identity sits in
`lib/configs/run-report-schema.ts`; both live under `lib/` rather than
`src/` because `src/` may not import `@effected/*` (see Boundary
above).[^sdk-schemastore-config] Turbo runs `schema:build` before this
package's `build:dev`, and `savvy.build.ts` copies the repo-root `schemas/`
tree into every emitted package directory after the bundler runs, which is
what `package.json`'s `"./schemas/*.json"` export resolves
offline.[^sdk-build-config] `__test__/schema-drift.e2e.test.ts` spawns
`schemastore check` and pins the URL constant to the config's `$id`. See
[Interface: published-json-schemas](../interfaces/published-json-schemas.md).

### Dispatch subpath (`./dispatch`)

The sidecar dispatch core is exported through a dedicated narrow entry
point, `@vitest-agent/sdk/dispatch` (barrel `src/dispatch.ts`), re-exporting
`dispatch`/`DispatchIo`/`DispatchResult` (`src/sidecar-dispatch.ts`),
`injectEnv`/`InjectEnvInput` (`src/internal-inject-env.ts`), and
`exitCodeForTag` (`src/exit-code-for-tag.ts`).[^sdk-dispatch-barrel] These
symbols moved into the SDK from `@vitest-agent/cli` to break a workspace
dependency cycle.

The core is pure: `dispatch(argv, io)` and `injectEnv` take
`io = { cwd: string; env: Record<string, string | undefined>; readFile: (path: string) => string }`
and neither reads `process` nor `node:fs` directly. The four
`sidecar-<platform>` bins and the CLI's `agent inject-env` fallback pass
`process.cwd()`, `process.env`, and a `readFileSync` wrapper (the reader
throws on a miss; `dispatch`/`injectEnv` catch it). `--cwd` overrides
`io.cwd`; the `package.json#scripts` one-hop indirection in
`match-vitest-command` goes through `io.readFile`.

The dedicated `./dispatch` entry exists rather than reusing the main
barrel because the four per-platform `@vitest-agent/sidecar-<platform>`
SEA binaries import `dispatch` from this subpath and the SEA bundle must
stay small: importing from `.` would force the bundler to start from the
full core module graph and tree-shake it away, whereas `./dispatch`
guarantees a minimal reachable graph from the start (`dispatch` →
`injectEnv` → the pure `match-vitest-command` helpers, plus the pure
`exitCodeForTag` switch). The symbols are deliberately not re-exported
from the main barrel — see [Module: sidecar](./sidecar.md) and
[Interface: sdk-dispatch](../interfaces/sdk-dispatch.md).

### CURRENT_SDK_VERSION

`src/version.ts` exports `CURRENT_SDK_VERSION: string`, inlined from
`process.env.__PACKAGE_VERSION__` by the bundler at build time (source-level
reads see the `"0.0.0"` fallback).[^sdk-version] It is the one sanctioned
`process` token in this platform-free core, confined to this file by the
boundary test. Every runtime package in the family exports the analogous
`CURRENT_<PKG>_VERSION` constant the same way; these are public API — a
consumer can read a package's own release version — but nothing compares
them across packages at runtime under independent per-package versioning.

## Choices absorbed here

**Errors flow back through Effect's `Cause` channel.** Each tagged error
(`DataStoreError`, `DiscoveryError`, `PathResolutionError`, `TddErrors`)
sets a derived message of the form `[operation entity] reason` so
`Cause.pretty()` produces useful stderr output, rather than the generic
"An error has occurred".

**Duck-typed external APIs.** Coverage integration has to work with both
`@vitest/coverage-v8` and `@vitest/coverage-istanbul`; the `onCoverage`
hook receives an Istanbul `CoverageMap`, and both providers normalize to
the same shape. Rather than force a specific coverage provider as a peer
dependency, the SDK duck-types at runtime via `isIstanbulCoverageMap()`
and keeps the Istanbul interfaces as plain TypeScript interfaces, never
Effect Schemas — they describe a library this package does not own, and
schemas exist to describe the family's own data. The same premise applies
to Vitest's `TestModule`/`TestCase` shapes consumed by `buildAgentReport`
and the formatters: structural interfaces checked where needed, rather
than a hard dependency on Vitest's internal types.

**Effect Schema is the only schema language in the family.** Report and
manifest data must be type-safe in TypeScript and serializable to and from
JSON; Effect Schema definitions under `src/schemas/` are the one place
that shape is declared, TypeScript types derive via `typeof Schema.Type`,
and JSON encode/decode goes through the v4 effectful codecs
(`Schema.decodeUnknownEffect`/`Schema.encodeUnknownEffect`). The MCP
server's tool inputs, outputs, and prompt arguments are Effect Schemas
served through Effect's own `McpServer`; there is no separate validation
library anywhere in the family.

## Testing

Tests live in `packages/sdk/__test__/` (flat) and need no filesystem —
tests inject `readFile` maps or explicit `cwd` strings instead of touching
disk. `__test__/boundaries.test.ts` is the guardrail suite described above
under Boundary.

[^sdk-index]: `../../packages/sdk/src/index.ts`
[^sdk-package-json]: `../../packages/sdk/package.json`
[^sdk-boundaries-test]: `../../packages/sdk/__test__/boundaries.test.ts`
[^sdk-coerce-error-text]: `../../packages/sdk/src/utils/coerce-error-text.ts`
[^sdk-build-report]: `../../packages/sdk/src/utils/build-report.ts`
[^sdk-reporter-contract]: `../../packages/sdk/src/contracts/reporter.ts`
[^published-schemas-dir]: `../../schemas`
[^sdk-schemastore-config]: `../../packages/sdk/lib/configs/schemastore.config.ts`
[^sdk-build-config]: `../../packages/sdk/savvy.build.ts:17-36`
[^sdk-dispatch-barrel]: `../../packages/sdk/src/dispatch.ts`
[^sdk-version]: `../../packages/sdk/src/version.ts`
