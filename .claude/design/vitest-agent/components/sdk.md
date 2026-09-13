---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 95
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
  - ./engine.md
  - ./plugin.md
  - ./reporter.md
  - ./cli.md
  - ./mcp.md
  - ./ui.md
  - ./sidecar.md
dependencies: []
---

# SDK package (`@vitest-agent/sdk`)

The platform-free core of the family — rank 1 in the ranked layering of
Decision 70 ([../decisions.md](../decisions.md)). Owns the Effect Schemas,
the public reporter and dispatcher contracts, the tagged error types, the
pure formatters and utilities, the pure sidecar dispatch core behind the
`./dispatch` entry, and the published JSON Schema documents. Everything
that touches a filesystem, SQLite, `process` or an environment map —
services, layers, migrations, the XDG stack, the hook programs, the
testing presets — lives in `@vitest-agent/engine` ([./engine.md](./engine.md)).

The package kept the `@vitest-agent/sdk` *name* through the split on
purpose: it is the package that ships `./schemas/*.json` and
`RUN_REPORT_FILE_SCHEMA_URL`, so the published `$id` URLs and every
consumer's `from "@vitest-agent/sdk"` schema import stay valid. The
engine-tier exports leaving it was a major.

**npm name:** `@vitest-agent/sdk`
**Location:** `packages/sdk/`
**Internal dependencies:** none
**Runtime dependencies:** `effect`, `acorn`, `acorn-typescript` — nothing else
**Entry points:** `.` (the main barrel), `./dispatch` (the pure sidecar
dispatch core), `./schemas/*.json` (the published JSON Schema documents)

**Key external dependencies:**

- `effect` (v4, `catalog:effect`) — `Schema`, `Context`, `Effect` for the
  contracts and formatters; no `effect/unstable/*` platform surface
- `acorn` + `acorn-typescript` — AST parser used by `findFunctionBoundary`
  (`utils/function-boundary.ts`) to identify the smallest enclosing
  function for a given source line. The TypeScript plugin lets us parse
  `.ts` sources with type annotations, generics, decorators, and `as`
  casts without throwing. The failure-signature computation that calls
  it lives in the engine (it hashes with `node:crypto`)

`@effect/platform-node` and `@effected/schemastore` are devDependencies
only, for `scripts/generate-schemas.ts` and the schema drift test.

For decisions referenced throughout: see [../decisions.md](../decisions.md).

---

## Core boundary

`packages/sdk/__test__/boundaries.test.ts` walks every `.ts` under `src/`
through the shared comment-stripping scanner (`__test__/utils/boundaries.ts`:
`walkTs`, `referencesProcess`, `importSpecifiers`) and asserts two rules:

- no file imports `node:*`, `@effect/platform-node`,
  `@effect/sql-sqlite-node` or any `@effected/*` package;
- no file references `process.`. The single exemption is the exact token
  `process.env.__PACKAGE_VERSION__`, a compile-time literal the bundler
  substitutes, which may appear only in `src/version.ts` — the test asserts
  the token's user list is exactly `["version.ts"]`.

What the rules forced out or reshaped: `services/idempotency.ts` and
`utils/failure-signature.ts` (both `node:crypto`) moved to the engine;
`utils/test-location.ts` and `formatters/terminal.ts` dropped `node:path`
for the pure `utils/posix-path.ts` helpers; `utils/format-console.ts`'s
`relativePath(filePath, cwd)` takes a required `cwd` and `FormatterContext.cwd`
is required; the `./dispatch` core takes its I/O as a parameter (below).
Two consequences worth knowing: `classifyTestPath`'s `suggestedPath` now
uses `/` on Windows, and the terminal formatter's OSC-8 absolute-path check
handles only `/`-rooted paths (a `[A-Za-z]:` drive form is a recorded
follow-up; no production caller today).

## Pure path helpers (`utils/posix-path.ts`)

The handful of path operations the core needs, implemented over normalized
forward-slash strings so nothing here imports `node:path`. Every helper
accepts Windows-style input (a backslash separator) and normalizes it via
`toPosix` at entry, so a caller never has to know which separator the
platform used: `toPosix(p)`, `basenamePosix(p)` (trailing separators
ignored), `joinPosix(...parts)` (collapses duplicate separators at the
seams, skips empty parts), plus the relative / dirname helpers
`test-location.ts` and `terminal.ts` consume.

## Error types

`packages/sdk/src/errors/`. Tagged error types for Effect failure channels.

- `DataStoreError` — `{ operation, table, reason }`. Constructor sets a
  derived message via `Object.defineProperty` so `Cause.pretty()` surfaces
  the operation/table/reason instead of the default "An error has
  occurred". Also exports `extractSqlReason(e)` which pulls the actual
  SQLite text (like `SQLITE_BUSY: ...`) instead of the generic
  `"Failed to execute statement"` wrapper. On Effect v4 the
  `@effect/sql-sqlite-node` driver runs on Node's built-in `node:sqlite` and
  **double-wraps** the driver error — the real message sits at
  `cause.cause.message`, not on the top-level `SqlError` — so
  `extractSqlReason` walks the full `cause` chain (with cycle guards) to the
  deepest useful message rather than reading a single `.cause`. Every
  property read in that walk (`.message`, `.cause`) and the terminal
  `String(e)` are individually wrapped in `try`/`catch`: an error object
  whose `message` is a throwing getter (Effect's `ConfigError` is the
  canonical case) must not turn a SQL failure into an unhandled throw.
  The engine's `DataStoreLive` and `DataReaderLive` route every `Effect.mapError` site
  through this so the underlying SQLite text reaches the user.
- `DiscoveryError` — same derived-message pattern, scoped to
  glob/read/stat operations.
- `PathResolutionError` — raised when the data directory can't be
  resolved. The most common case (missing workspace identity) usually
  surfaces as the underlying `WorkspaceRootNotFoundError`; this error
  covers path-resolution failures that don't already have a more-specific
  tagged error.
- `TddErrors` — tagged errors for the goal/behavior CRUD surface
  (`GoalNotFoundError`, `BehaviorNotFoundError`,
  `TddTaskNotFoundError`, `TddTaskAlreadyEndedError`,
  `IllegalStatusTransitionError`). Validation lives at the DataStore
  boundary, not in SQL triggers — triggers would surface as raw `SqlError`
  and defeat the typed-error contract. The MCP boundary catches these via
  `_tdd-error-envelope.ts` and surfaces success-shape `{ ok: false, error:
  { _tag, ..., remediation } }` responses (Decision 71).

## Untrusted failure values (`coerceErrorText` / `coerceErrorField`)

`packages/sdk/src/utils/coerce-error-text.ts` exports two public helpers,
`coerceErrorText(value: unknown): string | undefined` and
`coerceErrorField(source: unknown, key: string): string | undefined`.
Vitest types the
error fields it hands a reporter (`message`, `name`, `diff`, `actual`,
`expected`, `stack`) as strings, but their runtime content is whatever the
test threw. Two shapes routinely violate the type: `Effect.flip` on an
unexpectedly-succeeding effect puts an arbitrary success value (often a
plain object) into the error channel, and Effect's `ConfigError.message` is
a getter that throws when its cause lacks `toString`. Either one crashed
the run — a non-string bound to a SQLite `TEXT` column raises
`TypeError: Invalid argument type`, and a throwing getter escaped the
reporter entirely.

The coercion ladder: `undefined`/`null` → `undefined` (the caller decides
between `NULL` and a sentinel), string → unchanged, other primitives →
`String(value)`, objects → `JSON.stringify` falling back to `String(value)`
falling back to `"<unserializable>"`. Every step is exception-safe.

**`coerceErrorField` guards the property read itself.** `coerceErrorText`
can only defend a value it already holds — `coerceErrorText(e.message)`
evaluates the getter *at the call site*, before the helper is entered, so
the `ConfigError.message` shape still throws straight past it.
`coerceErrorField(e, "message")` wraps the access in its own `try`:
a non-object (or `null`) source yields `undefined`, a getter that throws
yields the `"<unreadable field>"` sentinel, and anything else falls
through to `coerceErrorText`. The same premise motivates the two
hand-rolled sibling readers for non-string fields — the reporter's
`readErrorStacks` and the `stacks` read inside `mapErrors` — which guard
the access and drop frames rather than crash.

The convention that follows: **read fields off a raw Vitest error object
with `coerceErrorField`; coerce a value already in hand with
`coerceErrorText`.** Spreading a raw error (`{ ...e }`) is equally unsafe,
since the spread invokes every enumerable getter — the reporter builds an
explicit object of already-coerced fields for `processFailure` instead.

Applied at the boundaries where an untrusted value first meets a typed
sink: `DataStoreLive.writeErrors` coerces every text column bind with
`coerceErrorText` (values it is handed, with `"<missing message>"` as the
not-null sentinel for `message`), while the raw-object read sites use
`coerceErrorField` — the plugin reporter's three `TestErrorInput` push
sites and its `errorMap` lookup, and `mapErrors` inside
`buildAgentReport`.

Three neighbouring helpers were made exception-safe in the same pass, on
the same premise — a formatter on the failure path must never itself
throw: `extractSqlReason` (above), `formatFatalError`
(`utils/format-fatal-error.ts`, which now guards the `err.stack` /
`err.message` read and the `String(err)` fallback), and
`normalizeAssertionShape` (the engine's `utils/failure-signature.ts`, which
returns `""` for a non-string input instead of calling `.match` on it). The
plugin's own `stringifyFailureValue` got the same treatment — see
[./plugin.md](./plugin.md).

Two follow-up hardenings closed the remaining holes in those two
formatters: `formatFatalError`'s recovery branch guards its own
`err.constructor?.name` read (a throwing `constructor` getter would
otherwise throw while handling a throw, which escapes), and
`extractSqlReason` treats a `JSON.stringify` that *returns* `undefined`
— a `toJSON` returning `undefined`, which never throws — as a miss and
falls through to the `String(e)` branch instead of returning
`undefined` from a `string`-typed function.

## Pure utilities (`utils/`)

The 25 pure helpers that stayed in the core after the split. Grouped:

- **Report and failure shaping** — `build-report.ts` (`buildAgentReport`,
  below), `classify-test.ts`, `coerce-error-text.ts` (below),
  `compress-lines.ts`, `compute-trend.ts`, `console-leaks.ts`
  (`collectConsoleLeakEntries` / `buildConsoleLeaks`), `detect-timeout.ts`,
  `format-fatal-error.ts`, `function-boundary.ts` (the acorn walk).
- **Formatting** — `ansi.ts`, `hyperlink.ts` (OSC-8), `format-console.ts`,
  `format-gfm.ts`, `format-terminal.ts`, `format-scoped-coverage-note.ts`
  (the single source of the "partial run" sentence — see *Formatters*).
- **Paths and identity** — `posix-path.ts` (above), `test-location.ts`
  (`classifyTestPath` and its constants), `safe-filename.ts`,
  `normalize-workspace-key.ts` (the path-segment normalizer: `/` → `__`,
  anything outside `[A-Za-z0-9._@-]` → `_`, runs collapsed),
  `canonicalize-git-url.ts` (every git URL form → one `host/org/repo`
  shape; `/` → `__` for the filesystem-safe `projectKey`).
- **Host and command detection** — `detect-pm.ts` (package-manager
  detection behind a `FileSystemAdapter` port), `match-vitest-command.ts`
  (the five Vitest invocation patterns `injectEnv` recognizes, with the
  `package.json#scripts` one-hop indirection through the injected reader),
  `probe-host-metadata.ts` (the `host_source` / `host_value` /
  `host_metadata` triple; most specific probe first, `null` fallback),
  `detect-non-default-discover-strategy.ts` (pure lexical detection of a
  custom `DiscoverStrategy`, Decision 61).
- **Policy validation** — `validate-coverage-targets-shape.ts`,
  `validate-phase-transition.ts` (the pure D2 evidence-binding validator;
  exports `ArtifactKind`, `ArtifactSuite`, `Phase`,
  `transitionEnforcesBehaviorMatch`).

Everything here is a plain function over its arguments: no `process`, no
`node:*`, no Effect service. The stateful counterparts
(`ProjectIdentity.resolve`, `resolveProjectKeyFromCwd`,
`computeFailureSignature`, `ensureMigrated`, `resolveDataPath`) are engine
exports.

## Report building (`buildAgentReport`)

`packages/sdk/src/utils/build-report.ts`. The pure duck-typed walk that
turns Vitest's `TestModule[]` into an `AgentReport`. Both the plugin's
`onTestRunEnd` (Full and UI-only paths) and the MCP `run_tests` tool call
it, which is why it lives in the SDK rather than in the plugin.

Two properties of its failure gate are load-bearing, both anti-false-green
(see [../decisions.md](../decisions.md) D45 and D48):

- **A module lands in `failed[]` when any of three things is true** — a
  test case failed, the module's own `state()` is `"failed"` (regardless of
  whether Vitest also populated `errors()`), or the suite scan found a
  failed suite or suite-attached errors. The suite scan reads
  `children.allSuites()` and folds each suite's `state()` and optional
  `errors()` into the module's error list, because a `beforeAll` /
  `afterAll` throw attaches to the suite entity and can leave
  `module.state()` green. `VitestTestSuite` gained an optional `errors()`
  member for that read; it is optional so older duck-typed callers still
  satisfy the interface.
- **`reason` self-corrects.** A caller that computed `"passed"` from a
  narrower signal gets `"failed"` back when the walk produced any
  `failedFiles` or any unhandled errors. The MCP tool relies on this: it
  passes a preliminary reason and lets the walk correct it.

`summary` stays a pure test-case count (D45), with one addition:
`summary.modules` carries the count of every collected module, passing
ones included, so a green run can still report how many files ran.

## Schemas

`packages/sdk/src/schemas/`. Single source of truth for all data
structures. Defines Effect Schema definitions with `typeof Schema.Type` for
TypeScript types and `Schema.decodeUnknownEffect`/`Schema.encodeUnknownEffect`
for JSON
encode/decode.

| File | Contents |
| ---- | -------- |
| `Common.ts` | Shared literals (`TestState`, `Environment`, `Executor`, `OutputFormat`, `DetailLevel`, `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the union `ConsoleMode`) |
| `AgentReport.ts` | The test-run report shape and its constituents |
| `Coverage.ts` | Coverage report shapes. `CoverageReport` carries three distinct policy facets (`thresholds` / `targets` / `baselines`, issue #237) plus the optional `totalFiles` a scoped run's note renders as "N of M" (issue #160) |
| `TestArtifacts.ts` | Vitest 5 test annotations and test artifacts: `TestAnnotation`, `TestArtifact`, `TestAttachment`, `TestArtifactLocation`. See [../schemas.md](../schemas.md) *Vocabulary* — these are not TDD artifacts |
| `RunReportFile.ts` | The `.vitest/<scope>/run.json` envelope (`$schema`, `schemaVersion`, `generatedAt`, `reports[]`) plus `RUN_REPORT_FILE_SCHEMA_URL`. A versioned public contract, published as a JSON Schema document |
| `Thresholds.ts` | Coverage threshold and resolved-threshold shapes |
| `Baselines.ts` | Coverage baseline shapes |
| `Trends.ts` | Coverage trend shapes |
| `CacheManifest.ts` | Cache manifest shapes (legacy file-based manifest discovery) |
| `CoverageLevel.ts` | `CoverageLevel` Effect Schema class with five named presets (`none`, `basic`, `standard`, `strict`, `full`), `.withPerFile()` builder, and `.extend({})` override method. Also exports `CoverageLevelName`, `CoverageInput`, and `resolveCoverageInput`. Also exports `validateCoverageConfig`; the plugin no longer calls it (the `ConfigValidation` service is the read path) and it is kept as a public helper for downstream callers |
| `Options.ts` | Holds `ConsoleOutputs`, `AgentPluginOptions`, and `AgentReporterOptions`. `AgentPluginOptions` is the 5-field shape — `console`, `coverageTargets`, `transport` on the schema; `reporter` and `onRunEvent` are function-typed and live on the plugin's `AgentPluginConstructorOptions` companion interface. `AgentReporterOptions` is intentionally tiny — one field (`projectFilter`) — and is the narrow per-instance config bag the reporter implementation accepts; most users never see it |
| `CoverageTargets.ts` | Exports `CoverageTargets` and the nested `CoverageTargetsMetrics` schemas. `CoverageTargets` is a `Schema.Record` whose keys are arbitrary strings (treated as either a top-level metric name or a glob pattern) and values are `Schema.Union(Schema.Positive, Schema.Literal(true), CoverageTargetsMetrics)`. A decode-time refinement rejects `true` at any key other than `"100"` so `{ statements: true }` fails parse rather than silently flowing through to a runtime parser that only honors the canonical shorthand at key `"100"`. Negatives and zeros are rejected at decode time |
| `Transport.ts` | Single-member discriminated union `Schema.Union(Schema.Struct({ kind: Schema.Literal("local") }))`. Modeled as a union from day one so the 3.0 cloud-backend swap (D1, Turso, etc.) lands as a pure addition of union members rather than a schema-shape change. See [../decisions.md](../decisions.md) D40 |
| `validate-coverage-targets-shape.ts` (in `utils/`) | Pure helper `validateCoverageTargetsShape(input): { errors, warnings, info }`. Walks raw input and emits structured diagnostics with pinpointed paths: `INVALID_TARGET_VALUE` (zero or negative numbers, at the top level or inside glob-pattern entries) and `PERFILE_ON_TARGETS` (the `perFile` key set inside `coverageTargets` rather than on `coverage.thresholds.perFile`, or on the matching glob's own `perFile` key under Vitest 5). Consumed by the plugin's `ConfigValidation` rule registry |
| `RunEvent.ts` | Discriminated union over the `RunEvent` variants — one per Vitest reporter hook that fits the event-sourced model, covering run / module / suite / hook / test lifecycle, console, coverage, trend, classification and watch mode. Fed by the plugin's streaming callbacks and consumed by `@vitest-agent/ui`'s reducer. See [../schemas.md](../schemas.md) for the variant inventory |
| `RenderState.ts` | The projected shape the `@vitest-agent/ui` reducer folds events into (`phase`, `runId`, `modules`, `moduleOrder`, `totals`, `coverage`, `failures`, `suggestedActions`, and the optional `collectedModules`). `CoverageRenderState` carries the optional `scoped` / `scopedFiles` / `totalFiles` triple folded from `CoverageReady` (issue #160). Both the agent string renderer and the Ink tree read this shape |
| `History.ts` | `TestRun`, `TestHistory`, `HistoryRecord` |
| `Config.ts` | `VitestAgentConfig` for the optional `vitest-agent.config.toml`. Both fields (`cacheDir?`, `projectKey?`) are optional; absence falls back to deriving the path from the workspace's `package.json` `name` |
| `Tdd.ts` | Application-level (camelCase) shapes for the three-tier hierarchy: `GoalStatus`/`BehaviorStatus`, `GoalRow`, `BehaviorRow`, `GoalDetail`, `BehaviorDetail`. SQL row shapes (snake_case) live in the engine's `sql/rows.ts`; these are the API shapes |
| `ChannelEvent.ts` | Discriminated union over the orchestrator's progress events. `tdd_progress_push` validates payloads against this union. Also exports `BehaviorScopedEventTypes` — the subset whose `goalId`/`sessionId` the MCP server resolves server-side from `behaviorId` |
| `turns/` | Discriminated `TurnPayload` union over the per-payload schemas (user-prompt, tool-call, tool-result, file-edit, hook-fire, note, hypothesis). The `record` CLI validates JSON-stringified payloads against this union before writing `turns.payload` |

Istanbul duck-type interfaces remain as TypeScript interfaces, not schemas
— they describe an external library's shape we observe.

## Public reporter contract

`packages/sdk/src/contracts/reporter.ts`. The plugin/reporter split's load-
bearing types: `ResolvedReporterConfig`, `ReporterKit`,
`ReporterRenderInput`, `VitestAgentReporter`, `VitestAgentReporterFactory`,
`RenderedOutput`. These live in the SDK so the plugin and reporter packages
can share them without either taking a runtime dependency on the other.

`RenderedOutput` (`packages/sdk/src/formatters/types.ts`) is a discriminated
union on `target`. The `stdout` / `github-summary` / `file` member is
`{ content, contentType }`; the `report` member adds a flat `filename` and
is written into Vitest 5's `.vitest/<scope>/` report directory by the
plugin. See Decision 67 in [../decisions.md](../decisions.md).

`ResolvedReporterConfig` carries a required `readonly coverageMode: "full" |
"ui-only"` field. The plugin resolves it from Vitest's native
`coverage.enabled` (false maps to `ui-only`; anything else maps to `full`)
and threads it through `buildReporterKit` into every reporter's kit. The
internal `AgentReporter` lifecycle class reads `coverageMode` to gate the
persistence pipeline in `onTestRunEnd` (see [./plugin.md](./plugin.md) for
the short-circuit). Locking `coverageMode` on the resolved kit rather than
on `AgentReporterOptions` keeps it as a per-run resolved fact — see
[../decisions.md](../decisions.md) for the rationale.

For the contract semantics see [./reporter.md](./reporter.md); for how the
plugin assembles the kit and routes outputs see [./plugin.md](./plugin.md).

## Formatters

`packages/sdk/src/formatters/`. Pluggable output formatters implementing
the `Formatter` interface (`{ format, render(reports, context) }`). Each
formatter produces `RenderedOutput[]` with `target`, `content`,
`contentType`.

The set covers structured console markdown, GFM for `GITHUB_STEP_SUMMARY`,
raw JSON, silent (no output), terminal (plain text + optional ANSI/OSC-8),
and `ci-annotations` (GitHub Actions workflow commands, auto-selected when
`environment === "ci-github"` AND `executor === "ci"`).

The markdown formatter wires the `osc8` utility into failing-test header
lines via a regex post-processor — gated on `target === "stdout"` AND
`!ctx.noColor` so MCP responses never receive OSC-8 codes. Terminal
hyperlinks are CLI-and-stdout-only. Every formatter is pure: paths are
relativized against the required `FormatterContext.cwd` (the caller passes
`process.cwd()`), never against an ambient working directory.

**Scoped-coverage note.** `packages/sdk/src/utils/format-scoped-coverage-note.ts`
exports the pure `formatScopedCoverageNote(testedFileCount, totalFileCount?)`
→ `"Coverage thresholds skipped: partial run (N of M test files)"` (or
`"(N test files)"` when the total is unknown). It is the single source of
that sentence for every surface: the terminal formatter's coverage section
(`aggregateCoverage` folds `scoped` / `scopedFiles` / `totalFiles` across
per-project reports), the console/markdown formatter, the MCP `run_tests`
summary (`scopedNote`), and both `@vitest-agent/ui` dispatch entry points.
In the terminal formatter, `renderCoverageSection` branches on
`agg.scoped` **first**: a scoped run prints only the scoped note and
suppresses all three pass/fail verdict branches ("thresholds met",
"below thresholds", target lines) entirely, since a verdict against the
whole-project denominator is exactly what must not be trusted on a
partial run (PR #358 finding 2). Full-run output is byte-identical.
See [./plugin.md](./plugin.md) *Partial-run detection* and Decision 59 in
[../decisions.md](../decisions.md) (issue #160).

## Published JSON Schema documents

`packages/sdk/schemas/` holds the generated, committed JSON Schema
documents the package publishes — today one:
`run-report-file-1.0.0.json`, the contract for the `run.json` report file.

- **Generator.** `packages/sdk/scripts/generate-schemas.ts` builds one
  `SchemaTarget` per output and runs `@effected/schemastore`'s
  `SchemaPipeline`. `pnpm --filter @vitest-agent/sdk schemas:generate`
  writes; `schemas:check` reports drift and exits non-zero when a document
  is stale, blocked, or changed without a version bump.
- **Two targets, one source.** The same document is emitted into the sdk's
  `schemas/` directory (shipped to npm) and into
  `website/docs/public/schemas/` (what the `$id` URL resolves to once the
  docs site deploys). The website copy is a second generated target rather
  than a hand-copy, so drift between them is a test failure instead of a
  stale document served at a live URL.
- **Packaging.** `package.json` exposes `"./schemas/*.json"` in `exports`
  so a consumer can resolve the document offline, and `savvy.build.ts`
  copies the directory into every emitted package dir — the bundler's
  exports graph never sees generated assets, only source modules.
- **Drift test.** `packages/sdk/__test__/run-report-file-schema.test.ts`
  imports the targets from the generator, asserts the pipeline reports no
  warnings and nothing to write for either, pins the `$id` and the Draft-07
  `$schema`, and asserts the two committed documents are byte-equal.

See [../schemas.md](../schemas.md) *Run report file* and Decision 67 in
[../decisions.md](../decisions.md).

## Dispatch subpath

The sidecar dispatch core is exported through a dedicated narrow entry
point, `@vitest-agent/sdk/dispatch` (barrel `packages/sdk/src/dispatch.ts`).
It re-exports `dispatch` / `DispatchIo` / `DispatchResult`
(`src/sidecar-dispatch.ts` — the argv dispatcher plus its hand-rolled flag
parser), `injectEnv` / `InjectEnvInput` (`src/internal-inject-env.ts`), and
`exitCodeForTag` (`src/exit-code-for-tag.ts`). These symbols moved into the
SDK from `@vitest-agent/cli` to break a workspace dependency cycle — see
[./cli.md](./cli.md) and [./sidecar.md](./sidecar.md).

**The core is pure.** `dispatch(argv, io)` takes
`io = { cwd: string; env: Record<string, string | undefined>; readFile: (path: string) => string }`
and `injectEnv` takes `readFile` too; neither reads `process` or `node:fs`.
The four `sidecar-<platform>` bins and the CLI's `agent inject-env`
fallback pass `process.cwd()`, `process.env` and a `readFileSync` wrapper
(the reader throws on a miss; `dispatch` / `injectEnv` catch). `--cwd`
overrides `io.cwd`; the `package.json#scripts` one-hop indirection in
`match-vitest-command` goes through `io.readFile`.

**Why a dedicated entry, not the main barrel.** The four per-platform
`@vitest-agent/sidecar-<platform>` SEA binaries import `dispatch` from this
subpath, and the SEA must stay small. Importing from the `.` barrel would
force the bundler to start from the full core module graph and tree-shake
it away; the dedicated `./dispatch` entry guarantees a minimal reachable
graph from the start (`dispatch` → `injectEnv` → the pure
`match-vitest-command` helpers, plus the pure `exitCodeForTag` switch).
Since the engine split there is no data layer in this package at all, but
the entry stays for the same reason. The symbols are deliberately **not**
re-exported from the main barrel.

## CURRENT_SDK_VERSION

`packages/sdk/src/version.ts` exports `CURRENT_SDK_VERSION: string`, inlined from `process.env.__PACKAGE_VERSION__` by the bundler at build time; source-level reads see the `"0.0.0"` fallback. It is the one sanctioned `process` token in the platform-free core, confined to this file by the boundary test. Every runtime package exports the analogous `CURRENT_<PKG>_VERSION` constant from its own `src/version.ts` the same way. These are public API — a consumer can read a package's own release version — but nothing compares them across packages at runtime. The earlier lockstep design wired init-time drift checks (plugin factory, MCP bin, CLI bin) against this constant; those checks, and the version-constant test suites that backed them, were removed with the move to independent per-package versioning. See D36 in [../decisions.md](../decisions.md).
