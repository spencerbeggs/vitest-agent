---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ./architecture.md
  - ./data-structures.md
  - ./schemas.md
  - ./data-flows.md
  - ./decisions.md
  - ./components/sdk.md
dependencies: []
---

# File Structure — vitest-agent

Repo navigation, the XDG data-path resolution stack, and per-Vitest-project
keying inside the database. For per-package detail (services, utilities, the
reporter contract) see [./components/](./components/).

## Repo layout

Source lives in five pnpm workspaces under `packages/`, plus the file-based
Claude Code plugin at `plugin/` (NOT a workspace) and the `examples/`
integration target.

```text
packages/
  sdk/         vitest-agent-sdk (no internal deps)
  plugin/      vitest-agent-plugin (depends on sdk; reporter+cli+mcp peer)
  reporter/    vitest-agent-reporter (depends on sdk; named factories)
  cli/         vitest-agent-cli (bin: vitest-agent)
  mcp/         vitest-agent-mcp (bin: vitest-agent-mcp; spawned by plugin)

examples/
  basic/       minimal example app (5th Vitest project)

plugin/        file-based Claude Code plugin (NOT a pnpm workspace)
  .claude-plugin/plugin.json    inline mcpServers config
  bin/start-mcp.sh              zero-deps POSIX shell PM-detect + exec loader
  bin/start-mcp.mjs             Node.js fallback loader (not active by default)
  hooks/                        shell scripts + hooks.json + fixtures/ + lib/
  agents/tdd-task.md            tdd-task subagent definition
  skills/                       plugin-shipped skills
  commands/                     slash commands

.claude/       project-local Claude Code config (NOT shipped with plugin)
  skills/                       project-local skills
  design/                       design docs (this directory)
  plans/                        implementation plans
```

Each `packages/<name>/` follows the standard layout: `src/` for source,
`__test__/` for test files (flat layout, not co-located with source), `lib/`
for build/maintenance scripts where applicable, `dist/dev/` and `dist/npm/`
produced by `@savvy-web/rslib-builder`.

The `mcp` package additionally vendors content under `src/`:

- `src/vendor/vitest-docs/` — vendored upstream Vitest documentation
  snapshot, surfaced via `vitest://docs/` MCP resources. Located under
  `src/` so turbo's build cache invalidates on edits and refreshes show up
  as build-affecting.
- `src/patterns/` — curated testing-patterns library, surfaced via
  `vitest-agent://patterns/` MCP resources.

Both trees mirror to `dist/<env>/vendor/` and `dist/<env>/patterns/` at
build time via rslib's `copyPatterns` config in `rslib.config.ts` — no
separate postbuild script.

The `mcp/lib/scripts/` directory holds the Effect-based maintenance scripts
that refresh the vendored docs snapshot:
`fetch-upstream-docs.ts`, `build-snapshot.ts`, `validate-snapshot.ts`. They
preserve the `execFileSync`-with-array-args discipline for git invocations
so a malicious upstream tag cannot inject shell commands.

For per-package source breakdown see the corresponding
[./components/*.md](./components/) file.

## Test files

Test files live under `packages/<name>/__test__/*.test.ts` (flat layout).
The `discoverProjects` scanner in `vitest-agent-plugin` also picks up any
`packages/<name>/src/**/*.test.ts` co-located files when present. Helper
files are separated into `__test__/utils/`, `__test__/fixtures/`, and
`__test__/snapshots/` subdirectories which the scanner excludes
automatically. See [./testing-strategy.md](./testing-strategy.md) for
testing patterns and per-project counts.

## Data path

The SQLite database lives at a deterministic XDG-derived location keyed by
the workspace's identity, not its filesystem path. See
[./decisions.md](./decisions.md) D31 for the resolution-precedence rationale
and [./components/sdk.md](./components/sdk.md) for the
`packages/sdk/src/utils/resolve-data-path.ts` implementation.

```text
$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db
```

On systems without `XDG_DATA_HOME` set, falls back to:

```text
~/.local/share/vitest-agent/<workspaceKey>/data.db
```

`<workspaceKey>` is derived from the root `package.json` `name` via
`normalizeWorkspaceKey`:

| Root `package.json` `name` | `<workspaceKey>` |
| --- | --- |
| `my-app` | `my-app` |
| `@org/pkg` | `@org__pkg` |
| `weird name with spaces!` | `weird_name_with_spaces_` |

`AppDirs.ensureData` from `xdg-effect` creates the directory if missing so
better-sqlite3 can open the DB without separately mkdir'ing the parent.

### Resolution precedence

`resolveDataPath(projectDir, options?)` consults these sources in order
(highest-precedence first):

1. **`options.cacheDir`** (programmatic override) — the plugin's
   `reporter.cacheDir` option flows through here. Returns
   `<cacheDir>/data.db` after `mkdirSync(cacheDir, { recursive: true })`.
   Skips the heavy XDG/workspace layer stack.
2. **`cacheDir` from `vitest-agent.config.toml`** — same shape:
   `<cacheDir>/data.db` after `mkdirSync`.
3. **`projectKey` from the same config TOML** — used as the
   `<workspaceKey>` segment under the XDG data root. Normalized via
   `normalizeWorkspaceKey`.
4. **Workspace name from root `package.json`** — resolved via
   `WorkspaceDiscovery` from `workspaces-effect`, then normalized.
5. **Fail with `WorkspaceRootNotFoundError`** if no root workspace is
   discoverable.

**No silent fallback to a path hash.** Silent fallbacks are the bug class
2.0 leaves behind. If the system can't decide where the DB belongs, it must
fail loudly so the user can fix the workspace identity.

### `vitest-agent.config.toml`

The optional config is loaded by `ConfigLive(projectDir)` via
`config-file-effect`'s `FirstMatch` strategy. The resolver chain:

1. `WorkspaceRoot` (the pnpm/npm/yarn workspace root)
2. `GitRoot` (the git repo root)
3. `UpwardWalk` (walks upward from `projectDir`)

The first file found wins. Both fields are optional:

```toml
# vitest-agent.config.toml

# Override the entire data directory. Highest precedence after the
# programmatic `reporter.cacheDir` plugin option.
cacheDir = "/abs/path/to/cache"

# Override just the workspace key segment under the XDG data dir.
# Use this when two unrelated projects share a package.json `name`
# (collision case) or when you want a stable key independent of name
# changes.
projectKey = "my-app"
```

## Project keying and tag classification

The DB is one-per-workspace. Each Vitest project (one per workspace
package, no colon suffix) is keyed solely by its `name` — `vitest-agent-sdk`,
`vitest-agent-plugin`, etc. There is no `sub_project` column anywhere in
the schema; the legacy `splitProject()` utility and `(project, subProject)`
column pair were dropped in 2.0.

Test-kind differentiation moved to **Vitest-native tags** (Vitest 4.1+).
`TagStrategy` in `vitest-agent-plugin` declares the available tags
(`unit`, `int`, `e2e` by default) and a `classify()` function that maps a
test file to a tag list. The plugin installs a Vite `transform` hook
(see `packages/plugin/src/utils/inject-tags.ts`) that rewrites every
`test()` and `it()` call's options argument to add the resolved tags
array. Filter at the command line via Vitest's standard tag-expression
syntax (`pnpm vitest --project vitest-agent-sdk --tags-filter "unit"`).

Aggregated per-tag pass/fail/skip counts surface on `AgentReport.tagCounts`
and render in the terminal formatter as both an inline summary on the
project line and an indented per-tag failure breakdown.

## Package manager detection

The CLI overview and history commands need to output correct run commands.
Canonical detection logic lives in `packages/sdk/src/utils/detect-pm.ts`
behind a `FileSystemAdapter` interface for testability. The plugin's
`bin/start-mcp.sh` (and `hooks/lib/detect-pm.sh`) ship zero-deps copies
with the same detection order:

1. Check `packageManager` field in root `package.json`
2. Fall back to lockfile detection (`pnpm-lock.yaml`, `bun.lock`,
   `bun.lockb`, `yarn.lock`, `package-lock.json`)
3. Default to `npx` (in the shared utility) or `npm` (in the loader)

Two copies exist because the plugin loader cannot import from
`vitest-agent-sdk` — it runs before the user's npm packages are guaranteed
to be installed. The detection order is identical so the two copies do not
drift in observable behavior.
