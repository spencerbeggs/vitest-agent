# @vitest-agent/cli

The `effect/cli`-based bin `vitest-agent` (no `-cli` suffix): utility-only
since 2.0 — `doctor`, `db` (`path` / `prune` / `reset` / `query`), and the
`agent` namespace for hook-driven plumbing (`triage`, `wrapup`, `record`,
`register-agent`, `end-agent`, `inject-env`, `sidecar-path`,
`check-test-path`). Test-landscape queries live in the MCP server. It never
runs tests or calls AI providers. Rank 4: depends on `@vitest-agent/engine`,
`@vitest-agent/sdk`, and `@vitest-agent/sidecar`; never on
`@vitest-agent/mcp`. The plugin carrier re-ships the bin as a shim over
`@vitest-agent/cli/main`.

This file orients; the design knowledge lives in the bundle. Load
[`okf/modules/cli.md`](../../okf/modules/cli.md) before changing anything
below `src/`.

## Layout

```text
src/
  bin.ts             -- shebang shim: import { main } from "./main.js"; main();
  main.ts            -- owns the process; published at `./main`; CliRuntime.main
                        over CliAudience.run(rootCommand) with a root platform
                        that opens NO database
  index.ts           -- side-effect-free barrel: exports only CURRENT_CLI_VERSION
  version.ts         -- CURRENT_CLI_VERSION (the one process.env.__PACKAGE_VERSION__ read)
  commands/          -- thin effect/cli Command wrappers; the only non-entry
                        files allowed to read `process`
    doctor.ts db.ts agent.ts record.ts triage.ts wrapup.ts
  layers/project-data.ts -- ProjectDir service + ProjectDataLive (the engine's
                        PlatformLive, built lazily per command)
  lib/               -- pure formatters and renderers; tests live here
    format-doctor.ts format-db-query.ts version-formatter.ts render-failure.ts
```

The entry contract (`bin.ts` / `main.ts` / `index.ts` / `version.ts`) is
[Convention: front-end entry
contract](../../okf/conventions/front-end-entry-contract.md). The hook
programs (`registerAgentEffect`, `endAgentEffect`, `record*`,
`resolveHookPaths`) live in `@vitest-agent/engine`'s `programs/`;
`dispatch` / `injectEnv` / `exitCodeForTag` ship from
`@vitest-agent/sdk/dispatch`. Commands pass `process.env` / `process.cwd()`
into them.

## Must-know rules

- **Keep the root platform inside `CliRuntime.main`'s `platform` and the
  database on `Command.provide(ProjectDataLive)`**, attached only to
  `doctor`, `db prune`, `agent triage` / `wrapup` / `record`. `db path` /
  `reset` / `query` and the hook hot-path commands open no project database.
  Do not swap the entry to `Effect.runPromise`.
- **Exit codes and failure rendering are the kit's**: `0` success, `64`
  usage error (help and parse errors on stderr, stdout empty — hooks pipe
  `agent *` stdout into `jq`), `130` cancelled prompt, `1` any other
  reported failure. The sidecar family and `db` carry their own documented
  taxonomies; codes go through `CliExit.set`, not `process.exit`.
- **`--format` is scoped, not universal**: `agent triage` / `agent wrapup`
  (`markdown|json|silent`), `db query` (`table|json`), `doctor`
  (`markdown|json`). Nothing else gets one without a design decision.
- **Read-only by default.** The CLI reads through `DataReader`; a new query
  belongs in the engine's `DataReader`, never in SQLite reached from here —
  except `db query`, which is read-only by design. Mutations belong to the
  reporter, the MCP server, or the `agent` namespace's recording path.
- **`db reset` is human-only**: exit 4 under `VITEST_AGENT_AGENT_ID`, exit 5
  when not interactive without `--yes`, otherwise a `Prompt.Confirm`.
- **Boundary**: `process` only in `main.ts` and `commands/**`; `lib/` stays
  pure (thread `env` / `cwd` in); nothing under `src/` imports
  `@vitest-agent/mcp`, `plugin`, `reporter`, or `ui`
  (`__test__/boundaries.test.ts`).
- **Tests live next to `lib/` functions, not commands.** Add a
  `lib/format-<name>.ts` + `.test.ts` pair only for non-trivial structured
  output; keep the lib function callable with a typed options object,
  without `effect/cli`.
- **Agent-facing id flags** are `--chat-id` / `--parent-chat-id` /
  `--tdd-task-id` (`record`) and `--chat-id` / `--row-id` (`wrapup`).

## Design references

- [`okf/modules/cli.md`](../../okf/modules/cli.md) — entry contract,
  `db` group, the `agent` namespace, the `record` subcommand pattern
  (including `test-case-turns` as the mutate-and-read pattern), platform
  layers, working conventions.
- [`okf/interfaces/cli.md`](../../okf/interfaces/cli.md) — the stable
  command/flag/exit-code and stdout contract from the hook consumer's side.
- [`okf/decisions/72-adopt-the-effected-front-end-kit.md`](../../okf/decisions/72-adopt-the-effected-front-end-kit.md)
  — why `main.ts` runs on `@effected/cli`'s `CliRuntime.main`.
- [`okf/decisions/61-fail-open-on-non-default-discovery-via-lexical-config-detection.md`](../../okf/decisions/61-fail-open-on-non-default-discovery-via-lexical-config-detection.md)
  — why `check-test-path` exits 1 with no verdict rather than denying.
- [`okf/limitations/spawn-sync-e2e-gap.md`](../../okf/limitations/spawn-sync-e2e-gap.md)
  — the `agent record session-start/turn/session-end` path has no spawned
  e2e.
- [`okf/gotchas/effect-provide-inherits-memo-map.md`](../../okf/gotchas/effect-provide-inherits-memo-map.md)
  — read before providing a layer inside a command handler (why
  `register-agent` / `end-agent` use `Effect.provide(..., { local: true })`).
- [`okf/models/sqlite-schema.md`](../../okf/models/sqlite-schema.md) — for a
  new `DataReader` query or formatter types.
