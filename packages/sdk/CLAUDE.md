# vitest-agent-sdk

The no-internal-deps base package. Owns the data layer, schemas, errors,
migrations, services, layers, formatters, the XDG path-resolution stack,
the process-level migration coordinator, the public reporter contract types,
and the shared `lib/` markdown generators. The plugin, reporter, CLI, and
MCP packages all depend on this package; changes to its public exports
ripple to all four runtimes.

## Layout

```text
src/
  index.ts            -- public re-exports (only entry point)
  contracts/          -- reporter.ts: public reporter contract types
                         (ResolvedReporterConfig, ReporterKit,
                         ReporterRenderInput, VitestAgentReporter,
                         VitestAgentReporterFactory)
  services/           -- 10 Effect Context.Tag definitions
  layers/             -- live + test layers, OutputPipelineLive,
                         ConfigLive, PathResolutionLive, LoggerLive
  schemas/            -- Effect Schema definitions (Common, AgentReport,
                         Coverage, Thresholds, Baselines, Trends,
                         History, Options, Config, CacheManifest,
                         Tdd (GoalRow/BehaviorRow/GoalDetail/BehaviorDetail),
                         ChannelEvent (13-variant discriminated union))
    turns/            -- discriminated TurnPayload union over seven
                         payload Schema.Structs (UserPrompt, ToolCall,
                         ToolResult, FileEdit, HookFire, Note, Hypothesis)
  errors/             -- DataStoreError, DiscoveryError, PathResolutionError,
                         TddErrors (GoalNotFoundError, BehaviorNotFoundError,
                         TddSessionNotFoundError, TddSessionAlreadyEndedError,
                         IllegalStatusTransitionError)
  formatters/         -- markdown, gfm, json, silent, ci-annotations + types
  migrations/         -- 0001_initial.ts (1.x 25-table schema),
                         0002_comprehensive.ts (drop-and-recreate -- 41 tables
                         + corrected notes_fts triggers; the LAST
                         drop-and-recreate per Decision D9; modified
                         in-place to fold all 2.0 additive changes including
                         goal/behavior hierarchy, idempotent responses table,
                         test_cases/failure_signatures ALTERs, and
                         tdd_sessions.run_id)
  sql/                -- rows.ts (row types), assemblers.ts (DB -> domain)
  utils/              -- pure utilities: resolve-data-path,
                         resolve-workspace-key, normalize-workspace-key,
                         ensure-migrated, classify-test, compute-trend,
                         build-report, detect-pm, split-project, hyperlink,
                         function-boundary (acorn AST walk),
                         failure-signature (sha256 hash for stable failure
                         identity), validate-phase-transition (TDD D2
                         evidence-binding rules)
  lib/                -- pure markdown generators shared by CLI and MCP:
                         format-triage.ts, format-wrapup.ts
```

## Key files

| File | Purpose |
| ---- | ------- |
| `contracts/reporter.ts` | Public reporter contract types: `ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `VitestAgentReporter`, `VitestAgentReporterFactory` |
| `services/DataStore.ts` + `layers/DataStoreLive.ts` | All SQLite writes. Defines all write-input types plus `backfillTestCaseTurns(ccSessionId)` and the 2.0 goal/behavior CRUD methods |
| `services/DataReader.ts` + `layers/DataReaderLive.ts` | All SQLite reads; assembles domain types via `sql/assemblers.ts`. Provides `getSessionById`, `searchTurns`, `computeAcceptanceMetrics`, `getLatestTestCaseForSession`, and the 2.0 goal/behavior read methods |
| `utils/resolve-data-path.ts` | Deterministic XDG-derived `dbPath` orchestrator (Decision 31) |
| `utils/ensure-migrated.ts` | Process-level migration coordinator using a `globalThis`-keyed promise cache (Decision 28). Registers 0001 and 0002 only |
| `layers/PathResolutionLive.ts` | Composite: `XdgLive` + `ConfigLive` + `WorkspacesLive` |
| `migrations/0002_comprehensive.ts` | Drop-and-recreate migration. 41 tables + `notes_fts`. Per Decision D9, this is the **last** drop-and-recreate; future migrations are ALTER-only |
| `utils/function-boundary.ts` | `findFunctionBoundary(source, line)` parses via `acorn` (extended with `acorn-typescript`) and returns the smallest enclosing function's start line + name |
| `utils/failure-signature.ts` | `computeFailureSignature` produces a 16-char sha256 from `error_name`, normalized assertion shape, top-frame function name, and function-boundary line. See Decision D10 |
| `utils/validate-phase-transition.ts` | Pure validator for TDD phase transitions; returns acceptance or a typed `DenialReason` + remediation. See Decision D11 |
| `lib/format-triage.ts` | Pure markdown generator powering both `triage_brief` MCP tool and `triage` CLI subcommand |
| `lib/format-wrapup.ts` | Pure markdown generator for wrap-up nudges; five `kind` variants. Powers `wrapup_prompt` MCP tool and `wrapup` CLI subcommand |

## Conventions

- **No internal deps.** Never import from `vitest-agent-plugin`,
  `vitest-agent-reporter`, `vitest-agent-cli`, or `vitest-agent-mcp`.
  Keeps the dependency graph acyclic by construction.
- **Public-API-by-default.** Anything exported from `index.ts` is part
  of the contract used by all four runtime packages. Adding or removing
  exports needs to be considered against all four consumers.
- **Three external Effect-ecosystem deps unique to this package:**
  `xdg-effect`, `config-file-effect`, `workspaces-effect`. Don't add
  these to the runtime packages; consume the resolved layers/services
  from here instead. Also unique here: `acorn ^8.16.0` and
  `acorn-typescript ^1.4.13` for `function-boundary.ts`'s AST walk.
- **Effect Schema is the source of truth** for data structures. Zod
  belongs only in the MCP package (for tRPC tool input validation).
- **Errors use `Data.TaggedError`** with derived `[operation
  table-or-path] reason` messages set via `Object.defineProperty`,
  and use `extractSqlReason(e)` from `errors/DataStoreError.ts` for
  the `reason` field on every SQL `mapError`.
- **Test layers live next to live layers** (`*Live.ts` / `*Test.ts`)
  so consumers can import either side via the same package entry.

## When working in this package

- Adding a new `DataStore`/`DataReader` method: update both the service
  tag and the live layer, add `Effect.logDebug`, use
  `extractSqlReason(e)` in `mapError`, and consider whether MCP/CLI
  consumers will want it.
- Touching `resolveDataPath`/`PathResolutionLive`: callers still need
  `NodeContext.layer` (or `NodeFileSystem.layer`); don't bake it into
  `PathResolutionLive` itself.
- Touching `ensureMigrated`: the `globalThis`-keyed cache is intentional
  (Vite can load this module twice in one process for multi-project
  Vitest configs). Don't switch to a module-local Map. See Decision 28
  and Decision 32.
- Adding/changing migrations: use ALTER-only after `0002_comprehensive`
  (Decision D9). SQLite uses WAL + `busy_timeout`; multi-project test
  runs share one DB. Verify against `ensureMigrated.test.ts`.
- Renaming a public export: search all four runtime packages
  (`packages/plugin`, `packages/reporter`, `packages/cli`,
  `packages/mcp`) before committing.
- Adding a new turn payload type: add the `Schema.Struct` to
  `schemas/turns/`, extend the `TurnPayload` discriminated union in
  `schemas/turns/index.ts`, AND add the new `type` literal to the
  `turns.type` CHECK constraint via a new ALTER-only migration.
- Touching `failure-signature.ts` or `function-boundary.ts`: signature
  stability is the contract — changing the hash inputs invalidates every
  existing `failure_signatures` row. Treat the format as versioned.
  See Decision D10.
- Touching `validate-phase-transition.ts`: keep it pure (no I/O, no
  Effect). Adding a binding rule means a new branch and a new
  `DenialReason` literal. See Decision D11.
- Adding to `lib/`: generators must stay pure (E = never). They are
  consumed by both a CLI subcommand and an MCP tool — keep the
  generators free of service requirements so both surfaces can call
  them directly.

## Design references

- `.claude/design/vitest-agent/components/sdk.md`
  Load when working on this package's services, layers, formatters,
  utilities, or migrations.
- `.claude/design/vitest-agent/schemas.md`
  Load when adding or changing Effect Schemas, the reporter contract types,
  or SQLite tables.
- `.claude/design/vitest-agent/file-structure.md`
  Load when touching `resolveDataPath`, `PathResolutionLive`, workspace-key
  normalization, or `splitProject()`.
- `.claude/design/vitest-agent/decisions.md`
  Load when you need rationale for a design choice (especially D9 migration
  policy, D10 failure signatures, D11 phase transitions, D28
  `ensureMigrated`, D31 path resolution).
