---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-06-12
last-synced: 2026-06-12
completeness: 90
related:
  - ./architecture.md
  - ./schemas.md
  - ./data-flows.md
  - ./decisions.md
  - ./components/sdk.md
  - ./components/ui.md
  - ./components/docs-site.md
dependencies: []
---

# File Structure — vitest-agent

Repo navigation, the XDG data-path resolution stack, and per-Vitest-project
keying inside the database. For per-package detail (services, utilities, the
reporter contract) see [./components/](./components/).

## Repo layout

Source lives in seven publishable pnpm workspaces under `packages/` (plus
four per-platform sidecar sub-packages), the `docs` documentation-site
workspace at `website/`, and the file-based Claude Code plugin at `plugin/`
(NOT a workspace).

```text
packages/
  sdk/         vitest-agent-sdk (no internal deps; owns RunEvent + RenderState schemas; three entry points: . / ./dispatch / ./testing)
  plugin/      vitest-agent-plugin (deps on sdk+reporter; cli+mcp+Vitest packages are required peers; streaming hooks + run-event PubSub channel + onRunEvent tap; owns no rendering)
  reporter/    vitest-agent-reporter (depends on sdk + ui + react + ink; default reporter package — DefaultVitestAgentReporter + live Ink mount + contract re-exports + dispatch helpers)
  ui/          vitest-agent-ui (depends on sdk; react/ink peers; pure rendering primitives — reducer + shape-tailored dispatcher matrix + synthesizers + RunEventChannel PubSub)
  cli/         vitest-agent-cli (bin: vitest-agent; depends on sdk + sidecar)
  mcp/         vitest-agent-mcp (bin: vitest-agent-mcp; pulled in by the plugin)
  sidecar/     vitest-agent-sidecar (depends on cli + sdk; rslib re-export entry — src/index.ts exports resolveSidecarBinaryPath; no bin)
  sidecar-darwin-arm64/  per-platform binary sub-package (os: darwin, cpu: arm64)
  sidecar-linux-arm64/   per-platform binary sub-package (os: linux, cpu: arm64)
  sidecar-linux-x64/     per-platform binary sub-package (os: linux, cpu: x64)
  sidecar-win32-x64/     per-platform binary sub-package (os: win32, cpu: x64)

lib/
  configs/     repo-root build/tooling config helpers (NOT a workspace)

website/       docs workspace (package "docs"; RSPress 2.0 site → vitest-agent.dev)
  rspress.config.ts            site config + ApiExtractorPlugin wiring
  docs/en/                     locale-scoped MDX (guide/ + per-package dirs + packages/)
  docs/en/_nav.json            top nav: Guide | Packages
  lib/models/<short>/          API Extractor models copied in by each package's build:prod (gitignored)
  docs/en/<pkg>/api/           generated API pages (gitignored)
  api-docs-snapshot.db         committed generation source of truth (-shm/-wal gitignored)

docs/          repo-root user docs (SUPERSEDED by website/, slated for retirement)

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

Each primary `packages/<name>/` follows the standard layout: `src/` for
source, `__test__/` for test files (flat layout, not co-located with
source), `lib/` for build/maintenance scripts where applicable, `dist/dev/`
and `dist/npm/` produced by `@savvy-web/rslib-builder`. The parent
`sidecar/` follows the standard rslib layout but ships only a single
`src/index.ts` entry exporting `resolveSidecarBinaryPath` — no tests. The
four `sidecar-*` sub-packages depart from the standard layout: each carries a
thin `src/bin.ts` runner that imports `dispatch` from `vitest-agent-sdk/dispatch`,
plus its own `lib/scripts/tsdown.ts` programmatic build script and builds a
Node SEA binary into `bin/` with tsdown's `exe` mode rather than
rslib-builder (see [./components/sidecar.md](./components/sidecar.md)) — no
`__test__/`. The per-child `lib/scripts/tsdown.ts` script selects its mode
from the npm lifecycle event: `build:dev` emits `dist/dev`, `build:prod`
emits `dist/npm` and `dist/github` — each variant directory holding the SEA
binary plus a publish-cleaned `package.json`.

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

## Docs site

The `website/` workspace (package `docs`) is the RSPress 2.0 site. Its content tree is locale-scoped under `docs/en/` with a Guide spine and a directory per package, and its per-package API pages are generated from API Extractor models that each package's `build:prod` copies into `website/lib/models/<short>/`. The copied models and the generated `docs/en/*/api/` pages are gitignored; `website/api-docs-snapshot.db` is committed as the generation source of truth. The deploy to Cloudflare Pages lives in `.github/workflows/deploy-docs.yml`. The repo-root `docs/*.md` user docs predate the site and are superseded by it — they are slated for retirement, so do not add new user-facing prose there. See [./components/docs-site.md](./components/docs-site.md) for the full pipeline.

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

Test-kind differentiation uses **Vitest-native tags** (Vitest 4.1+).
`DiscoverStrategy` in `vitest-agent-plugin` declares the available tags
(`unit`, `int`, `e2e` by default) and a `classify()` method that maps a
test file to a tag list. The plugin installs a Vite `transform` hook
(see `packages/plugin/src/utils/inject-tags.ts`) that rewrites every
`test()` and `it()` call's options argument to add the resolved tags
array. Filter at the command line via Vitest's standard tag-expression
syntax (`pnpm vitest --project vitest-agent-sdk --tags-filter "unit"`).
The classifier and project detection share one `DiscoverStrategy`
contract; see Decision 39.

Aggregated per-tag pass/fail/skip counts surface on `AgentReport.tagCounts`
and render in the terminal formatter as both an inline summary on the
project line and an indented per-tag failure breakdown.

## Package manager detection

Run-command output and the MCP loader both need the project's package
manager. Canonical detection logic lives in `packages/sdk/src/utils/detect-pm.ts`
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

## Agent-agnostic taxonomy paths

### Project identity resolution

The `resolveDataPath` chain (workspace name only) is supplemented
by `ProjectIdentity.resolve` (see
`packages/sdk/src/services/ProjectIdentity.ts`), a 5-source fallback:

1. Explicit option
2. `projectKey` field in `vitest-agent.config.toml` at the workspace root
3. `git config remote.origin.url` (canonicalized)
4. `package.json#repository.url` (parsed and canonicalized as a git URL)
5. Normalized `package.json#name`

Failure mode: `ProjectIdentityNotResolvableError` listing every source
attempted. Used by the CLI's `agent` sidecar subcommands
(`packages/cli/src/commands/agent.ts`) to compute the per-project data
store directory directly from `XDG_DATA_HOME` plus the normalized
`projectKey`, sidestepping workspace-discovery so the sidecar works in
non-pnpm-workspace project shapes.

URL canonicalization (`packages/sdk/src/utils/canonicalize-git-url.ts`):

| Input | Canonical form |
| --- | --- |
| `git@github.com:org/repo.git` | `github.com/org/repo` |
| `https://github.com/org/repo.git` | `github.com/org/repo` |
| `ssh://git@github.com/org/repo.git` | `github.com/org/repo` |
| `https://GitHub.com/Org/Repo` | `github.com/org/repo` |

The filesystem-safe `projectKey` form replaces `/` with `__`
(e.g. `github.com__org__repo`).

### Storage paths

| Store | Path | Driver |
| --- | --- | --- |
| Per-project data store | `$XDG_DATA_HOME/vitest-agent/<projectKey>/data.db` | `better-sqlite3` via `@effect/sql-sqlite-node` |
| Per-client session map | `${CLAUDE_PLUGIN_DATA}/sessions.db` (Claude Code) | Same |
| Global discovery registry | `$XDG_DATA_HOME/vitest-agent/registry.db` | Same |

The CLI's `agent` sidecar subcommands resolve all three SQLite
paths from env at invocation time:

- Per-project: `$XDG_DATA_HOME/vitest-agent/<projectKey>/data.db` where `<projectKey>` comes from `ProjectIdentity` resolution against `--cwd`
- Per-client: `${CLAUDE_PLUGIN_DATA}/sessions.db`, falling back to `${VITEST_AGENT_SESSION_MAP_DIR}/sessions.db`, falling back to `~/.vitest-agent/sessions.db`
- Registry: `$XDG_DATA_HOME/vitest-agent/registry.db`

`mkdirSync(..., { recursive: true })` ensures every parent dir exists
before SQLite opens the file.
