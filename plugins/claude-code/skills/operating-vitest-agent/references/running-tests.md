# Running Tests via the MCP `run_tests` Tool

## When to use

You want to execute the Vitest suite (or a subset) from an agent. Always prefer `run_tests` over shelling out to `vitest` — it persists results, classifications, coverage, and history to the project database and drives the post-tool-use hooks. Re-running `vitest` over Bash bypasses all of that.

## Scoping a run — there is no `filter` parameter

`run_tests` accepts exactly these inputs:

| Field | Type | Default | Scopes by |
| --- | --- | --- | --- |
| `files` | `string[]` | `[]` | Vitest file patterns: exact paths or globs |
| `project` | `string` | unset | The Vitest **project name** from your config |
| `tags` | `{ all?: string[]; any?: string[]; none?: string[] }` | unset | Vitest tag expression |
| `passWithNoTests` | `boolean` | config value | Per-call override of `test.passWithNoTests` |
| `timeout` | `number` (seconds) | `120` | Per-call run timeout |

There is **no** `filter` field. Passing one (`run_tests({ filter: "@my/pkg" })`) is rejected with an error naming the unrecognized key and the accepted params — the run does not start. To scope to one package, pass its Vitest project name as `project`; to scope to one file, pass it in `files`. The `ok` result echoes the resolved `scope` (`project`, `files`, `tags`) so you can confirm what actually ran.

`project` matches the project **name** defined in `vitest.config.ts`, not the npm package name. They often differ — check your config for the actual project name.

`tags` sub-filters AND together (with each other and with `project`/`files`): `all` → `"a and b"`, `any` → `"(a or b)"`, `none` → `"not a and not b"`.

## Return shape

`run_tests` returns one of four variants — discriminate on `kind`:

| `kind` | Fields | Meaning |
| --- | --- | --- |
| `"ok"` | `report`, `classifications` (map of test full-name → `stable`/`new-failure`/`persistent`/`flaky`/`recovered`), `scope` (the resolved `project`/`files`/`tags` that actually ran), optional `project` | The run completed |
| `"no-match"` | `filter` (the resolved `project`/`files`/`tags`/`resolvedExpression`) | A filter was supplied but matched zero tests |
| `"timeout"` | `timeoutSeconds` | Exceeded the timeout |
| `"error"` | `message` | The run errored |

A `no-match` is filter-driven: it fires when you supplied a filter and zero tests matched. Treat it as a finding (typo in `project`/`files`?) rather than a pass.

## Coverage on subset runs — thresholds are skipped, not failed (issue #160)

A single-file or single-project `run_tests` call used to exit non-zero with:

```text
ERROR: Coverage for lines (59.91%) does not meet global threshold (70%)
```

even though every test passed — the global thresholds were compared against
the whole-project denominator, and partial coverage always "failed" that
comparison. This is fixed: the plugin's reporter detects a scoped/partial run
(a `files`, `project`, or `tags` filter was supplied, or fewer specs started
than exist in the project) and neutralizes Vitest's native
`coverage.thresholds` check for that run before it can flip the exit code.
No test failure, no false-positive threshold error.

The `ok` result's `scopedNote` field explains why (e.g. `"Coverage
thresholds skipped: partial run (1 of 47 test files)"`) and the same text
is folded into the markdown summary. The structured signal is
`report.coverage.scoped` (and the persisted `test_runs.scoped` column) —
`true` on a scoped run, `false` on a full run. Baselines and trends do not
ratchet on a scoped run either, since a subset's totals are not
representative of the whole project.

Full (unfiltered) runs are unaffected: thresholds still enforce, an actual
regression still fails the run, and baselines still ratchet normally.

`run_tests` still has **no per-run coverage toggle** — it deliberately
inherits your `vitest.config` `coverage.enabled`. The
`--coverage.enabled=false` CLI workaround is no longer needed to avoid a
false-positive threshold failure on a subset run; reach for it only if you
want to skip coverage collection entirely for speed.

## Stray console output — `report.consoleLeaks`

When the run produces stray `console.*` output, the `report` object on an
`"ok"` result carries an optional `consoleLeaks` field. It is omitted
entirely when the run produced no user console output.

Shape:

- `total` — total stray console writes across the run
- `byFile` — one entry per file that produced writes:
  - `file` — the test file path
  - `stdout` — writes to stdout-class streams (`log`, `info`, `debug`)
  - `stderr` — writes to stderr-class streams (`error`, `warn`)
  - `tests` (optional) — test names where writes were attributed
  - `sample` (optional) — truncated excerpt of the first write in this file
- `truncated` (optional) — `true` when `byFile` was capped
- `fromFailingTests` (optional) — `{ total, files }` summarizing console
  writes logged inside FAILING tests

`total` and `byFile` count only writes from tests that did **not** fail —
that is the actionable leak signal. Writes logged inside a failing test are
excluded from `total`/`byFile` and instead summarized in
`fromFailingTests`. This matters because some assertion libraries (loggers
included) route failure output through `console.*`; without the split,
every red run would report a "leak" for each failure regardless of whether
anything actually leaked. `consoleLeaks` is still omitted entirely when the
run produced no console output at all — but when a run has ONLY
failing-test output, it now comes back as `{ total: 0, byFile: [],
fromFailingTests }` rather than `undefined`, so the output stays visible
without being misread as a leak.

Use `byFile[].file` to locate which files to investigate and `sample` to
find the call site, without dumping full log content into agent context.
The markdown summary line surfaces the two buckets separately: the ⚠
warning only renders when `total > 0` (e.g.
`⚠ 3 stray console writes across 2 files (see consoleLeaks)`), and a
distinct non-warning note renders whenever `fromFailingTests` is populated
(e.g. `2 console writes from failing tests (not counted as leaks)`).

### Console-output visibility by surface

| Surface | Sees stray `console.*` | Per-test attribution |
| --- | --- | --- |
| `run_tests` (MCP) | yes — `consoleLeaks` signal (counts + sample) | per file, per test where resolvable |
| Human at a TTY | yes — Vitest's own `stdout \|` / `stderr \|` lines | yes (TTY only) |
| Piped shell (default) | no — agent-shaped summary suppresses it | n/a |
| Piped shell + `VITEST_AGENT_CONSOLE=passthrough` | yes — raw passthrough | no (raw, unlabeled) |

### `VITEST_AGENT_CONSOLE` — CLI escape hatch

To see raw console output for a file that `consoleLeaks` flagged, run
Vitest directly on the CLI with the override set:

```bash
VITEST_AGENT_CONSOLE=passthrough pnpm test
```

This overrides the plugin's resolved console mode to `passthrough` for
the active executor — Vitest's own reporters emit console output
unfiltered. An invalid value for the current executor slot warns to
stderr and is ignored.

## See also

- The orientation index (the 7 time-saving facts) is in this skill's `SKILL.md`.
- <https://vitest-agent.dev/guide/console-modes> — the full console-mode matrix.
