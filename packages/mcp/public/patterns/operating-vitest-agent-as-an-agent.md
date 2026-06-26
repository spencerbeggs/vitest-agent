# Operating vitest-agent as an Agent

## When to use

Read this first when you are an agent driving a project that uses
`@vitest-agent/*`. It front-loads the handful of facts that otherwise cost
trial-and-error, then points you at the deeper patterns.

## The facts that save the most time

1. **Run tests with `run_tests`, not Bash `vitest`.** `run_tests` persists
   results, classifications, coverage, and history and fires the post-tool-use
   hooks. Shelling out to `vitest` bypasses all of that.
2. **`run_tests` has no `filter` parameter.** Scope with `project` (the Vitest
   project name), `files` (globs), or `tags`. An unknown key like `filter` is
   silently dropped, so the whole suite runs.
3. **Subset runs "fail" coverage thresholds by design.** A single-file run
   exiting with `ERROR: Coverage … does not meet global threshold` is expected
   — global thresholds applied to partial coverage. There is no per-run
   coverage toggle in `run_tests`; it inherits your `vitest.config`. For
   isolated inspection use the CLI: `vitest run <file> --coverage.enabled=false`.
4. **You cannot see stray `console.log` through `run_tests`** — it null-routes
   Vitest's stdout. Console behavior is configured via the plugin's `console`
   matrix (e.g. `console: { agent: "passthrough" }`), **not** environment
   variables. To see intercepted output, run Vitest directly with
   `--disableConsoleIntercept` (a native Vitest flag).
5. **Session attribution is recovered for you.** The SessionStart hook writes
   the `VITEST_AGENT_*` identity into the environment and the SDK recovers it —
   you never set those vars by hand. The only behavioral knobs are
   `VITEST_REPORTER_LOG_LEVEL`, `VITEST_REPORTER_LOG_FILE`, and `NO_COLOR`.
6. **Stale counts mean tests were not re-run**, not a warm cache. Discovery
   re-walks per Vitest run; the MCP serves counts from the database.
7. **Some "leaks" are guardrail tests** that assert on their own output. Do not
   silence output a test captures and `expect`s on.

## Environment, briefly

You do not configure vitest-agent through environment variables. The
`VITEST_AGENT_*` vars (chat id, conversation id, agent ids, project dir,
sidecar bin) are attribution plumbing written by the Claude Code plugin's
SessionStart hook and recovered automatically. The only vars you might set for
diagnostics are `VITEST_REPORTER_LOG_LEVEL` / `VITEST_REPORTER_LOG_FILE` (a
diagnostic log file, separate from the console reporter) and `NO_COLOR`.

## Where to go next

| You want to… | Read |
| --- | --- |
| Scope a run, read the return shape, understand coverage-in-subset | `vitest-agent://patterns/running-tests-via-mcp` |
| Silence noisy log/build output in tests | `vitest-agent://patterns/silencing-leaking-output-in-tests` |
| Tell tooling noise apart from real failures | `vitest-agent://patterns/known-issues-and-caveats` |
| Read the full console-mode matrix (human prose) | <https://vitest-agent.dev/guide/console-modes> |
| The human-facing version of this page | <https://vitest-agent.dev/guide/operating-as-an-agent> |
