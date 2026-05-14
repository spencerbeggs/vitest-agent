# vitest-agent-sdk

The no-internal-deps base package. Owns the data layer, schemas, errors,
migrations, services, layers, formatters, the XDG path-resolution stack,
the process-level migration coordinator, the public reporter contract types,
the `RunEvent` / `RenderState` schemas consumed by `vitest-agent-ui`, and
the shared `lib/` markdown generators. The plugin, reporter, CLI, MCP, and
UI packages all depend on this package; changes to its public exports
ripple to all five runtimes.

## Layout

```text
src/
  index.ts            -- public re-exports (only entry point)
  contracts/          -- public reporter contract types
  services/           -- 14 Effect Context.Tag definitions
  layers/             -- live + test layer implementations
  schemas/            -- Effect Schema definitions
    RunEvent.ts       -- discriminated union of streaming run events
                         consumed by `vitest-agent-ui`'s reducer
    RenderState.ts    -- denormalized projection of a RunEvent stream;
                         the shape both renderers consume
    turns/            -- TurnPayload discriminated union (7 variants)
  errors/             -- tagged errors (DataStore, Discovery, Tdd, ...)
  formatters/         -- markdown, gfm, json, silent, ci-annotations
  migrations/         -- 0001_initial (canonical pre-2.0 schema; the
                         former 0002_comprehensive was folded in),
                         registry_0001_initial, session_map_0001_initial
                         (see Key files)
  sql/                -- row types + DB-to-domain assemblers
  utils/              -- pure utilities (paths, signatures, validators)
  lib/                -- pure markdown generators (CLI + MCP)
  testing/            -- exported via `vitest-agent-sdk/testing` subpath
```

## Key files

| File | Purpose |
| ---- | ------- |
| `contracts/reporter.ts` | Public reporter contract types: `ResolvedReporterConfig`, `ReporterKit`, `ReporterRenderInput`, `VitestAgentReporter`, `VitestAgentReporterFactory` |
| `services/DataStore.ts` + `layers/DataStoreLive.ts` | All SQLite writes. Defines all write-input types plus `backfillTestCaseTurns(chatId)` and the 2.0 goal/behavior CRUD methods |
| `services/DataReader.ts` + `layers/DataReaderLive.ts` | All SQLite reads; assembles domain types via `sql/assemblers.ts`. Provides `getSessionById`, `searchTurns`, `computeAcceptanceMetrics`, `getLatestTestCaseForSession`, and the 2.0 goal/behavior read methods |
| `utils/resolve-data-path.ts` | Deterministic XDG-derived `dbPath` orchestrator (Decision 31) |
| `utils/ensure-migrated.ts` | Process-level migration coordinator using a `globalThis`-keyed promise cache (Decision 28). Registers `0001_initial` only on the main `data.db`; the registry and session-map DBs use their own single-file migrations |
| `layers/PathResolutionLive.ts` | Composite: `XdgLive` + `ConfigLive` + `WorkspacesLive` |
| `migrations/0001_initial.ts` | Canonical pre-2.0 schema. Pre-2.0 policy is "edit this file directly when the shape changes and delete `data.db`"; the former `0002_comprehensive` was folded in. Post-2.0 ships ALTER-only migrations (Decision D9) |
| `utils/function-boundary.ts` | `findFunctionBoundary(source, line)` parses via `acorn` (extended with `acorn-typescript`) and returns the smallest enclosing function's start line + name |
| `utils/failure-signature.ts` | `computeFailureSignature` produces a 16-char sha256 from `error_name`, normalized assertion shape, top-frame function name, and function-boundary line. See Decision D10 |
| `utils/validate-phase-transition.ts` | Pure validator for TDD phase transitions; returns acceptance or a typed `DenialReason` + remediation. See Decision D11 |
| `lib/format-triage.ts` | Pure markdown generator powering both `triage_brief` MCP tool and `triage` CLI subcommand |
| `lib/format-wrapup.ts` | Pure markdown generator for wrap-up nudges; five `kind` variants. Powers `wrapup_prompt` MCP tool and `wrapup` CLI subcommand |
| `testing/layers.ts` | `makeTestLayer(filename)` and the `DataStoreTestLayer` `:memory:` convenience — exported via the `vitest-agent-sdk/testing` subpath |
| `testing/index.ts` | Five preset factories (`empty`, `singlePassingRun`, `withFailures`, `flaky`, `withTddTask`) that seed representative DB states for use in tests |

## Conventions

- **No internal deps.** Never import from `vitest-agent-plugin`,
  `vitest-agent-reporter`, `vitest-agent-cli`, `vitest-agent-mcp`, or
  `vitest-agent-ui`. Keeps the dependency graph acyclic by construction.
- **Public-API-by-default.** Anything exported from `index.ts` is part
  of the contract used by all five runtime packages. Adding or removing
  exports needs to be considered against all five consumers.
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
- **Test helpers are in `testing/`, exported via `vitest-agent-sdk/testing`.**
  Use `makeTestLayer(":memory:")` (or the `DataStoreTestLayer` shorthand)
  in unit tests; use the preset factories when you need a pre-seeded DB state.
  Tests live in `packages/sdk/__test__/` (flat directory).
- **`CoverageLevel` schema** (`schemas/CoverageLevel.ts`) defines the five
  named presets (`none`, `basic`, `standard`, `strict`, `full`), the
  `.withPerFile()` builder, `.extend({})` override, and `resolveCoverageInput`
  / `validateCoverageConfig` helpers. `validateCoverageConfig` is no longer
  called by the plugin (Phase 4 of the T4 coverage-policy work removed the
  read path in favor of the `ConfigValidation` service); the helper is
  slated for removal in T7.1.
- **Typed `coverageTargets`** (`schemas/Options.ts`) defines `CoverageTargets`
  as a `Schema.Record` with `Schema.Positive`, the `100: true` shortcut, and
  nested `CoverageTargetsMetrics` glob entries. Negatives and zeros are
  rejected at decode time. The pure helper `validateCoverageTargetsShape`
  in `utils/` emits structured diagnostics (`INVALID_TARGET_VALUE`,
  `PERFILE_ON_TARGETS`) with pinpointed `path` strings; the plugin's
  `ConfigValidation` rule registry calls into it.

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
- Adding/changing migrations: pre-2.0, edit `0001_initial.ts` in place
  and delete the local `data.db` between turns. Post-2.0 ships
  ALTER-only migrations (Decision D9). SQLite uses WAL +
  `busy_timeout`; multi-project test runs share one DB. Verify against
  `ensureMigrated.test.ts`.
- Renaming a public export: search all five runtime packages
  (`packages/plugin`, `packages/reporter`, `packages/cli`,
  `packages/mcp`, `packages/ui`) before committing.
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

- `@./.claude/design/vitest-agent/components/sdk.md`
  Load when working on this package's services, layers, formatters,
  utilities, or migrations.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when adding or changing Effect Schemas, the reporter contract types,
  or SQLite tables.
- `@./.claude/design/vitest-agent/file-structure.md`
  Load when touching `resolveDataPath`, `PathResolutionLive`, workspace-key
  normalization, or the project-keying / tag-classification model that
  replaced `splitProject()` in 2.0.
- `@./.claude/design/vitest-agent/decisions.md`
  Load when you need rationale for a design choice (especially D9 migration
  policy, D10 failure signatures, D11 phase transitions, D28
  `ensureMigrated`, D31 path resolution).
- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests for this package or reviewing testing patterns.
- `@./.claude/design/vitest-agent/components/discover.md`
  Load when adding new preset factories to `testing/` or changing
  `makeTestLayer`.

## Agent-agnostic taxonomy additions (Phases 1–4)

The 0001_initial migration is now consolidated (the prior 0002 was
folded in) and adds the `agents` table, `actor_type` / `agent_id` /
`conversation_id` columns on action tables (`test_runs`,
`hypotheses`, `notes`, `tdd_phases`), per-run git context columns
(`git_branch`, `git_commit_sha`, `git_dirty`, `git_upstream`,
`git_worktree_dir`), and host-metadata columns (`host_source`,
`host_value`, `host_metadata`) on `test_runs`. Six AFTER UPDATE
triggers lock `conversation_id` immutable on every table that
carries it.

| New file | Purpose |
| -------- | ------- |
| `schemas/Identity.ts` | UUID-branded `AgentId`, `ConversationId`, `SessionId`, `TddTaskId`; string-branded `ProjectKey`; literal unions `ActorType`, `HostKind`. Built on `Schema.UUID` so `JSONSchema.make` emits `format: "uuid"` reliably |
| `schemas/Agent.ts` | `Agent` Schema.TaggedClass + `IdempotencyHit` Data.TaggedClass for the `RegisterAgentResult` success-channel union |
| `services/idempotency.ts` | `deriveIdempotencyKey` shared between sidecar CLI and MCP server; SHA-256 over (agentType, parentAgentId or sentinel, clientNonce), base32 26-char output. Frozen vector test guards drift |
| `services/ProjectIdentity.ts` + `layers/ProjectIdentityLive.ts` | 5-source fallback resolver (explicit option → TOML → git remote → package.json#repository.url → normalized name). `resolveProjectIdentityFromCandidates` is the pure priority resolver; the Live layer wires `Command`/`FileSystem`/`WorkspaceDiscovery`/`VitestAgentConfigFile` |
| `services/RunContext.ts` + `layers/RunContextLive.ts` | `captureRunContext(cwd)` (git branch/sha/dirty/upstream/worktree + host metadata) and `captureAgentContext(cwd)` (the inheritable subset for agent registration) |
| `services/PerClientSessionMap.ts` + `layers/PerClientSessionMapLive.ts` | Reader / Writer split. The MCP server provides only the Reader (read-only `?mode=ro` SQLite); the sidecar provides the Writer which also satisfies the Reader tag |
| `services/DiscoveryRegistry.ts` + `layers/DiscoveryRegistryLive.ts` | Global `known_projects` index at `$XDG_DATA_HOME/vitest-agent/registry.db`. Used by `mcp-app` and any future cross-project tooling |
| `migrations/registry_0001_initial.ts` | STRICT `known_projects` schema with WAL plus busy_timeout |
| `migrations/session_map_0001_initial.ts` | STRICT `conversation_map` and `session_map` schemas with the partial active-session index |
| `utils/canonicalize-git-url.ts` | Pure SSH/HTTPS/git+ssh URL canonicalizer; the `gitUrlToProjectKey` helper maps to the filesystem-safe `host__path` form |
| `utils/probe-host-metadata.ts` | 9-tier probe chain (TMUX_PANE → WT_SESSION → … → CI runners). First match wins. Pure (env map in, result out) |
| `utils/match-vitest-command.ts` | Pattern matchers for the five Vitest invocation shapes plus `buildEnvPrefix` and `rewriteBashCommand`. Used by the sidecar's `_internal inject-env` |

`DataStore` gains `registerAgent(input): Effect<Agent | IdempotencyHit, RegistrationConflictError | DataStoreError>`
and `endAgent(agentId, endedAt): Effect<void, AgentNotFoundError | DataStoreError>`.
`TestRunInput` gains optional `actorType`, `agentId`, `conversationId`,
`gitBranch`, `gitCommitSha`, `gitDirty`, `gitUpstream`,
`gitWorktreeDir`, `hostSource`, `hostValue`, `hostMetadata` fields the
reporter populates before each `writeRun`.
