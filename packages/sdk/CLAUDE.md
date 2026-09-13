# @vitest-agent/sdk

The platform-free core of the family (rank 1 — no workspace deps, and
`effect` + `acorn` / `acorn-typescript` are its only runtime deps). Owns the
Effect Schemas, the public reporter + dispatcher contract types, the tagged
errors, the pure formatters and utilities, the pure sidecar `./dispatch`
entry, and the published `./schemas/*.json` (`RUN_REPORT_FILE_SCHEMA_URL` —
deploy the website schema URL before publishing). Everything that touches a
filesystem, a process, SQLite or `@effected/*` — services, Live layers,
migrations, `resolveDataPath`, `ensureMigrated`, `PathResolutionLive`,
`computeFailureSignature`, `lib/format-*`, and the `./testing` subpath — moved
to `@vitest-agent/engine` (issue #412). Every other family package depends on
this one; a public-export change ripples to all of them.

Entry points: `.` (`src/index.ts`), `./dispatch` (`src/dispatch.ts`),
`./schemas/*.json`. There is no `./testing` here any more — use
`@vitest-agent/engine/testing`.

## Layout

```text
src/
  index.ts            -- main barrel (contracts, schemas, errors,
                         formatters, utils, CURRENT_SDK_VERSION)
  version.ts          -- CURRENT_SDK_VERSION: the ONE sanctioned
                         process.env.__PACKAGE_VERSION__ read
  dispatch.ts         -- the `./dispatch` barrel: dispatch / DispatchIo /
                         DispatchResult, injectEnv / InjectEnvInput,
                         exitCodeForTag. Minimal reachable graph for the
                         sidecar SEA bundler -- no Effect, no data layer
  sidecar-dispatch.ts -- dispatch(argv, io) with io = { cwd, env, readFile }
  internal-inject-env.ts -- injectEnv({ ..., readFile }); reads
                         `${cwd}/package.json` through the injected readFile
  exit-code-for-tag.ts   -- error-tag -> exit code map for the sidecar bins
  contracts/          -- reporter.ts (ResolvedReporterConfig, ReporterKit,
                         VitestAgentReporter(Factory)); dispatcher.ts
                         (RunShape, RunOutcome, DispatchInputs, CellOptions)
  schemas/            -- Effect Schema definitions (AgentReport, Coverage*,
                         Identity, Agent, Tdd, TestArtifacts, RunEvent,
                         RenderState, Options, Transport, turns/, ...)
  errors/             -- Data.TaggedError families (DataStore, Discovery,
                         PathResolution, ProjectIdentity, RunContext, Tdd, Agent)
  formatters/         -- terminal, markdown, gfm, json, silent,
                         ci-annotations; FormatterContext (types.ts) carries a
                         required `cwd`
  utils/              -- pure helpers: posix-path.ts (toPosix, basenamePosix,
                         joinPosix, relativePosix), test-location.ts,
                         format-console.ts (relativePath(filePath, cwd)),
                         build-report.ts, validate-phase-transition.ts,
                         function-boundary.ts, console-leaks.ts,
                         match-vitest-command.ts, probe-host-metadata.ts,
                         canonicalize-git-url.ts, normalize-workspace-key.ts,
                         detect-pm.ts, coerce-error-text.ts, ...
schemas/              -- generated JSON Schemas (`pnpm --filter
                         @vitest-agent/sdk schemas:check`)
```

## Boundary (enforced by `__test__/boundaries.test.ts`)

- No `node:*`, `@effect/platform-node`, `@effect/sql-sqlite-node`, or
  `@effected/*` import anywhere under `src/`.
- No `process.` reference anywhere under `src/`; the build-time token
  `process.env.__PACKAGE_VERSION__` may appear only in `version.ts`.
- Paths are handled with the `posix-path.ts` helpers, never `node:path`;
  anything that needs a cwd takes it as a parameter (`FormatterContext.cwd`,
  `relativePath(filePath, cwd)`, `DispatchIo.cwd`). Windows callers get
  forward-slash output from `classifyTestPath`'s `suggestedPath`.
- **No internal deps.** Never import `@vitest-agent/engine`, `plugin`,
  `reporter`, `cli`, `mcp`, or `ui`.

## Key files

| File | Purpose |
| ---- | ------- |
| `contracts/reporter.ts` | Public reporter contract: `ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `VitestAgentReporter`, `VitestAgentReporterFactory` |
| `contracts/dispatcher.ts` | Public dispatcher contract consumed by `@vitest-agent/ui`'s matrix and `DefaultVitestAgentReporter` |
| `sidecar-dispatch.ts` | `dispatch(argv, io)` — pure; the four `sidecar-*` bins and the CLI's `agent inject-env` fallback pass `{ cwd: process.cwd(), env: process.env, readFile: readFileSync wrapper }`. `--cwd` falls back to `io.cwd` |
| `utils/test-location.ts` | Single source of truth for the test-layout rule: `SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `NON_DISCOVERABLE_DIRS`, `isTestFileName`, `findOwningWorkspace`, `classifyTestPath(workspaces, filePath)` (`valid` / `excluded` / `invalid`, or `null` = no verdict, fail open; issue #251). Consumed by the plugin's discovery globs and walkers, engine's `ProjectDiscoveryLive`, and `vitest-agent agent check-test-path` |
| `utils/validate-phase-transition.ts` | Pure TDD phase-transition validator returning acceptance or a typed `DenialReason` + remediation (Decision D11). No I/O, no Effect |
| `utils/build-report.ts` | `buildAgentReport(...)`; fails a module on its own `failed` state, a failed suite, or suite/hook errors; sets `summary.modules` |
| `utils/coerce-error-text.ts` | `coerceErrorText` / `coerceErrorField` — exception-safe reads of raw Vitest error fields (a getter may throw) |
| `utils/function-boundary.ts` | `findFunctionBoundary(source, line)` via `acorn` + `acorn-typescript`; hash input for engine's `computeFailureSignature` (Decision D10 — format is versioned) |
| `schemas/CoverageLevel.ts`, `schemas/CoverageTargets.ts` | Five named presets + `.withPerFile()` / `.extend({})`; `CoverageTargets` record schema (`Schema.Positive`, `100: true` shortcut) with `validateCoverageTargetsShape` diagnostics |
| `schemas/Options.ts`, `schemas/Transport.ts` | Slim `AgentPluginOptions` (`console`, `coverageTargets`, `transport`); `Transport` is a single-member discriminated union (`{ kind: "local" }`) so cloud backends land as added members (D40) |
| `schemas/Identity.ts`, `schemas/Agent.ts` | UUID-branded `AgentId` / `ConversationId` / `SessionId` / `TddTaskId`, `ProjectKey`, `ActorType`, `HostKind`; `Agent` + `IdempotencyHit` |
| `schemas/turns/` | `TurnPayload` discriminated union (7 variants); a new variant also needs an engine migration extending the `turns.type` CHECK |

## Conventions

- **Effect Schema is the source of truth** for every data structure; the
  MCP server generates its served JSON Schema from these (no zod anywhere).
- **Errors use `Data.TaggedError`** with derived `[operation table-or-path]
  reason` messages; `extractSqlReason(e)` in `errors/DataStoreError.ts` is
  what engine layers call in `mapError`.
- **Public-API-by-default.** Anything exported from `index.ts` is contract
  for every other package; renaming one is a major. Search all consumers
  (`packages/{engine,plugin,reporter,cli,mcp,ui,sidecar-*}`) first.
- **`./dispatch` stays Effect-free and data-layer-free** so the SEA bundle
  stays small; its symbols never ship from the main barrel.
- Tests live in `packages/sdk/__test__/` (flat) and need no filesystem —
  inject `readFile` maps / explicit `cwd` strings instead.

## Design references

- `@./.claude/design/vitest-agent/components/sdk.md`
  Load when working on schemas, contracts, formatters, or utilities.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding or changing Effect Schemas or the reporter contract types.
- `@./.claude/design/vitest-agent/decisions.md`
  Load for D40 (options surface / `transport`), D10 (failure signatures),
  D11 (phase transitions).
- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests for this package.
