---
type: Interface
title: "AgentPlugin.discover() / DiscoverStrategy"
description: "The workspace-discovery API: AgentPlugin.discover(), discoverProjects(), the DiscoverStrategy contract, and the WalkerSyncOps filesystem seam the walks read through."
kind: api
resource: ../../packages/plugin/src/utils/discover-strategy.ts
status: stable
tags:
  - dx
  - testing
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
integrity:
  generated:
    body: efd1e5efb3b3c403
---

# AgentPlugin.discover() / DiscoverStrategy

## What stays stable

Auto-discovers Vitest project configurations from the workspace layout so
the root `vitest.config.ts` does not need a manual entry per package. One
`DiscoverStrategy` contract owns both project detection and tag
classification. See [`@vitest-agent/plugin`](../modules/plugin.md)
*DiscoverStrategy + discoverProjects* for the algorithm this API drives
and [AgentPluginOptions](./agent-plugin-options.md) for where
`discoverStrategy` sits on the plugin's constructor options.

## `AgentPlugin.discover()`

`packages/plugin/src/plugin.ts` (static on the `AgentPlugin` namespace).
Returns a `DiscoverBuilder` — both immediately usable as a
`PromiseLike<DiscoverResult>` and carrying a chainable `.addProject`:

```ts
type DiscoverResult = {
  projects: TestProjectInlineConfiguration[] | undefined;
  tags: TestTagDefinition[];
};

interface DiscoverBuilder extends PromiseLike<DiscoverResult> {
  addProject(input: { name: string; path: string }): DiscoverBuilder;
}

function discover(
  strategy?:
    | DiscoverStrategy
    | { strategy?: DiscoverStrategy; cwd?: string; maxDepth?: number; configure?: ProjectConfigureMap },
): DiscoverBuilder;
```

The argument is overloaded: pass a `DiscoverStrategy` directly, or an
options object with optional `strategy`, `cwd`, `maxDepth`, and
`configure`. With no argument, the builder uses `DefaultDiscoverStrategy`
and the current working directory.
Used in an async config export, because Vitest pre-parses project configs
before it evaluates Vite plugin hooks — a `configureVitest`-based
injection would arrive too late:

```ts
export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { ...(projects ? { projects } : {}), tags },
  });
};
```

**`.addProject({ name, path })`.** For a folder that holds tests but is
not itself a workspace package. The builder is immutable — every call
returns a new builder, so the original is unchanged and consumers can fork
safely. Conflict detection fires on resolution: a name or normalized-path
collision with an existing workspace package throws, and a `null` return
from `buildProject` for an added entry also throws — an added entry is
explicit user intent, so finding no tests is an error rather than a silent
skip (unlike the silent-by-default skip for an ordinary workspace
package).

**The materialized result.** `projects` is `undefined`, not an empty
array, when no projects were produced, so Vitest treats the config as
having no projects rather than an empty list; `tags` carries the active
strategy's `tagDefinitions`.

## `configure` (per-project `test` overrides)

`configure` is a `ProjectConfigureMap` — project name to
`ProjectTestOverrides`, where `ProjectTestOverrides` is every field Vitest
accepts on a project's inline `test` block except `name`:

```ts
type ProjectTestOverrides = Omit<NonNullable<TestProjectInlineConfiguration["test"]>, "name">;
type ProjectConfigureMap = Readonly<Record<string, ProjectTestOverrides>>;
```

After the strategy has built every project (workspace packages and
`.addProject` entries alike), each entry is shallow-merged over the matching
project's `test` block by the pure `applyProjectOverrides(configs,
overrides)` (exported from the package for custom pipelines). The
discovered `name` always wins, so an override cannot rename a project; the
merge is shallow, so an `include` or `exclude` here replaces the strategy's
list rather than appending to it. A key naming no discovered project throws
at config-load time, listing the discovered names — a typo cannot silently
leave a project on its defaults. Only a string `test.name` is keyed; a
project named through Vitest's object form is left untouched. Supplying
`configure` bypasses the process-level result cache, like `strategy` and
`.addProject`.

The motivating use is pool scheduling per package (issue #626): a package
whose suites share no module-level state runs markedly faster without
per-file worker isolation, while a package that spawns processes or calls
`process.chdir()` keeps the root's forks + isolation. The repo's own
`vitest.config.ts` does exactly this:

```ts
const noIsolation = { isolate: false } as const;
const { projects, tags } = await AgentPlugin.discover({
  configure: {
    "@vitest-agent/sdk": noIsolation,
    "@vitest-agent/engine": noIsolation,
    "@vitest-agent/ui": noIsolation,
    "@vitest-agent/reporter": noIsolation,
  },
});
```

`@vitest-agent/mcp` stays on the default: `process.chdir()` is unsupported
in worker threads, and its suites key state on `globalThis` (the migration
coordination cache, the discovery last-scan slot) that would be shared
between files in one worker — a single probe with isolation off did pass,
but the leak surface has not been audited. `cli`, `plugin`, `sidecar`, and
`playground` spawn processes or built bins and keep the default too.

## `discoverProjects()`

`packages/plugin/src/utils/discover-projects.ts`. Exported but
internal-leaning — `AgentPlugin.discover()` is the documented entry point.
Single options bag:

```ts
interface DiscoverProjectsOptions {
  strategy?: DiscoverStrategy;
  cwd?: string;
  additionalEntries?: ReadonlyArray<{ name: string; path: string }>;
  fs?: WalkerSyncOps;
  syncOps?: WorkspacesSyncOptions;
  maxDepth?: number;
  configure?: ProjectConfigureMap;
}
```

`configure` is the per-project override map described above; `fs` and
`syncOps` are the two injection points, defaulting to
`@effected/walker`'s `nodeWalkerSyncOps` and `@effected/workspaces`'s
`nodeSyncOps` so a whole discovery run is
drivable against a virtual volume in tests without changing production
behavior. Users that need to mutate projects post-discovery either extend
the strategy (preferred) or destructure the result and mutate the array
before spreading it into `defineConfig`.

`getLastDiscoveryScanTimestamp()` — exported from the same file — returns
the ISO timestamp of the most recent real disk scan this process
performed, or `undefined` if none has happened yet; a cache hit does not
update it. It reads a `Symbol.for("vitest-agent:discovery:last-scan-at")`
process-global slot so `@vitest-agent/mcp` can observe the value without
importing this module (which would be circular, since the plugin depends
on `mcp`, not the other way around).

## The `DiscoverStrategy` contract

`packages/plugin/src/utils/discover-strategy.ts:133`. An abstract class
carrying:

- **`tags`** — the readonly `Tag` list.
- **`tagDefinitions`** — a getter returning the matching
  `TestTagDefinition` list that flows into `test.tags`.
- **`buildProject(input): Promise<TestProjectInlineConfiguration | null>`**
  — `input` is a `DiscoverInput` (`{ name, path, relativePath,
  workspaceRoot, packageJson?, fs? }`). `null` means "this package
  contributes no project": silent for an ordinary package with no test
  shape at all, and warned-about once (pointing at
  `vitest-agent agent check-test-path`) when the package still *looks*
  test-shaped.
- **`classify({ module, tags, inherited }): ReadonlyArray<string>`** —
  synchronous; called by the plugin's Vite transform hook per test file.
- **`extend(options): DiscoverStrategy`** — returns a new immutable
  strategy layering `additionalTags`, an optional inheriting
  `buildProject`, and an optional inheriting `classify` on top of the
  current one. Extension classifiers see the inherited tag list via the
  `inherited` argument; extension `buildProject` implementations receive
  the prior layer's result as a second argument so they can augment or
  replace it.

Construct a base strategy with the static factory:

```ts
DiscoverStrategy.create({
  tags,                                // ReadonlyArray<Tag>
  buildProject: async (input) => { /* … */ return config | null; },
  classify: ({ module, tags, inherited }) => ["unit"],
});
```

The result is immutable; `.extend` layers run base-first, each extension
next.

## `DefaultDiscoverStrategy`

`packages/plugin/src/utils/discover-strategy.ts:252`. The strategy applied
when no override is passed.

- **Tags.** `unit`, `int` (timeout 60 000 ms), `e2e` (timeout 120 000 ms,
  retry 2 in CI, otherwise 0). CI is `@effected/env`'s `RuntimeEnv` rule —
  a truthy `GITHUB_ACTIONS`, or `CI` / `CONTINUOUS_INTEGRATION` set and not
  `false` / `0` — read when the strategy is constructed, not at module load.
- **`classify`.** Filename-suffix match: `.e2e.(test|spec).(ts|tsx|js|jsx)`
  → `["e2e"]`, `.int.(test|spec).(ts|tsx|js|jsx)` → `["int"]`, otherwise
  `["unit"]`.
- **`buildProject`.** One `findTestFiles` walk against
  `src/**/*.{test,spec}.{ts,tsx,js,jsx}` and
  `__test__/**/*.{test,spec}.{ts,tsx,js,jsx}`; `null` if neither bucket has
  matches. Otherwise emits a `TestProjectInlineConfiguration` with
  `extends: true`, `environment: "node"`, absolute include globs anchored
  at the package root for whichever bucket(s) matched, an unconditional
  exclude list (`configDefaults.exclude` plus a bounded glob per
  `NON_DISCOVERABLE_DIRS` entry under both include roots), and a
  `setupFiles` entry when `vitest.setup.(ts|tsx|js|jsx)` exists at the
  package root. The include-glob rule is the single implementation behind
  `classifyTestPath` in `@vitest-agent/sdk`'s `utils/test-location.ts`,
  which also backs the `check-test-path` CLI subcommand and the
  PreToolUse hook — a consumer that swaps in a custom `discoverStrategy`
  (or `discoverStrategy: false`) may collect paths this rule calls
  `invalid`, so `check-test-path` fails open (no verdict, hook no-ops) when
  it detects a non-default strategy in the consumer's config source.

## Classifier helpers

`packages/plugin/src/utils/classify-helpers.ts`. Pure `ClassifyFn`
builders for `DiscoverStrategy.create({ classify })` or
`.extend({ classify })`:

- **`classifyByFilename(map)`** — a record of exact suffix strings
  (matched with `endsWith`) or an array of `[RegExp, tags]` tuples; first
  match wins, no match returns an empty array.
- **`classifyByDirectory(map)`** — a directory-segment match on
  `relativePath` with slash boundaries, so `"integration"` matches
  `integration/foo.test.ts` but not `my-integration-tests/foo.test.ts`.
- **`combineClassifiers(...fns)`** — concatenates results in order and
  dedupes by tag name, first occurrence wins; an empty argument list
  always returns an empty array.

## `findTestFiles`

`packages/plugin/src/utils/find-test-files.ts`, exported as public API for
custom strategies:

```ts
function findTestFiles(
  dir: string,
  patterns: ReadonlyArray<string>,
  ops?: WalkerSyncOps,
): Promise<ReadonlyArray<string>>;
```

Expands each pattern with `@effected/walker`'s `descendSync` over the
injected `WalkerSyncOps` (default `nodeWalkerSyncOps`), prunes
`node_modules`, `.git`, and `dist` before descending, follows symlinked
directories under the walker's cycle guard, and skips an unreadable
directory. Each pattern compiles through `@effected/glob`'s `GlobPattern`
(the full minimatch dialect) with `{ dot: true }`, the option Vitest
passes for `test.include`; a pattern that fails to compile matches
nothing. Returns absolute paths. **Package boundary:** the walk stops at any
directory other than its own root that declares a `package.json` —
treated as an independent unit whose files belong to a separate discovery
pass — so an unanchored pattern starting from a package that structurally
contains other packages never double-counts a sibling's test files. The
check runs once per directory regardless of which pattern is being
matched, so even an anchored pattern is subject to it.

## `WalkerSyncOps` (the filesystem seam)

Every discovery walk — `findTestFiles`, `isTestShapedPackage`,
`detectSetupFile`, and the cache-signature walk — reads through
`@effected/walker`'s `WalkerSyncOps` (`{ fileSystem, path }`, the sync
`readdirSync` / `statSync` / `lstatSync` / `realpathSync` surface),
supplied by the caller and defaulting to `nodeWalkerSyncOps` at every
production call site. The plugin re-exports `WalkerSyncOps` as a type
only. A walk absorbs an unreadable directory as "contributes nothing";
the one read outside a walk, a stat of a single path, goes through
`statOrNull` in `packages/plugin/src/utils/walker-fs.ts`, which answers
`null` instead of throwing. A test hands the walks a virtual volume
through `memfsWalkerOps(handle)` (see [Convention: test
patterns](../conventions/test-patterns.md)).

## `Tag` and `Tag.make`

`packages/plugin/src/utils/tag.ts`. `Tag.make(name, options?)` constructs a
single tag with name validation: rejects empty names, the reserved words
`and`, `or`, `not`, and the forbidden characters `(`, `)`, `&`, `|`, `!`,
`*`, and whitespace — matching Vitest's own tag-filter expression syntax.
The `Tag` exposes its `TestTagDefinition` via `.definition`.

## `discoverStrategy: false`

Passed on `AgentPluginConstructorOptions` (see
[AgentPluginOptions](./agent-plugin-options.md)), this disables the Vite
transform hook that injects the tag prelude entirely — no tag injection,
no parsing cost per file. It has no effect on `AgentPlugin.discover()`
itself; discovery and tag injection are two separate features that happen
to share one `DiscoverStrategy` instance when both are active.
