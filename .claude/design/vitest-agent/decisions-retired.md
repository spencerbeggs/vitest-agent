---
status: archived
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-06-30
last-synced: 2026-06-30
completeness: 100
related:
  - ./decisions.md
dependencies: []
---

# Decisions — Retired

Decisions that were superseded as the system evolved. These entries document
what was tried and why it didn't survive. They are not how the system works
now; load this file only when investigating archaeology or comparing against
a current decision's "Why this shape rather than the obvious alternative"
section.

For active decisions, see [./decisions.md](./decisions.md).

---

## Decision 9: Hybrid Console Strategy (Retired)

**Superseded by:** [Decision 37 — Per-Executor Console Matrix +
Streaming Reporter Tap](./decisions.md#decision-37-per-executor-console-matrix--streaming-reporter-tap)

**Why retired:** the `strategy: "own" | "complement"` flag forced a
single global choice about whether the plugin owned stdout or layered
on top of Vitest's reporters. That single-axis choice could not express
the realistic split where humans want a live Ink mount, agents want a
markdown final frame, and CI wants GHA annotations all from the same
`vitest.config.ts`. D37 replaced both `mode` and `strategy` with a
per-executor matrix that resolves to a single `ConsoleMode` value at
runtime; the `complement` state is now `console.{slot}: "passthrough"`
and the `own` state is any of the non-`passthrough` modes.

**What it was:** `AgentPluginOptions.strategy` accepted `"own"` or
`"complement"` (default `"complement"`). `complement` layered the
plugin on top of Vitest's built-in `agent` reporter without stripping
reporters and only persisted to the database; `own` stripped console
reporters, used the plugin's own formatter for stdout, and wrote its
own GFM Step Summary. Paired with `mode: "agent" | "human" | "ci"`
which selected which executor's defaults to apply globally.

---

## Decision 27: `consoleStrategy` Renamed to `strategy` (Retired)

**Superseded by:** [Decision 37 — Per-Executor Console Matrix +
Streaming Reporter Tap](./decisions.md#decision-37-per-executor-console-matrix--streaming-reporter-tap)

**Why retired:** D27 was a rename inside the same single-flag design
that D9 specified. When D37 retired the `strategy` flag entirely in
favor of the `console.{human,agent,ci}` matrix, both the original
`consoleStrategy` name and its rename `strategy` lost their referent.

**What it was:** the `consoleStrategy` option was renamed to `strategy`
on `AgentPluginOptions` because the option controlled the overall
plugin/reporter interaction, not just console behavior — the `console`
prefix was deemed redundant given the plugin context. Today the
`console` prefix is back, this time as a per-executor object literal
(`console: { human?, agent?, ci? }`), not a flat flag.

---

## Decision 11: Cache Directory Resolution (Retired)

**Superseded by:** [Decision 31 — Deterministic XDG Path
Resolution](./decisions.md#decision-31-deterministic-xdg-path-resolution)

**Why retired:** the resolver walked the filesystem looking for an existing
artifact (`node_modules/.vite/vitest/<hash>/.../data.db`) and fell back to a
literal path on a fresh project. This made the data path a function of
filesystem state ("does this artifact exist?") instead of workspace
identity, so the MCP server and the reporter could disagree about where
the database lived. D31 replaced the artifact probe with a deterministic
function of the workspace's `package.json` `name` under
`$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db`.

**What it was:** three-priority resolution in `AgentPlugin`:

1. Explicit `reporter.cacheDir` option (user override)
2. `outputFile['vitest-agent-reporter']` from Vitest config
3. `vite.cacheDir + "/vitest-agent"` as default (typically
   `node_modules/.vite/.../vitest-agent/`)

CLI and MCP cache-dir resolution checked common locations independently.
When `AgentReporter` was used standalone (without the plugin), the default
was `.vitest-agent` in the project root.

---

## Decision 29: Plugin MCP Server Loader (Retired)

**Superseded by:** [Decision 30 — Plugin MCP Loader as PM-Detect +
Spawn](./decisions.md#decision-30-plugin-mcp-loader-as-pm-detect--spawn)

**Why retired:** the loader used a `file://` dynamic-import plus a manual
`node_modules` walk to locate the MCP server entrypoint inside the
single-package install. It depended on an exact `./mcp` subpath export,
duplicated Node's resolution algorithm (breaking under yarn berry PnP and
custom store directories), and surfaced errors as "couldn't find ./mcp
export" rather than "the package isn't installed". When the MCP server
became its own package (`@vitest-agent/mcp`) with its own bin in the
five-package split, the user's package manager could resolve and execute
it directly — re-implementing PM resolution in the loader was the wrong
layer. D30 rewrote the loader as a zero-deps PM-detect + spawn script
that delegates to `pnpm exec` / `npx --no-install` / `yarn run` / `bun x`.

**What it was:** the loader resolved the MCP server module by walking up
from the plugin directory through `node_modules` looking for
`@vitest-agent/reporter`'s `./mcp` subpath export, then dynamically
imported it as a `file://` URL.

---

## Decision 23 (1.x form): Normalized Project Identity (Retired)

**Superseded by:** [Decision 23 — Vitest-Native Tag
Classification](./decisions.md#decision-23-vitest-native-tag-classification)

**Why retired:** the 1.x form encoded test kinds as colon suffixes on
the Vitest project name (`my-app:unit`, `my-app:e2e`) and used
`splitProject()` to separate the name into a `(project, subProject)`
column pair on every write/read path. That coupled the test-kind concept
to Vitest's project-name string, forced one Vitest project per kind per
package, and bled the colon convention into history, baselines, trends,
notes, and sessions tables, plus the CLI/MCP filter surfaces.

Vitest 4.1's native tag system supports the same query patterns
("all unit tests across the workspace", "everything tagged e2e in
my-app") via tag-expression syntax — without making the project name
carry classification metadata. The 2.0 refactor consolidated to one
project per workspace package, dropped the `sub_project` column from
every table in the canonical schema, removed `subProject` from
`DataStore` / `DataReader` / `HistoryTracker` interfaces, and dropped
the per-kind override API on `discoverProjects`. The plugin now
installs a Vite `transform` hook that injects a `tags` array onto
every `test()` and `it()` call's options argument (see
`packages/plugin/src/utils/inject-tags.ts`).

**What it was:** Vitest project names included colon-suffixed kinds
(`"my-app:unit"`, `"my-app:e2e"`); `splitProject()` separated them at
the first colon into `project` and `subProject` fields, both stored in
SQLite columns. CLI commands (`history`, `status`, `trends`, `coverage`,
`doctor`) and MCP tools accepted a `subProject` filter parameter.
`HistoryTracker.classify` keyed on `(project, subProject)`. A null
`subProject` was distinct from an empty string at the row level.

---

## Decision 36 (Lockstep form): Lockstep Release with Build-Inlined Drift Check (Retired)

**Superseded by:** [Decision 36 — Independent Per-Package Release](./decisions.md#decision-36-independent-per-package-release)

**Why retired:** the six npm packages shared one version (a bump to any one bumped all six) and three init-time checks asserted that every `@vitest-agent/*` package in the same process carried the same build-inlined version, warning on stderr otherwise. Exact version equality only made sense under a lockstep release train. When the family moved to independent per-package versioning the equality assertion became a false positive on every ordinary consumer install — a plugin on one minor legitimately running an mcp on a later compatible minor is not drift — so the lockstep grouping and the drift check were removed together. The `CURRENT_<PKG>_VERSION` constants survive as public API; nothing consumes them across packages now.

**What it was:** changesets pinned the family to one version via a `fixed`/`linked` grouping. Each runtime package exported `CURRENT_<PKG>_VERSION`, inlined from `process.env.__PACKAGE_VERSION__` at build time. Three observation-only checks ran at init: the `AgentPlugin()` factory compared `CURRENT_PLUGIN_VERSION` against `CURRENT_SDK_VERSION` and `CURRENT_REPORTER_VERSION` (gated by a module-level `_hasWarnedDrift` flag, with a test-only `_resetVersionDriftGuardForTests` hook to re-arm it); the `vitest-agent-mcp` bin compared `CURRENT_MCP_VERSION` against `CURRENT_SDK_VERSION` in `main()`; the `vitest-agent` CLI bin compared `CURRENT_CLI_VERSION` against `CURRENT_SDK_VERSION` before `Command.run`. Each mismatch emitted one stderr line of the form `[@vitest-agent/<pkg>] version drift: <pkg>@<a> with <peer>@<b>. Reinstall @vitest-agent/* packages so versions match.` and continued. The plugin never compared against `CURRENT_UI_VERSION` because `@vitest-agent/ui` is not a hard peer. Build-inlining (vs a runtime `package.json` read) was chosen so the check had no I/O cost, no path-resolution ambiguity, and worked in packaged-binary environments where `package.json` is not on disk. The release artifacts matched the lockstep grouping: one unified semver git tag (e.g. `1.0.1`) and a single combined GitHub Release whose body concatenated every package's section and to which all packages' assets were attached — replaced under the independent scheme by per-package `@vitest-agent/<pkg>@<version>` tags and Releases.
