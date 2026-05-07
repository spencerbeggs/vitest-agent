---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-07
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 95
related:
  - ./plugin.md
  - ../testing-strategy.md
dependencies: []
---

# Project Discovery (`AgentPlugin.discover()`)

Auto-discovers Vitest project configurations from the pnpm workspace layout
so `vitest.config.ts` does not require manual per-package entries. The system
walks workspace packages, classifies test files by kind, and produces one
`TestProjectInlineConfiguration` per discovered test kind per package.

---

## Purpose

Without discovery, every package added to the monorepo requires a manual entry
in `vitest.config.ts`. The discovery system reads the workspace layout once per
process, scans for test files, and returns a ready-to-use array for Vitest's
`test.projects` key. It also emits placeholder projects for packages that have a
`src/` directory but no test files yet, so every package name appears in
analytics even before its first test is written.

---

## Public API

### `AgentPlugin.discover(options?)`

Defined in `packages/plugin/src/plugin.ts` (lines 340-343). Returns
`Promise<TestProjectInlineConfiguration[]>` for direct assignment to
`test.projects`.

```ts
export async function discover(
  options?: DiscoveryOptions,
): Promise<TestProjectInlineConfiguration[]>
```

Internally delegates to `discoverProjects(options)` and maps each result
through `VitestProject.toConfig()`.

### `DiscoveryOptions`

Defined in `packages/plugin/src/utils/discover-projects.ts`.

```ts
type ProjectKindConfig = Partial<NonNullable<TestProjectInlineConfiguration["test"]>>;
type ProjectKindCallback = (projects: Map<string, VitestProject>) => void | Promise<void>;
type ProjectKindOverride = ProjectKindConfig | ProjectKindCallback;
type ProjectsCallback = (ctx: { projects: VitestProject[] }) => void | Promise<void>;

type DiscoveryOptions =
  | ProjectsCallback
  | { unit?: ProjectKindOverride; int?: ProjectKindOverride; e2e?: ProjectKindOverride };
```

Two shapes are accepted:

- **Flat callback** — receives `{ projects: VitestProject[] }` and can mutate
  the full list in-place.
- **Per-kind object** — each key (`unit`, `int`, `e2e`) is either a
  `ProjectKindConfig` (merged into all projects of that kind) or a
  `ProjectKindCallback` (receives a `Map<name, VitestProject>` scoped to that
  kind).

### `VitestProject` class

Defined in `packages/plugin/src/utils/vitest-project.ts`. A mutable builder
wrapping `TestProjectInlineConfiguration`. Private constructor; all construction
goes through static factories.

**Static factories:**

| Factory | `environment` | `testTimeout` | `hookTimeout` | `maxConcurrency` |
| ------- | ------------- | ------------- | ------------- | ---------------- |
| `VitestProject.unit(options)` | `"node"` | — | — | — |
| `VitestProject.int(options)` | `"node"` | 60 000 ms | 30 000 ms | `floor(cpus/2)` clamped to [1, 8] |
| `VitestProject.e2e(options)` | `"node"` | 120 000 ms | 60 000 ms | `floor(cpus/2)` clamped to [1, 8] |
| `VitestProject.custom(kind, options)` | — | — | — | — |

`custom` applies no defaults; the caller provides the full config.

**Mutation methods (all chainable):**

- `override(config)` — deep-merges a partial `TestProjectInlineConfiguration`.
  `name` and `include` are always preserved from the original.
- `addInclude(...patterns)` — appends glob patterns to `test.include`.
- `addExclude(...patterns)` — appends glob patterns to `test.exclude`.
- `addCoverageExclude(...patterns)` — accumulates patterns into the
  `coverageExcludes` collection (used by the plugin when building the root
  coverage config, not written into `test.*`).
- `clone()` — deep copy; the clone shares no mutable state with the original.
- `toConfig()` — returns the final `TestProjectInlineConfiguration` for Vitest.

---

## Discovery Algorithm

`discoverProjects(options?, cwd?)` in
`packages/plugin/src/utils/discover-projects.ts`:

1. **Locate workspace root.** Calls `findWorkspaceRootSync(cwd ?? process.cwd())`
   from `workspaces-effect`. Searches upward for `pnpm-workspace.yaml` or a
   `package.json` with a `workspaces` field. Throws with a descriptive error if
   no root is found — there is no silent fallback.

2. **Check process-level cache.** A module-level `Map<string, VitestProject[]>`
   keyed by workspace root path is consulted first. If a cached result exists, it
   is returned immediately without re-scanning the filesystem.

3. **List workspace packages.** Calls `getWorkspacePackagesSync(root)` from
   `workspaces-effect` to enumerate all packages.

4. **Iterate packages.** For each package:
   - Skip the root package (where `relativePath === "."`).
   - Skip packages that have no `src/` directory.
   - Scan `src/` for test files using `scanForTestFiles()` (recursive stat).
   - If a `__test__/` directory exists at the package root, scan it too.
   - Detect a `vitest.setup.{ts,tsx,js,jsx}` file at the package root.

5. **Name-suffix rule.** Count how many distinct test kinds were found (`unit`,
   `int`, `e2e`). If the count is 1, the project name is the bare package name
   (e.g., `vitest-agent-sdk`). If 2 or more, projects get a suffix:
   `vitest-agent-sdk:unit`, `vitest-agent-sdk:int`, `vitest-agent-sdk:e2e`.

6. **Emit `VitestProject` instances.** One per discovered kind. If no test files
   are found in a package that has `src/`, a placeholder unit project is emitted
   so the package name appears in analytics.

7. **Apply overrides.** If `options` was provided, `applyOverrides()` runs after
   all packages have been processed. See the Override System section below.

8. **Store in cache.** The result array is stored in the process-level cache
   keyed by workspace root, then returned.

---

## File Classification

`scanForTestFiles(dir)` recurses the directory tree and classifies each file
against three regex patterns tested in priority order:

| Kind | Pattern | Example match |
| ---- | ------- | ------------- |
| `e2e` | `/\.e2e\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `auth.e2e.test.ts` |
| `int` | `/\.int\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `db.int.test.ts` |
| `unit` | `/\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `utils.test.ts` |

E2E is tested before int, and int before unit, because the unit pattern is a
suffix of the other two. A single file matches at most one kind.

---

## Include/Exclude Glob Construction

For each `kind`, `makeProject` constructs the include and exclude arrays:

**Include patterns (relative to workspace root):**

```text
{pkg.relativePath}/src/**/{pattern}
{pkg.relativePath}/__test__/**/{pattern}   ← only if __test__/ exists
```

where `pattern` is the glob for that kind:

| Kind | Pattern |
| ---- | ------- |
| `unit` | `*.{test,spec}.{ts,tsx,js,jsx}` |
| `int` | `*.int.{test,spec}.{ts,tsx,js,jsx}` |
| `e2e` | `*.e2e.{test,spec}.{ts,tsx,js,jsx}` |

**Exclude patterns:**

- Unit projects additionally exclude `**/*.e2e.{test,spec}.*` and
  `**/*.int.{test,spec}.*` so int and e2e files found under `src/` are not
  picked up by the unit project.
- All kinds exclude helper subdirectories inside `__test__/`: `utils/`,
  `fixtures/`, and `snapshots/`. These are excluded as
  `{pkg.relativePath}/__test__/{dir}/**`.

---

## Override System

After scanning all packages, `applyOverrides()` applies the caller-supplied
`DiscoveryOptions`:

**Flat callback** (`ProjectsCallback`):

```ts
options({ projects })
```

Receives the full `VitestProject[]` in-place. The callback can call any
mutation method on any project.

**Per-kind object** (`{ unit?, int?, e2e? }`):

For each key present in the object, the projects filtered to that kind are
processed:

- If the value is a **`ProjectKindConfig`** (plain object), it is merged into
  every project of that kind via `p.override({ test: config })`.
- If the value is a **`ProjectKindCallback`** (function), a `Map<name,
  VitestProject>` scoped to that kind is constructed and passed to the
  callback. The callback mutates entries in-place via mutation methods.

Both callback forms may be async; `applyOverrides` awaits each one.

---

## Process-Level Cache

The cache is a module-level `Map<string, VitestProject[]>` in
`discover-projects.ts`. It is keyed by the absolute workspace root path
returned by `findWorkspaceRootSync`. The cache is populated after the first
call for a given root and is never explicitly invalidated — it lives until the
process exits.

**Why module-level, not `globalThis`.** Unlike `ensureMigrated`, the discovery
cache does not need cross-module-instance coordination. Vite's multi-project
pipeline does not call `discoverProjects` from multiple module instances; only
the root `vitest.config.ts` export calls it once.

---

## Conventions for This Repo

### Canonical `vitest.config.ts` pattern

```ts
export default async () => {
  const projects = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin({ mode: "agent", strategy: "own", mcp: true })],
    test: {
      projects,
      pool: "forks",
      coverage: {
        enabled: true,
        provider: "v8",
        thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  });
};
```

**Why `async () =>` instead of `defineConfig(async () => {})`.**
The async arrow function export preserves string-literal inference for options
like `provider: "v8"`. The `defineConfig` wrapper applies its own type
narrowing that can widen literals to `string` when the callback is async.

**Why `pool: "forks"`.** The `better-sqlite3` native binding is not
thread-safe. `forks` isolates each project in a child process, avoiding
`SQLITE_BUSY` and native-binding re-entry issues that appear with `threads`.

---

## Key Files

| File | Responsibility |
| ---- | -------------- |
| `packages/plugin/src/plugin.ts` | `AgentPlugin` namespace; `discover()` static method (lines 340-343) |
| `packages/plugin/src/utils/discover-projects.ts` | `discoverProjects()` scanner, process cache, `applyOverrides()`, regex patterns, `DiscoveryOptions` types |
| `packages/plugin/src/utils/vitest-project.ts` | `VitestProject` builder class, all static factories, mutation methods |
