# CLI Commands

The `vitest-agent` CLI queries the SQLite database for on-demand
test landscape queries. It does not run tests or call AI providers.

All commands accept `--format` to switch between `markdown` (default) and
`json` output. The `show` subcommand exposes the additional `auto`, `agent`,
and `human` values for the event-sourced renderer.

## cache

Manage the reporter database.

### cache path

Print the resolved database file path and exit.

```bash
npx vitest-agent cache path
```

Useful for scripting or verifying which database the CLI resolves to.

### cache clean

Delete the SQLite database file.

```bash
npx vitest-agent cache clean
```

Removes all persisted test data, history, baselines, trends, and notes.
Run tests again to regenerate.

## doctor

Diagnose database health. Runs a series of checks and reports pass/fail
for each:

```bash
npx vitest-agent doctor
```

Checks performed:

- **Database found** -- can the database file be resolved?
- **Manifest valid** -- is the manifest data present and consistent?
- **Reports** -- do all referenced project runs have valid data?
- **History** -- is history data present and consistent?
- **Last run** -- is the data stale (older than 24 hours)?

Exits with code 1 if any check fails. When issues are found, suggests
running `vitest-agent cache clean` and re-running tests.

## status

Show per-project pass/fail state from the most recent test run.

```bash
npx vitest-agent status
```

Output includes a summary table with project names, last run timestamps,
results, and test counts. Failing projects show additional detail with
failure counts and affected files.

## overview

Test landscape summary with per-project run metrics.

```bash
npx vitest-agent overview
```

Shows the full test landscape with file-to-test mapping and project
discovery. Useful for agents exploring an unfamiliar codebase.

## coverage

Coverage gap analysis from the database.

```bash
npx vitest-agent coverage
```

Reads the coverage threshold from each project's stored data. Shows
files below threshold sorted by worst metric, with uncovered line ranges.

## history

Failure trend analysis across runs.

```bash
npx vitest-agent history
```

Queries per-project history data and groups tests by classification:

- **Flaky tests** -- mixed pass/fail across recent runs, sorted by fail
  rate. Shows a P/F visualization (e.g., `PPFPPFPPFP`) with oldest
  runs on the left
- **Persistent failures** -- consecutive failures from the most recent
  run backward. Shows how many consecutive runs have failed
- **Recently recovered** -- tests that are now passing but had failures
  in the recent window

Stable tests and new failures (first-time) are omitted since they have
no interesting history to display.

The history command is most useful when the console output hints at
flaky or persistent failures. The console "Next steps" section includes
a pointer to run this command when classifications are present.

## show

Replay the latest cached run for a project through the shared event-sourced
renderer in `vitest-agent-ui`.

```bash
npx vitest-agent show --project <name> --format auto|agent|human|json
```

`show` pulls the latest run from SQLite via `DataReader.getLatestRun`,
synthesizes the event stream with `synthesizeFromAgentReport`, and dispatches
through `renderRun`:

- `--format auto` (default) — picks the React Ink view (`human`) when stdout
  is a TTY, otherwise falls back to the markdown-flavored agent string.
- `--format human` — forces the React Ink view.
- `--format agent` — forces the markdown-flavored agent string.
- `--format json` — emits the raw `AgentReport`.

This is the same renderer the plugin drives live during a run when
`console.human === "ink"`, so a captured run replays byte-identically to
what the live view showed.

## trends

Coverage trend analysis across runs.

```bash
npx vitest-agent trends
```

Queries per-project trend data and displays:

- **Direction** -- whether coverage is improving, regressing, or stable
  over recent runs
- **Metrics table** -- current value, 5-run average, and (if targets are
  configured) the target value and gap for each metric
- **Recent trajectory** -- line coverage values over the last 10 runs,
  showing the progression

Trend data is recorded automatically on each full test run and stored in
the SQLite database with a 50-entry sliding window.

The trends command is most useful when you want to verify whether a
coverage change is a one-time dip or part of a pattern. The console
output includes a pointer to this command when trend data is available.
