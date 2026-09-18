# CLI conventions and recipes

Reference for `@vitest-agent/cli`. Load the section you need; the short
[CLAUDE.md](../CLAUDE.md) holds the overview, layout, key files and the
always-apply conventions.

## When working in this package

- This package depends on `@vitest-agent/sidecar` (not the reverse). `resolveSidecarBinaryPath` is imported from `@vitest-agent/sidecar` to back the `agent sidecar-path` subcommand. The per-platform sidecar children no longer import the CLI — they bundle `dispatch` from `@vitest-agent/sdk/dispatch`. The old `cli → sidecar → sidecar-<platform> → cli` cycle is gone.
- Adding a subcommand: create or extend the `commands/<group>.ts`
  `effect/unstable/cli` glue and wire it into the relevant parent's
  `withSubcommands` (`db`, `agent`, or the root in `main.ts`). Only add
  a `lib/format-<name>.ts` + `.test.ts` pair when the command produces
  non-trivial structured output worth testing as a pure function;
  plain-text utility commands do not need a formatter.
- `record test-case-turns --chat-id <id>` is the canonical
  pattern for subcommands that call multiple `DataStore`/`DataReader`
  methods and return JSON to stdout (not markdown). It calls
  `DataStore.backfillTestCaseTurns(chatId)` then
  `DataReader.getLatestTestCaseForSession(chatId)` and outputs
  `{ "updated": N, "latestTestCaseId": <id|null> }`. Follow this
  pattern for any subcommand that needs to both mutate and read back
  a result.
- Need a new `DataReader` query: add it to `@vitest-agent/engine`'s `DataReader`
  service, then consume it from the command body. Don't reach into
  SQLite directly from the CLI — except `db query`, which opens
  `data.db` read-only by design.
- `db reset` is human-only: it refuses with exit code 4 when
  `VITEST_AGENT_AGENT_ID` is set, exit code 5 when stdout is not a TTY
  and `--yes` was not passed, and otherwise prompts `Wipe <path>?
  [y/N]:` on a TTY. It deletes `data.db` plus its `-shm` / `-wal`
  companions and is idempotent (a missing DB is success).
- `db query <sql>` opens the connection with the SqliteClient
  read-only flag so SQLite enforces no-write; mutation attempts and
  syntax errors surface as driver errors on stderr with exit code 3.
  Empty / whitespace-only SQL exits 2. Do not add parse-time SQL
  validation — engine enforcement is the contract.
- `db path` returns the resolved XDG path even when no DB has been
  written yet -- the path is a function of identity, not artifact
  presence. The pre-2.0 `node_modules/.vite/...` probing is gone.
- Adding a flag: `effect/unstable/cli` validates types at the `Command` layer
  but the lib function should still accept a typed options object.
  Keep the lib function callable without `effect/unstable/cli` for testing.
- Per-call layer construction is fine here (CLI is short-lived); only
  MCP uses `ManagedRuntime`.
