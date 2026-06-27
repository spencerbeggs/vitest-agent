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

There is **no** `filter` field. Passing one (`run_tests({ filter: "@my/pkg" })`) is silently dropped — the call then runs with no filters, so the **entire** suite executes. To scope to one package, pass its Vitest project name as `project`; to scope to one file, pass it in `files`.

`project` matches the project **name** defined in `vitest.config.ts`, not the npm package name. They often differ — check your config for the actual project name.

`tags` sub-filters AND together (with each other and with `project`/`files`): `all` → `"a and b"`, `any` → `"(a or b)"`, `none` → `"not a and not b"`.

## Return shape

`run_tests` returns one of four variants — discriminate on `kind`:

| `kind` | Fields | Meaning |
| --- | --- | --- |
| `"ok"` | `report`, `classifications` (map of test full-name → `stable`/`new-failure`/`persistent`/`flaky`/`recovered`), optional `project` | The run completed |
| `"no-match"` | `filter` (the resolved `project`/`files`/`tags`/`resolvedExpression`) | A filter was supplied but matched zero tests |
| `"timeout"` | `timeoutSeconds` | Exceeded the timeout |
| `"error"` | `message` | The run errored |

A `no-match` is filter-driven: it fires when you supplied a filter and zero tests matched. Treat it as a finding (typo in `project`/`files`?) rather than a pass.

## Coverage on subset runs reads as a failure — by design

A single-file or single-project run will commonly exit non-zero with:

```text
ERROR: Coverage for lines (59.91%) does not meet global threshold (70%)
```

This is expected: your global coverage thresholds are applied to a partial run, so partial coverage "fails" them. It is not a real test failure.

`run_tests` has **no per-run coverage toggle** — it deliberately inherits your `vitest.config` `coverage.enabled` (forcing it off here used to override intentional "coverage on by default" setups). For clean isolated inspection, drop to the CLI:

```bash
vitest run path/to/one.test.ts --coverage.enabled=false
```

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

Use `byFile[].file` to locate which files to investigate and `sample` to
find the call site, without dumping full log content into agent context.
The markdown summary line also surfaces the leak count inline (e.g.
`⚠ 3 stray console writes across 2 files (see consoleLeaks)`).

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

- `vitest-agent://patterns/operating-vitest-agent-as-an-agent` — the orientation index
- `vitest-agent://patterns/known-issues-and-caveats` — coverage-dir races and other instrumentation caveats
- `vitest://docs/config/index` — Vitest's native config reference
