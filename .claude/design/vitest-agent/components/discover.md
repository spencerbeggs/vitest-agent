---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-07
updated: 2026-05-12
last-synced: 2026-05-12
completeness: 95
related:
  - ./plugin.md
  - ../testing-strategy.md
  - ../decisions.md
  - ./ui.md
dependencies: []
---

# Project Discovery (`AgentPlugin.discover()`)

Auto-discovers Vitest project configurations from the pnpm workspace layout
so `vitest.config.ts` does not require manual per-package entries. Walks
workspace packages, emits **one project per package**, and returns a
companion `tags` array carrying the active `TagStrategy`'s tag definitions.
Test-kind differentiation moved to Vitest 4.1's native tag system (see
[../decisions.md](../decisions.md) Decision 23) — there is no more
per-kind project splitting.

---

## Purpose

Without discovery, every package added to the monorepo requires a manual
entry in `vitest.config.ts`. The discovery system reads the workspace
layout once per process, scans for test files, and returns a ready-to-use
array for Vitest's `test.projects` key plus a `tags` array for `test.tags`.
It also emits placeholder projects for packages that have a `src/`
directory but no test files yet, so every package name appears in
analytics even before its first test is written.

---

## Public API

### `AgentPlugin.discover(options?)`

Defined in `packages/plugin/src/plugin.ts`. Returns

```ts
Promise<{
  projects: TestProjectInlineConfiguration[];
  tags: TestTagDefinition[];
}>
```

for direct destructuring into `test.projects` and `test.tags`.

```ts
export async function discover(
  options?: DiscoveryOptions,
): Promise<{ projects: TestProjectInlineConfiguration[]; tags: TestTagDefinition[] }>
```

Internally delegates to `discoverProjects(options)` and maps each
`VitestProject` through `.toConfig()`. The tag definitions come from the
active `TagStrategy` (the default unless one is explicitly supplied or
disabled).

### `DiscoveryOptions`

Defined in `packages/plugin/src/utils/discover-projects.ts`.

```ts
type ProjectsCallback = (ctx: { projects: VitestProject[] }) => void | Promise<void>;
type DiscoveryOptions =
  | ProjectsCallback
  | {
      callback?: ProjectsCallback;
      tagStrategy?: TagStrategy | false;
    };
```

Two shapes are accepted:

- **Flat callback** — receives `{ projects: VitestProject[] }` and can
  mutate the full list in-place.
- **Object form** — `{ callback?, tagStrategy? }` where `callback` is the
  same flat callback and `tagStrategy` overrides the default. Pass
  `tagStrategy: false` to disable tag injection entirely; the discovery
  result then carries an empty `tags` array.

The legacy per-kind override object (`{ unit?, int?, e2e? }`) was removed
along with the colon-suffix project naming convention.

### `TagStrategy` and `Tag`

Defined in `packages/plugin/src/utils/tag-strategy.ts` and
`packages/plugin/src/utils/tag.ts`. `Tag.make(name, options?)` constructs
a single tag with name validation (rejects empty names, the reserved
words `and`/`or`/`not`, and the forbidden characters `()&|!*` plus
whitespace — Vitest's tag-filter expression syntax). `TagStrategy.create`
accepts `{ tags, classify }` and produces a strategy with a base layer.
`extend({ additionalTags?, classify? })` chains an extended layer that
sees the inherited tag list and may augment it. `TagStrategy.default` is
the baked-in strategy used when no override is provided.

```ts
const DEFAULT_TAGS = [
  Tag.make("unit"),
  Tag.make("int", { timeout: 60_000 }),
  Tag.make("e2e", { timeout: 120_000, retry: process.env.CI ? 2 : 0 }),
];

const defaultClassify = ({ module }) => {
  if (/\.e2e\.(test|spec)\.(ts|tsx|js|jsx)$/.test(module.filename)) return ["e2e"];
  if (/\.int\.(test|spec)\.(ts|tsx|js|jsx)$/.test(module.filename)) return ["int"];
  return ["unit"];
};
```

The strategy is consumed in two places:

1. **Discovery** — `AgentPlugin.discover()` returns `tags:
   strategy.tagDefinitions` so Vitest registers the tag names.
2. **Plugin transform** — `AgentPlugin()` installs a Vite `transform` hook
   that calls `strategy.classify({ module })` per test file and rewrites
   every `test()` and `it()` call's options argument to add the resolved
   `tags` array. The AST rewrite lives in
   `packages/plugin/src/utils/inject-tags.ts` (acorn + acorn-typescript
   parse, magic-string for source-map-preserving edits). See
   [./plugin.md](./plugin.md) for the transform pipeline detail.

### `VitestProject` class

Defined in `packages/plugin/src/utils/vitest-project.ts`. A mutable
builder wrapping `TestProjectInlineConfiguration`. Private constructor;
all construction goes through static factories.

`discoverProjects()` only calls `.unit(...)` now — every package gets
one Vitest project regardless of which test kinds live inside it. The
`int` and `e2e` factories remain on the class for callers that
hand-construct projects but the discovery scanner no longer uses them.

**Static factories:**

| Factory | `environment` | `testTimeout` | `hookTimeout` | `maxConcurrency` |
| ------- | ------------- | ------------- | ------------- | ---------------- |
| `VitestProject.unit(options)` | `"node"` | — | — | — |
| `VitestProject.int(options)` | `"node"` | 60 000 ms | 30 000 ms | `floor(cpus/2)` clamped to [1, 8] |
| `VitestProject.e2e(options)` | `"node"` | 120 000 ms | 60 000 ms | `floor(cpus/2)` clamped to [1, 8] |
| `VitestProject.custom(kind, options)` | — | — | — | — |

`custom` applies no defaults; the caller provides the full config.

**Mutation methods (all chainable):**

- `override(config)` — deep-merges a partial
  `TestProjectInlineConfiguration`. `name` and `include` are always
  preserved from the original.
- `addInclude(...patterns)` — appends glob patterns to `test.include`.
- `addExclude(...patterns)` — appends glob patterns to `test.exclude`.
- `addCoverageExclude(...patterns)` — accumulates patterns into the
  `coverageExcludes` collection (used by the plugin when building the
  root coverage config, not written into `test.*`).
- `clone()` — deep copy; the clone shares no mutable state with the
  original.
- `toConfig()` — returns the final `TestProjectInlineConfiguration` for
  Vitest.

---

## Discovery Algorithm

`discoverProjects(options?, cwd?)` in
`packages/plugin/src/utils/discover-projects.ts`:

1. **Locate workspace root.** Calls
   `findWorkspaceRootSync(cwd ?? process.cwd())` from `workspaces-effect`.
   Searches upward for `pnpm-workspace.yaml` or a `package.json` with a
   `workspaces` field. Throws with a descriptive error if no root is
   found — there is no silent fallback.

2. **Check process-level cache.** A module-level
   `Map<string, DiscoverProjectsResult>` keyed by workspace root path
   is consulted first when called with no options. The cache fires
   only on the no-options call path so it does not have to fingerprint
   a `TagStrategy` instance. If a cached result exists for that root,
   it is returned immediately without re-scanning.

3. **Resolve options.** Splits the (function | object | undefined)
   `DiscoveryOptions` into `{ callback, strategy }`. The strategy
   defaults to `TagStrategy.default`; passing `tagStrategy: false`
   keeps `strategy` as `false` and produces an empty `tags` array.

4. **List workspace packages.** Calls `getWorkspacePackagesSync(root)`
   from `workspaces-effect`.

5. **Iterate packages.** For each package:
   - Skip the root package (`relativePath === "."`).
   - Skip packages with no `src/` directory.
   - Detect the optional `__test__/` directory at the package root.
   - Detect a `vitest.setup.{ts,tsx,js,jsx}` file at the package root
     and add it to `setupFiles`.
   - Compose include globs covering both `<pkg>/src/**/*.{test,spec}.*`
     and (if present) `<pkg>/__test__/**/*.{test,spec}.*`.
   - Add helper-subdir excludes (`utils/`, `fixtures/`, `snapshots/`)
     under `__test__/`.

6. **Emit one `VitestProject` per package** via `VitestProject.unit({
   name: pkg.name, include, overrides })`. The project name is the
   bare workspace package name — no colon suffix. Test-kind
   differentiation comes from tags, not project names.

7. **Run callback if provided.** The optional `ProjectsCallback` is
   awaited with `{ projects }` so callers can apply cross-cutting
   mutations.

8. **Compute `tags`.** If the strategy is `false`, `tags` is empty;
   otherwise `tags = [...strategy.tagDefinitions]`.

9. **Cache (no-options path only).** The `DiscoverProjectsResult` is
   stored in the process cache for that workspace root.

---

## Tag Injection Transform

The classifier from `TagStrategy.classify()` decides which tags apply per
test file. Tags reach individual `test()` / `it()` calls via a Vite
`transform` hook installed by `AgentPlugin()`:

1. `AgentPlugin` resolves the configured `tagStrategy` (the same
   instance discovery used) and registers a `transform(code, id)` hook.
2. For every test file, the hook calls
   `injectTags({ code, classify: (module) => strategy.classify({ module }) })`
   in `packages/plugin/src/utils/inject-tags.ts`.
3. `injectTags` parses with acorn + acorn-typescript, walks each
   `test(...)` / `it(...)` call expression, and uses magic-string to
   rewrite the options argument to include
   `tags: [...existing, ...resolved]`. Source maps are preserved.
4. Vitest's runner reads the resulting `tags` array per test, which
   feeds Vitest's tag-filter expression syntax
   (`pnpm vitest --tags-filter "unit"`,
   `--tags-filter "e2e and not flaky"`, etc.).

The transform is the working path because Vitest's internal runner
reads tags from `test()` / `it()` options at parse time, not from
JSDoc comments. Two earlier smoke tests in
`packages/plugin/__test__/runner-injection.test.ts` document the
JSDoc transform approach that was abandoned.

---

## Conventions for This Repo

### Canonical `vitest.config.ts` pattern

```ts
import { defineConfig } from "vitest/config";
import { AgentPlugin } from "vitest-agent-plugin";
import { createLiveInk, eventSourcedReporter } from "vitest-agent-ui";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const live = createLiveInk();
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "ink", agent: "agent" },
        reporter: eventSourcedReporter,
        onRunEvent: live.event,
        mcp: true,
        coverageThresholds: AgentPlugin.COVERAGE_LEVELS.basic,
        coverageTargets: AgentPlugin.COVERAGE_LEVELS.standard,
      }),
    ],
    test: {
      projects,
      tags,
      pool: "forks",
      coverage: {
        enabled: true,
        provider: "v8",
      },
    },
  });
};
```

The pre-2.0 `mode: "agent", strategy: "own"` form is retired — the
per-executor `console` matrix and the `onRunEvent` tap replace it. See
[../decisions.md](../decisions.md) Decision 37 for the rationale and
[../decisions-retired.md](../decisions-retired.md) for the previous
form.

**Why `async () =>` instead of `defineConfig(async () => {})`.**
The async arrow function export preserves string-literal inference for
options like `provider: "v8"`. The `defineConfig` wrapper applies its
own type narrowing that can widen literals to `string` when the
callback is async.

**Why `pool: "forks"`.** The `better-sqlite3` native binding is not
thread-safe. `forks` isolates each project in a child process, avoiding
`SQLITE_BUSY` and native-binding re-entry issues that appear with
`threads`.

---

## Key Files

| File | Responsibility |
| ---- | -------------- |
| `packages/plugin/src/plugin.ts` | `AgentPlugin` namespace; `discover()` static method; transform hook installation |
| `packages/plugin/src/utils/discover-projects.ts` | `discoverProjects()` scanner, process cache, `DiscoveryOptions` resolution, regex patterns |
| `packages/plugin/src/utils/vitest-project.ts` | `VitestProject` builder class, all static factories, mutation methods |
| `packages/plugin/src/utils/tag.ts` | `Tag` class with `Tag.make` factory and name validation |
| `packages/plugin/src/utils/tag-strategy.ts` | `TagStrategy.create`, `extend`, `default`; `ClassifyBaseFn` / `ClassifyExtendedFn` types |
| `packages/plugin/src/utils/inject-tags.ts` | AST rewriter that injects `tags: [...]` into every `test()` / `it()` call's options argument |
