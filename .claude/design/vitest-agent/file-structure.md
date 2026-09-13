---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 90
related:
  - ./architecture.md
  - ./schemas.md
  - ./data-flows.md
  - ./decisions.md
  - ./components/sdk.md
  - ./components/engine.md
  - ./components/ui.md
  - ./components/docs-site.md
dependencies: []
---

# File Structure — vitest-agent

Repo navigation, the XDG data-path resolution stack, and per-Vitest-project
keying inside the database. For per-package detail (services, utilities, the
reporter contract) see [./components/](./components/).

## Repo layout

Source lives in eight publishable pnpm workspaces under `packages/` (plus four per-platform sidecar sub-packages), the `docs` documentation-site workspace at `website/`, and the Claude Code plugin workspace at `plugins/claude-code/`. `pnpm-workspace.yaml` globs `packages/*`, `plugins/*`, `playground` and `website`, so the plugin is a workspace member — private, unbuilt and never published, but versioned by changesets. The `plugins/` container is plural in anticipation of a second agent host; only `claude-code/` exists today.

```text
packages/
  sdk/         @vitest-agent/sdk — rank 1, the platform-free core (no internal deps, no node:, no process; schemas, contracts, errors, pure formatters + utils; entry points: . / ./dispatch / ./schemas/*.json)
    src/version.ts             CURRENT_SDK_VERSION — the only file allowed the __PACKAGE_VERSION__ token
    src/dispatch.ts            the pure dispatch(argv, io) entry the sidecar bins import
    src/utils/posix-path.ts    the node:path replacement
  engine/      @vitest-agent/engine — rank 3, the platform half (depends on sdk; services, layers, sql, migrations, lib, testing; entry points: . / ./testing)
    src/platform.ts            PlatformLive({ dbPath, env, logLevel?, logFile? }), makeSqliteStack, NodePlatformLayer
    src/project-dir.ts         resolveProjectDir({ env, cwd }) — the four-name precedence
    src/programs/              hook-paths, platform-sidecar, register-agent, end-agent, record-*, resolve-session-for-recording, session-env
    __test__/boundaries.test.ts  no `process` anywhere under src/, no allowlist
  plugin/      @vitest-agent/plugin — rank 5, the carrier (deps on cli+mcp+reporter+engine+sdk; Vitest packages are required peers; owns no rendering)
    src/bin/vitest-agent.ts        4-line shim: import { main } from "@vitest-agent/cli/main"
    src/bin/vitest-agent-mcp.ts    4-line shim: import { main } from "@vitest-agent/mcp/main"
    __test__/workspace-layering.test.ts    the rank / DAG check (utils/workspace-graph.ts)
    __test__/bins-packed-install.e2e.test.ts  npm / pnpm / yarn / bun consumer install
  reporter/    @vitest-agent/reporter — rank 3 (depends on sdk + ui + react + ink; DefaultVitestAgentReporter + live Ink mount + contract re-exports + dispatch helpers)
  ui/          @vitest-agent/ui — rank 2 (depends on sdk; react/ink peers; pure rendering primitives)
  cli/         @vitest-agent/cli — rank 4 (bin: vitest-agent; depends on engine + sdk + sidecar)
    src/bin.ts                 shim: import { main } from "./main.js"; main();
    src/main.ts                owns the process; published as ./main
    src/index.ts               side-effect-free barrel (CURRENT_CLI_VERSION only)
    src/commands/              the effect/unstable/cli wrappers (process allowlisted here)
  mcp/         @vitest-agent/mcp — rank 4 (bin: vitest-agent-mcp; depends on engine + sdk)
    src/bin.ts / main.ts / index.ts   same entry contract (main.ts: crash guards first, then dynamic imports)
    src/server.ts              ServerLayer over McpServer.layerStdio
    src/toolkit.ts             Kit + toolHandlers + ToolsLayer
    src/register-toolkit.ts    registerStrictToolkit
    src/tools/                 one file per tool (30)
    src/prompts/layer.ts       PromptsLayer (six McpServer.prompt)
  sidecar/     @vitest-agent/sidecar — rank 3 (optional deps on the four sidecar-* children; src/index.ts exports resolveSidecarBinaryPath; no bin)
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

plugins/       agent-host plugin workspaces (pnpm-workspace.yaml globs plugins/*)
  claude-code/ @vitest-agent/claude-code-plugin (private; no build, no scripts; marketplace-distributed)
    package.json                  release-tracking manifest; changesets versions it, npm never sees it
    .claude-plugin/plugin.json    marketplace manifest + inline mcpServers config; version kept in step by changesets versionFiles
    bin/start-mcp.sh              zero-deps POSIX shell loader: exec node_modules/.bin/vitest-agent-mcp, else install message + npx fallback
    bin/start-mcp.mjs             Node.js fallback loader, same .bin-first preference (not active by default)
    hooks/                        shell scripts + hooks.json + fixtures/ + lib/ (detect-pm.sh: detect_vitest_agent_bin)
    __test__/                     bats suites (bin-preference.bats covers the loaders and the .bin-first hook contract)
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
and `dist/npm/` produced by the bundler. The two front ends (`cli`, `mcp`)
add the entry contract from Decision 70 — `src/bin.ts` (shebang +
`main()`), `src/main.ts` (owns the process, published as `./main`),
`src/index.ts` (side-effect-free barrel), `src/version.ts` — and every
package that may touch `process` carries a `__test__/boundaries.test.ts`
naming exactly where. The parent
`sidecar/` follows the standard rslib layout but ships only a single
`src/index.ts` entry exporting `resolveSidecarBinaryPath` — no tests. The
four `sidecar-*` sub-packages depart from the standard layout: each carries a
thin `src/bin.ts` runner that imports the pure `dispatch` from `@vitest-agent/sdk/dispatch` and passes `process.cwd()`, `process.env` and a `readFileSync` wrapper as its `io`,
plus its own `lib/scripts/tsdown.ts` programmatic build script and builds a
Node SEA binary into `bin/` with tsdown's `exe` mode rather than
rslib-builder (see [./components/sidecar.md](./components/sidecar.md)) — no
`__test__/`. The per-child `lib/scripts/tsdown.ts` script selects its mode
from the npm lifecycle event: `build:dev` emits `dist/dev`, `build:prod`
emits `dist/npm` — each variant directory holding the SEA
binary plus a publish-cleaned `package.json`.

For per-package source breakdown see the corresponding
[./components/*.md](./components/) file.

## Docs site

The `website/` workspace (package `docs`) is the RSPress 2.0 site. Its content tree is locale-scoped under `docs/en/` with a Guide spine and a directory per package, and its per-package API pages are generated from API Extractor models that each package's `build:prod` copies into `website/lib/models/<short>/`. The copied models and the generated `docs/en/*/api/` pages are gitignored; `website/api-docs-snapshot.db` is committed as the generation source of truth. The deploy to Cloudflare Pages lives in `.github/workflows/deploy-docs.yml`. The repo-root `docs/*.md` user docs predate the site and are superseded by it — they are slated for retirement, so do not add new user-facing prose there. See [./components/docs-site.md](./components/docs-site.md) for the full pipeline.

## Test files

Test files live under `packages/<name>/__test__/*.test.ts` (flat layout).
The `discoverProjects` scanner in `@vitest-agent/plugin` also picks up any
`packages/<name>/src/**/*.test.ts` co-located files when present. Helper
files are separated into `__test__/utils/`, `__test__/fixtures/`, and
`__test__/snapshots/` subdirectories which the scanner excludes
automatically. That exclusion is anchored at the test root: only a
helper-named directory *directly under* `__test__/` is excluded, so a
suite at `__test__/unit/utils/foo.test.ts` is an ordinary test file and is
discovered normally (issue #251). See [./testing-strategy.md](./testing-strategy.md) for
testing patterns and per-project counts.

## Data path

The SQLite database lives at a deterministic XDG-derived location keyed by
the workspace's identity, not its filesystem path. See
[./decisions.md](./decisions.md) D31 for the resolution-precedence rationale
and [./components/engine.md](./components/engine.md) for the
`packages/engine/src/utils/resolve-data-path.ts` implementation.

```text
$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db
```

On systems without `XDG_DATA_HOME` set, the hook-driven sidecar paths
(`programs/hook-paths.ts`, `fallbackDir: ".local/share/vitest-agent"`)
fall back to:

```text
~/.local/share/vitest-agent/<workspaceKey>/data.db
```

The reporter / MCP path (`PathResolutionLive`, no `fallbackDir`) currently
falls back to `~/.vitest-agent/<workspaceKey>/data.db` instead — a
pre-existing split made visible by the engine extraction and recorded as
a follow-up under Decision 70; it is invisible wherever `XDG_DATA_HOME` is
set.

`<workspaceKey>` is derived from the root `package.json` `name` via
`normalizeWorkspaceKey`:

| Root `package.json` `name` | `<workspaceKey>` |
| --- | --- |
| `my-app` | `my-app` |
| `@org/pkg` | `@org__pkg` |
| `weird name with spaces!` | `weird_name_with_spaces_` |

`AppDirs.ensureData` from `@effected/xdg` creates the directory if missing
so the SQLite driver can open the DB without separately mkdir'ing the parent.

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
   `WorkspaceDiscovery` from `@effected/workspaces`, then normalized.
5. **Fail with `WorkspaceRootNotFoundError`** if no root workspace is
   discoverable.

**No silent fallback to a path hash.** Silent fallbacks are the bug class
2.0 leaves behind. If the system can't decide where the DB belongs, it must
fail loudly so the user can fix the workspace identity.

**Known open item — `.git` is no longer a workspace-root boundary.** The v4
`@effected/workspaces` recognizes only `pnpm-workspace.yaml` or a
`workspaces` field as a workspace-root marker; it dropped the `.git`
boundary the v3 `workspaces-effect` honored. A single-package consumer repo
whose only root marker is `.git` (no workspace manifest) now fails step 4
and raises `WorkspaceRootNotFoundError`. The workaround today is to set
`projectKey` (or `cacheDir`) in `vitest-agent.config.toml`. This boundary
policy is **deferred by the maintainer, not yet resolved** — see Decision 46
in [./decisions.md](./decisions.md).

### `vitest-agent.config.toml`

The optional config is loaded by `ConfigLive(projectDir)` via
`@effected/config-file`'s `MergeStrategy.firstMatch()` strategy. The
resolver chain (from `ConfigResolver`):

1. `workspaceRoot` (the pnpm/npm/yarn workspace root)
2. `gitRoot` (the git repo root)
3. `upwardWalk` (walks upward from `projectDir`)

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
package, no colon suffix) is keyed solely by its `name` — `@vitest-agent/sdk`,
`@vitest-agent/plugin`, etc. There is no `sub_project` column anywhere in
the schema; the legacy `splitProject()` utility and `(project, subProject)`
column pair were dropped in 2.0.

Test-kind differentiation uses **Vitest-native tags** (available since Vitest 4.1; Vitest 5.0+ required).
`DiscoverStrategy` in `@vitest-agent/plugin` declares the available tags
(`unit`, `int`, `e2e` by default) and a `classify()` method that maps a
test file to a tag list. The plugin installs a Vite `transform` hook
(see `packages/plugin/src/utils/inject-tags.ts`) that prepends a
per-file prelude applying the resolved tags to the file task, which
every declared suite and test then inherits at collection time.
Filter at the command line via Vitest's standard tag-expression
syntax (`pnpm vitest --project @vitest-agent/sdk --tags-filter "unit"`).
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
with the same detection order — though since Decision 70 both prefer the
consumer's `node_modules/.bin/vitest-agent[-mcp]` (the carrier's bins) and
use the detected manager only for the install-instruction line or the
last-resort `<pm exec>` rung:

1. Check `packageManager` field in root `package.json`
2. Fall back to lockfile detection (`pnpm-lock.yaml`, `bun.lock`,
   `bun.lockb`, `yarn.lock`, `package-lock.json`)
3. Default to `npx` (in the shared utility) or `npm` (in the loader)

Two copies exist because the plugin loader cannot import from
`@vitest-agent/sdk` — it runs before the user's npm packages are guaranteed
to be installed. The detection order is identical so the two copies do not
drift in observable behavior.

## Agent-agnostic taxonomy paths

### Project identity resolution

The `resolveDataPath` chain (workspace name only) is supplemented
by `ProjectIdentity.resolve` (see
`packages/engine/src/services/ProjectIdentity.ts`), a 5-source fallback:

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
| Per-project data store | `$XDG_DATA_HOME/vitest-agent/<projectKey>/data.db` | Node's built-in `node:sqlite` via `@effect/sql-sqlite-node` (v4) |
| Per-client session map | `${CLAUDE_PLUGIN_DATA}/sessions.db` (Claude Code) | Same |
| Global discovery registry | `$XDG_DATA_HOME/vitest-agent/registry.db` | Same |

One non-SQLite sibling shares the same root: `AgentPlugin.runScript`'s
advisory lock and done-marker files live in
`$XDG_DATA_HOME/vitest-agent/runscript-locks/<hash>.{lock,done}`, where
`<hash>` is a truncated SHA-256 of `(cwd, command)`. It follows the same
`~/.local/share` fallback as the data store (its own
`resolveRunScriptLockDir`, not `resolveDataPath` — the lock is
process-coordination state keyed by command, not per-project data). The
files are ephemeral and safe to delete; see
[./components/plugin.md](./components/plugin.md).

The CLI's `agent` sidecar subcommands resolve all three SQLite
paths from the injected env at invocation time through the engine's
`resolveHookPaths({ env, projectKey })`:

- Per-project: `$XDG_DATA_HOME/vitest-agent/<projectKey>/data.db` where `<projectKey>` comes from `ProjectIdentity` resolution against `--cwd`
- Per-client: `${CLAUDE_PLUGIN_DATA}/sessions.db`, falling back to `${VITEST_AGENT_SESSION_MAP_DIR}/sessions.db`, falling back to `~/.vitest-agent/sessions.db`
- Registry: `$XDG_DATA_HOME/vitest-agent/registry.db`

`resolveHookPaths` creates every parent dir (`AppDirs.ensureData` for the
root, `FileSystem.makeDirectory` for the project and session-map dirs)
before SQLite opens the file; `HOME` or `USERPROFILE` must be present in
the env map for the XDG rung (`XdgEnvError` → exit 5).
