---
status: current
module: vitest-agent
category: architecture
created: 2026-05-07
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 95
related:
  - ../components.md
  - ./plugin.md
  - ../testing-strategy.md
  - ../decisions.md
  - ./ui.md
dependencies: []
---

# Project Discovery (AgentPlugin.discover())

Auto-discovers Vitest project configurations from the pnpm workspace layout
so the root vitest.config.ts does not require manual per-package entries.
A single DiscoverStrategy contract is the one extension point that owns both
project detection and tag classification. The plugin exposes a thenable
DiscoverBuilder that supports an addProject method for folders that hold
tests but are not workspace packages. Test-kind differentiation rides
Vitest 4.1 native tags (see [../decisions.md](../decisions.md) Decision 23,
with the strategy unification captured in Decision 39).

---

## Purpose

Without discovery, every package added to the monorepo requires a manual
entry in the root vitest.config.ts. The discovery system reads the
workspace layout once per process, asks the active strategy to build a
project config per package, and returns a ready-to-use array for
Vitest's test.projects key plus a tags array for test.tags. A null
return from the strategy's buildProject method means the package
contributes no Vitest project — that single predicate covers every skip
case (root package, missing src/, etc.). Folders
outside the workspace that hold tests register through
.addProject({ name, path }) on the returned builder.

---

## Public API

### AgentPlugin.discover(strategy?)

Defined in packages/plugin/src/plugin.ts. Returns a DiscoverBuilder that
is both immediately usable as a Promise and exposes an addProject method
for non-package folders. Awaiting it (or calling .then) resolves a
DiscoverResult.

```ts
type DiscoverResult = {
  projects: TestProjectInlineConfiguration[] | undefined;
  tags: TestTagDefinition[];
};

interface DiscoverBuilder extends PromiseLike<DiscoverResult> {
  addProject(input: { name: string; path: string }): DiscoverBuilder;
}

function discover(
  strategy?: DiscoverStrategy | { strategy?: DiscoverStrategy; cwd?: string },
): DiscoverBuilder;
```

The argument is overloaded: pass a DiscoverStrategy directly to use a
custom strategy, or pass an options object with optional strategy and
cwd. With no argument, the builder uses DefaultDiscoverStrategy and the
current working directory.

The builder is immutable: each addProject call returns a new builder;
the original is unchanged. Resolution merges workspace packages with the
accumulated additional entries and runs every entry through the active
strategy's buildProject method. Conflict detection fires when an added
entry's name matches an existing workspace package name, or when its
normalized absolute path collides with a workspace package path. An
added entry whose buildProject returns null also throws — added entries
are explicit user intent, so finding no tests is an error rather than a
silent skip.

The materialized DiscoverResult mirrors what the plugin needs:
projects is undefined when no projects were produced (Vitest interprets
this as "no projects" rather than as an empty list), and tags carries
the strategy's tagDefinitions.

### DiscoverProjectsOptions

Defined in packages/plugin/src/utils/discover-projects.ts. The lower-level
discoverProjects function (exported but internal-leaning) takes a single
options bag:

```ts
interface DiscoverProjectsOptions {
  strategy?: DiscoverStrategy;
  cwd?: string;
  additionalEntries?: ReadonlyArray<{ name: string; path: string }>;
}
```

Users that need to mutate projects post-discovery either extend the
strategy (preferred) or destructure the result and mutate the array
before spreading it into defineConfig.

### getLastDiscoveryScanTimestamp

Exported (@public) from the same file. Returns the ISO timestamp of the most recent real disk scan `discoverProjects` performed in this process, or `undefined` if no scan has happened yet. Cache hits do not update it. It reads the `Symbol.for("vitest-agent:discovery:last-scan-at")` process-global slot that `discoverProjects` writes on every real scan, so a caller in another package (notably `@vitest-agent/mcp`) can observe the value without importing this module. See [../decisions.md](../decisions.md) Decision 43.

### DiscoverStrategy abstract class

Defined in packages/plugin/src/utils/discover-strategy.ts. The single
extension point for everything the discovery pipeline does. A
DiscoverStrategy carries:

- tags — the readonly Tag list (the typed Tag instances).
- tagDefinitions — a getter returning the matching TestTagDefinition list
  that flows into test.tags.
- buildProject(input) — async function that takes a DiscoverInput
  ({ name, path, relativePath, workspaceRoot, packageJson? }) and
  returns either a TestProjectInlineConfiguration or null. Null means
  "this package has no tests, skip it." This single predicate covers
  every skip case.
- classify({ module }) — synchronous function that takes a ModuleInfo
  and returns the tag list for that file. Called by the plugin's Vite
  transform hook.
- extend(options) — returns a new immutable strategy that layers
  additionalTags, an optional inheriting buildProject, and an optional
  inheriting classify on top of the current strategy.

Construct a base strategy with the static factory:

```ts
DiscoverStrategy.create({
  tags,                                // ReadonlyArray<Tag>
  buildProject: async (input) => { /* … */ return config | null; },
  classify: ({ module, tags, inherited }) => ["unit"],
});
```

The result is immutable. Chaining .extend produces a new strategy whose
classify and buildProject layers run in order: the base layer first,
each extension layer next. Extension classifiers see the inherited tag
list from the prior layers via the inherited argument; extension
buildProject implementations receive the prior layer's
TestProjectInlineConfiguration | null as a second argument so they can
augment or replace it.

### DefaultDiscoverStrategy concrete class

Defined in the same file. The strategy applied when no override is
passed.

- **Tags.** unit, int (timeout 60 000 ms), e2e (timeout 120 000 ms,
  retry 2 in CI, otherwise 0).
- **classify.** Filename-suffix match — files ending in .e2e.(test|spec).
  (ts|tsx|js|jsx) get ["e2e"], files ending in .int.(test|spec).
  (ts|tsx|js|jsx) get ["int"], everything else falls through to
  ["unit"].
- **buildProject.** Scans the package's `src/` and `__test__/` directories for test files via `findTestFiles`. Returns null if neither directory contains a match. Otherwise emits a `TestProjectInlineConfiguration` with `extends: true`, the test name set from the package name, `environment: "node"`, absolute include globs covering whichever of `src/` and `__test__/` produced matches, an exclude list, and a `setupFiles` entry for `vitest.setup.(ts|tsx|js|jsx)` at the package root when present. The exclude list prepends Vitest's `configDefaults.exclude` (`**/node_modules/**`, `**/.git/**`) ahead of the helper-subdirectory globs (`utils`, `fixtures` and `snapshots` inside `__test__/`). The prepend is load-bearing: a custom `test.exclude` replaces Vitest's defaults rather than merging, so without it the broad `__test__/**` include re-walks into nested `__test__/.../node_modules/**` and Vitest runs dependencies' own test files (e.g. zod's tests under fixture `node_modules`).

The include globs use absolute paths so the same configs work whether
the consuming vitest.config.ts lives at the monorepo root or inside a
single package.

### Classifier helpers

Pure, standalone classifier builders exported alongside DiscoverStrategy
from packages/plugin/src/utils/classify-helpers.ts. Each helper returns a
ClassifyFn suitable for DiscoverStrategy.create({ classify }) or
.extend({ classify }).

- **classifyByFilename(map).** Maps filename suffixes to tag arrays.
  Accepts either a record (keys are exact suffix strings such as
  ".int.test.ts", matched with String.prototype.endsWith) or an array of
  [RegExp, tags] tuples (matched with RegExp.test). First match wins; no
  match returns an empty array.
- **classifyByDirectory(map).** Maps directory segments to tag arrays.
  A module matches when its relativePath contains the segment with
  slash boundaries — that is, the segment appears as a complete path
  segment rather than as a substring of a different segment. The key
  "integration" matches integration/foo.test.ts and src/integration/
  foo.test.ts but not my-integration-tests/foo.test.ts.
- **combineClassifiers(...fns).** Concatenates the results of each
  classifier in order and deduplicates by tag name; first occurrence
  wins. An empty argument list produces a classifier that always
  returns an empty array.

### findTestFiles utility

packages/plugin/src/utils/find-test-files.ts. Async file walker exposed
as part of the public API so users that build custom strategies do not
have to reinvent it.

```ts
function findTestFiles(
  dir: string,
  patterns: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>>;
```

Walks dir recursively via node:fs/promises. Skips node_modules, .git,
and dist by default. Each pattern is compiled to a regex via an inline
glob-to-regex compiler supporting the subset used by this codebase —
double-asterisk (any path segments), single-asterisk (any non-slash
characters), question mark, and brace expansion such as {ts,tsx,js,jsx}.
Returns absolute paths.

### Tag and Tag.make

packages/plugin/src/utils/tag.ts. Tag.make(name, options?) constructs a
single tag with name validation: rejects empty names, the reserved words
and, or, and not, and the forbidden characters open-paren, close-paren,
ampersand, pipe, exclamation mark, asterisk plus whitespace. The
forbidden character set matches Vitest's tag-filter expression syntax.
The Tag carries its definition via the .definition getter (the shape
that flows into test.tags).

---

## Discovery Algorithm

The unified algorithm in discoverProjects:

1. **Locate workspace root.** Calls findWorkspaceRootSync(cwd ??
   process.cwd()) from workspaces-effect. Searches upward for
   pnpm-workspace.yaml or a package.json with a workspaces field.
   Throws with a descriptive error if no root is found — there is no
   silent fallback.

2. **Consult process-level cache with a directory signature.** A module-level Map keyed by workspace root is checked first, but only when neither strategy nor additionalEntries was supplied (the no-arg path); any explicit strategy or added entry bypasses the cache because strategy instances cannot be fingerprinted. Each cache entry now stores `{ result, signature }` where the signature is a cheap fingerprint of every package's `src/` and `__test__/` directories (recursive relative-path + `mtimeMs` pairs, sorted — no file contents read, via `computeDirSignature` / `computeWorkspaceSignature`). On the cacheable path the signature is recomputed and compared before the cached result is returned; a mismatch means a test file was added, removed, moved or renamed since the entry was written, so discovery falls through to a full rescan and refreshes the entry. This fixes issue #100, where the long-lived MCP server returned stale project include-globs after test files moved on disk (symptom: a silent drop of ~1290 tests when `*.test.ts` moved from `src/` to `__test__/`).

3. **Resolve the strategy.** Defaults to a fresh DefaultDiscoverStrategy
   when none was supplied.

4. **List workspace packages** via getWorkspacePackagesSync(root).

5. **Iterate packages.** For each package, call strategy.buildProject
   with { name, path, relativePath, workspaceRoot }. A null return means
   the package contributes no project. Any non-null config is appended
   to the result list. Workspace package names and normalized paths are
   accumulated into lookup sets for the next step.

6. **Iterate additionalEntries.** For each entry from .addProject
   calls: resolve the path against the workspace root if relative,
   normalize, then check for collisions against the workspace name set
   and path set. A name collision or path collision throws. Call
   strategy.buildProject with the resolved input. A null return throws
   (added entries are explicit user intent — silently skipping would
   surprise the caller). Any non-null config is appended.

7. **Materialize tags** as a copy of strategy.tagDefinitions.

8. **Materialize projects.** If the result list is empty, projects is
   undefined so Vitest treats the config as having no projects rather
   than an empty list. Otherwise projects holds the accumulated configs.

9. **Cache and record scan timestamp (no-options path only).** Store `{ result, signature }` for the workspace root. Every real disk scan (not a cache hit) also records an ISO timestamp via `recordDiscoveryScanTimestamp()`, readable through the exported `getLastDiscoveryScanTimestamp()`. Both use a process-global slot keyed by `Symbol.for("vitest-agent:discovery:last-scan-at")` so `@vitest-agent/mcp` can surface the last real scan time on `run_tests` results without importing this module (which would be a circular dependency). See [../decisions.md](../decisions.md) Decision 43.

---

## Tag Injection Transform

The classifier from the active DiscoverStrategy decides which tags apply
per test file. Tags reach individual test and it calls via a Vite
transform hook installed by AgentPlugin:

1. AgentPlugin resolves options.discoverStrategy. The default is a fresh
   DefaultDiscoverStrategy; passing false disables the transform
   entirely (no tag injection, no parsing cost per file).
2. For every test file id, the transform calls
   strategy.classify({ module }) where module is the parsed ModuleInfo.
3. If the classifier returns an empty tag list, the transform short-
   circuits and returns null. Otherwise it calls
   injectTags(source, tags) in packages/plugin/src/utils/inject-tags.ts.
4. injectTags prepends one guarded prelude per file via magic-string (source maps preserved) that unions the classified tags into the current file task through vitest's public `TestRunner.getCurrentSuite()` static. The runner unions parent tags into every suite and test it registers, so every declaration form inherits the tags — native it/test, wrapper testers like `@effect/vitest`'s `it.effect`, test.extend aliases, numeric-timeout calls and dynamically registered tests. No parsing happens; any failure (changed collector shape, missing `TestRunner` export) degrades to untagged tests via try/catch plus optional chaining, never a crash.
5. Vitest's runner reads the resulting tags per test, which feeds the
   tag-filter expression syntax (such as pnpm vitest --tags-filter
   "unit" or --tags-filter "e2e and not flaky").

The file-level prelude replaced a per-call acorn AST rewrite of test/it options arguments, which corrupted wrapper testers with a `(name, self, timeout)` signature and collected zero tests (issue #133). See the tag injection transform section in [./plugin.md](./plugin.md) for the full semantics and failure modes.

---

## Conventions for This Repo

### Canonical vitest.config.ts pattern

```ts
import { defineConfig } from "vitest/config";
import { AgentPlugin } from "@vitest-agent/plugin";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.basic;
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "stream", agent: "agent" },
        coverageTargets: coverage.coverageTargets,
      }),
    ],
    test: {
      ...(projects ? { projects } : {}),
      tags,
      pool: "forks",
      coverage: {
        enabled: true,
        provider: "v8",
        thresholds: coverage.thresholds,
      },
    },
  });
};
```

After the reporter-package restructure the plugin imports `DefaultVitestAgentReporter` from `@vitest-agent/reporter` as its built-in factory and owns no rendering itself. The live Ink mount is owned by `DefaultVitestAgentReporter`, which subscribes to the plugin's run-event `PubSub` channel. Users no longer import a reporter factory or a live-mount helper.

When the workspace contains a folder that holds tests but is not a
workspace package, chain addProject:

```ts
const { projects, tags } = await AgentPlugin.discover()
  .addProject({ name: "integration", path: "./test-only" });
```

The console behavior comes from the per-executor console matrix and the
onRunEvent tap. See [../decisions.md](../decisions.md) Decision 37 for the
rationale and [../decisions-retired.md](../decisions-retired.md) for the
superseded single-flag form.

**Why async arrow rather than defineConfig(async () => {}).**
The async arrow function export preserves string-literal inference for
options such as provider: "v8". The defineConfig wrapper applies its own
type narrowing that can widen literals to string when the callback is
async.

**Why pool: forks.** The better-sqlite3 native binding is not
thread-safe. forks isolates each project in a child process, avoiding
SQLITE_BUSY and native-binding re-entry issues that appear with
threads.

---

## Key Files

| File | Responsibility |
| ---- | -------------- |
| packages/plugin/src/plugin.ts | AgentPlugin namespace; static discover method; DiscoverBuilder thenable; conflict detection; transform hook installation |
| packages/plugin/src/utils/discover-projects.ts | discoverProjects unified algorithm, signature-invalidated process cache, `getLastDiscoveryScanTimestamp` last-scan handshake, conflict detection across workspace and additional entries |
| packages/plugin/src/utils/discover-strategy.ts | DiscoverStrategy abstract class, DefaultDiscoverStrategy, ModuleInfo, DiscoverInput, ClassifyFn, ClassifyContext, the immutable layered concrete implementation |
| packages/plugin/src/utils/classify-helpers.ts | classifyByFilename, classifyByDirectory, combineClassifiers — pure ClassifyFn builders |
| packages/plugin/src/utils/find-test-files.ts | Async glob walker with inline glob-to-regex compiler; default skip set of node_modules, .git, dist |
| packages/plugin/src/utils/tag.ts | Tag class with Tag.make factory and name validation |
| packages/plugin/src/utils/inject-tags.ts | Prepends a guarded per-file prelude that unions the classified tags into the file task via TestRunner.getCurrentSuite(); no parsing |
