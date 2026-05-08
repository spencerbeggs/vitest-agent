---
"vitest-agent-plugin": major
"vitest-agent-sdk": major
"vitest-agent-cli": major
"vitest-agent-mcp": major
"vitest-agent-reporter": major
---

## Breaking Changes

### Project discovery

- `AgentPlugin.discover()` returns `{ projects, tags }` instead of `TestProjectInlineConfiguration[]`; destructure both and forward `tags` to `test.tags` in your Vitest config.
- `discoverProjects()` emits one `VitestProject` per workspace package; the `name:unit` / `name:int` / `name:e2e` colon-suffixed project naming is gone.
- The per-kind override API on `discoverProjects` (the `{ unit?, int?, e2e? }` options object) is removed. Use the new `{ callback?, tagStrategy? }` form.
- `splitProject` and `ProjectIdentity` are removed from `vitest-agent-sdk`. Project names no longer encode kind information so the helper is unreachable.

### Tag classification

- `AgentPlugin` gains a `tagStrategy?: TagStrategy | false` option. When active (the default is `TagStrategy.default`), a Vite transform parses every test file with acorn and rewrites each `test()` and `it()` call's options argument to add a `tags` array based on filename. Hand-authored `tags` are preserved verbatim. `--tags-filter "int"` selects matching tests automatically.
- New public exports from `vitest-agent-plugin`: `Tag`, `TagStrategy`, `ModuleInfo`, `ClassifyBaseContext`, `ClassifyExtendedContext`, `TagOptions`, `TagStrategyCreateOptions`, `TagStrategyExtendOptions`, plus the `ClassifyBaseFn` and `ClassifyExtendedFn` aliases.
- `TagStrategy.default` ships unit / int / e2e tag definitions and classifies `*.int.test.*` as `int`, `*.e2e.test.*` as `e2e`, and everything else as `unit`. Compose your own with `TagStrategy.create(...)` or `TagStrategy.default.extend({ additionalTags?, classify? })`.

### Sub-project removal

- The `sub_project` column is dropped from `test_runs`, `test_history`, `coverage_baselines`, `coverage_trends`, `notes`, and `sessions`. Existing on-disk databases are wiped by the drop-and-recreate migration; CI agents will start with an empty trend history on first run.
- `subProject` is removed from the `DataStore`, `DataReader`, and `HistoryTracker` service interfaces and from every input and result type that carried it (`TestRunInput`, `NoteInput`, `SessionInput`, `ProjectRunSummary`, `FlakyTest`, `PersistentFailure`, `NoteRow`, `SessionDetail`).
- `vitest-agent-cli`: the `--sub-project` option is removed from `vitest-agent record` (and from the underlying record-session helper). Drop the flag from any scripts that pass it.
- `vitest-agent-mcp`: the `subProject` zod input field is removed from `test_history`, `test_trends`, `test_coverage`, `module_list`, `suite_list`, `test_list`, `test_get`, `test_errors`, `note_create`, and several other tools.

## Features

### Per-tag count rendering

- `AgentReport` gains an optional `tagCounts` record keyed by tag name with `passed`, `failed`, and `skipped` numbers per tag.
- The plugin reporter aggregates per-tag counts across each project's tests and writes them onto the report.
- The terminal formatter shows an inline `unit:746 int:6` summary on the project line when more than one tag is present, and renders an indented per-tag pass-and-fail breakdown beneath the line whenever a project has failures.

### Trend write idempotency

- `DataStore.writeTrends` now uses `INSERT OR REPLACE`. A re-run at the same `(project, timestamp)` writes the latest values rather than failing the unique constraint.
