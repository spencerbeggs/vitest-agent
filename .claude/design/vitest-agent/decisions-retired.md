---
status: archived
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-13
last-synced: 2026-09-13
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
installs a Vite `transform` hook that prepends a per-file tag prelude
applied to the file task at collection time (see
`packages/plugin/src/utils/inject-tags.ts` and Decision 23).

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

---

## Decision 35 (Original Form): MCP Resources — Two URI Schemes (Retired)

**Superseded by:** removal. The prompts half of the original Decision 35 was unaffected and lives on as [Decision 35 — Framing-Only MCP Prompts](./decisions.md#decision-35-framing-only-mcp-prompts).

**Why retired:** the resource subsystem was removed on the `bug/mcp-start` branch. MCP tools are the best-supported client surface for this project's needs; a static documentation corpus served as MCP resources gained little over shipping the same content as a Claude Code skill or serving it from an external HTTP server, while imposing a real build-time cost — the corpus had to ship inside the package's own build output to exist at all. That cost stopped paying for itself once the bundled corpus (`public/vendor/vitest-docs/` + `public/patterns/`) caused a boot failure under `@savvy-web/bundler` >= 1.0.0. Rather than chase the bundler-version coupling again, the whole resource surface — both URI schemes, the vendored Vitest-docs snapshot, the curated patterns library, and the Effect-based snapshot-maintenance pipeline that refreshed it (`packages/mcp/lib/scripts/`, driven by the repo-internal `.claude/skills/update-vitest-snapshot/` skill) — was deleted along with its 8 tests under `src/resources/`. Two of the curated patterns (agent-operability guidance: operating the tool as an agent, running tests via MCP, silencing leaking output, known issues) survive as the renamed plugin skill `operating-vitest-agent` (formerly `vitest-context`).

**What it was:** the MCP server exposed resources under two URI schemes. `vitest://docs/` exposed a vendored upstream Vitest documentation snapshot at `packages/mcp/public/vendor/vitest-docs/` — a pinned-tag, MIT-licensed capture of `vitest-dev/vitest`'s `docs/` tree, chosen over on-demand fetching because the MCP server is called from agent loops that may have no network egress. `vitest-agent://patterns/` exposed a curated patterns library at `packages/mcp/public/patterns/`, spanning testing patterns (testing Effect services, schemas, authoring a custom reporter) and agent-operability guidance. Each scheme registered an index resource and a per-page template URI (`{+path}` or `{slug}`), backed by a `list` callback that decoded the tree's manifest (`manifest.json` for the docs snapshot, `_meta.json` for patterns) validated against Effect Schema types, and emitted per-page `{ name, uri, title, description, mimeType, annotations? }` — the optional `annotations` field carried MCP 2025-11-25 `audience` and `priority` so a client could rank or filter before pulling content into context. `paths.ts`'s `resolveResourcePath` guarded against path traversal (no null bytes, no absolute paths, resolved path must stay within the resource root) since URI template variables came from clients. Both content trees lived under a package-root `public/` directory because `@savvy-web/bundler` only mirrors a package-root `public/` tree into the build output, not arbitrary `src/` subdirectories — an earlier `src/vendor/` + `src/patterns/` layout had shipped neither tree after a prior bundler migration (issue #96). The snapshot pipeline split fetch (`fetch-upstream-docs.ts`, sparse-clone via `execFileSync` with array args to avoid shell injection), build (`build-snapshot.ts`, denylist + strip frontmatter + scaffold placeholder descriptions), an annotations heuristic (`annotations-heuristic.ts`, single source for path-prefix → priority bands), and validation (`validate-snapshot.ts`, a commit-time quality gate) across separate scripts so the `update-vitest-snapshot` skill could pause between scaffolding and validation for an agent to author each page's "load when" description by hand.

---

## Decision 43 (Issue #184 Extension): Nested `__test__` Directory Support (Retired)

**Superseded by:** the current [Decision 43 — Discovery Cache Signature Invalidation + Cross-Package Last-Scan Handshake](./decisions.md#decision-43-discovery-cache-signature-invalidation--cross-package-last-scan-handshake), whose signature now fingerprints only `src/` and `__test__/` per package. The test-layout rule now has one implementation — `classifyTestPath` and its constants (`SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX`, `NON_DISCOVERABLE_DIRS`, `isTestFileName`) in `@vitest-agent/sdk`'s `utils/test-location.ts` — that the discovery include globs, the cache signature, the test-file walker, the plugin's tag-injection gate, the `vitest-agent agent check-test-path` CLI subcommand, and a new PreToolUse hook (`plugins/claude-code/hooks/pre-tool-use/test-location.sh`) all generate from or delegate to.

Two deliberate exceptions, both narrower than the layout rule itself. The nested-`package.json` boundary needs a filesystem probe, so it cannot live in the pure classifier; the CLI subcommand applies it and exits 1 (fail open) when it fires, matching where `findTestFiles` stops walking. And `test-location.sh` keeps the extension list as a bash `case` — a purely lexical prefilter that decides whether to spawn the CLI at all, not where a file belongs. Adding a new test-file extension therefore means touching two places: `TEST_FILE_GLOB_SUFFIX`/`isTestFileName` and that `case` list.

**Why retired:** issue #184 was an invalid report. Its file,
`lib/scripts/__test__/generate-schema.test.ts`, was never a valid test
location — a test file is discoverable only under a workspace `src/` or
`__test__/` directory. Widening the discovery include glob to an unanchored
`**/__test__/**` so it could reach that path taught the tool to accept a
layout it should have rejected. `@effected/workspaces` reports the
repository root itself as a workspace, so for that project the unanchored
pattern globbed the entire repository — collecting foreign test suites
against the wrong toolchain (279 transform failures in the reporting repo)
and becoming issue #227. The correct fix for #184 was to reject the
misplaced test, not to widen discovery to accept it: #184 was reclassified
as invalid and the include globs were re-anchored at the package root.

**What it was:** the cache signature fingerprinted every `__test__`
directory nested anywhere under a package, at any depth, via
`findNestedTestDirs` — not just a package-root `__test__/` — so an edit
under a path like `lib/scripts/__test__/` invalidated the cache the same
way a package-root `__test__/` edit did. The directory-finder walk and the
per-directory `mtimeMs` walk both pruned `node_modules`, `.git` and `dist`
before recursing, but deliberately did not stop at the nested-`package.json`
boundary that `findTestFiles` honors — over-including a fixture package's
own `__test__/` in the signature cost at most an extra rescan. The walk
recorded each such boundary as a `relPath:mtimeMs` marker in a third
signature segment (`::boundaries=…`), because adding or removing a nested
manifest changed where `findTestFiles` stopped descending without any test
file itself changing. The matching discovery-glob widening (`**/__test__/**`
in place of the anchored two-pattern form, plus a `**/dist/**` exclude and
helper-directory excludes rewritten to match at any depth) shipped
alongside this extension in `@vitest-agent/plugin@2.1.0` and was documented
as supported behavior in the `test-discovery` plugin skill.

---

## Decision 10 (counts-omitted form): The Step Summary Leaves Totals to Vitest (Retired)

**Superseded by:** Decision 10 in [./decisions.md](./decisions.md) — the
step-summary block now always carries a `### Totals` table.

**What it was:** `renderGithubSummary` emitted only the three conditional
sections — test classifications, coverage-target shortfalls, and the
coverage trend — and returned an empty array when all three were empty. The
premise was that Vitest's own `github-actions` reporter already wrote
pass/fail/skip counts and a flaky-tests section into the same
`$GITHUB_STEP_SUMMARY` file, so repeating a per-project breakdown would be
redundant noise multiplied across every project in a workspace, and that a
clean run should not leave a bare heading in the job summary.

**Why it didn't survive:** Phase 1 of the Vitest 5 migration sets
`jobSummary: { enabled: false }` on the `github-actions` reporter in
`configureVitest` (the plugin's `ConfigValidation` service warns when a user
re-enables it explicitly, precisely because two summaries would then appear
in one job). With Vitest's half off, the premise inverted: nobody was
writing the counts, and an all-green run produced a completely blank step
summary. The totals table became unconditional, and the same markdown was
reused for the `summary.md` report file rather than being step-summary-only.

---

## Decision 19: tRPC for MCP Routing (Retired)

**Superseded by:** [Decision 71 — Effect-Native MCP
Server](./decisions.md#decision-71-effect-native-mcp-server)

**Why retired:** tRPC bought type-safe procedures, a `createCallerFactory`
for transport-free tests and middleware — but it required zod for input
validation, which meant every tool input existed twice (the Effect Schema
in `tools/<name>.ts` and a hand-synced zod `inputSchema` in `server.ts`)
plus an Effect-Schema → JSON-Schema → `z.fromJSONSchema` bridge for
outputs. Three shipped bugs (#200, #246, #335) were the same hand-sync
failure. Effect v4's `McpServer` serves Effect Schemas natively, so the
router, the bridge, the MCP SDK and zod were all removed together. The
transport-free testing seam survives as `__test__/utils/caller.ts`'s
`makeCaller` (decodes params through the tool's schema and invokes
`toolHandlers[name]`) and the in-process harness over `Stdio.layerTest`.

**What it was:** the MCP server exposed one tool per tRPC procedure; the
tRPC context carried a `ManagedRuntime` for Effect service access and each
procedure called `ctx.runtime.runPromise(effect)`; zod was used only for
MCP tool input schemas; an `idempotentProcedure` middleware wrapped the
write tools.

---

## Decision 30 (PM-exec form): Plugin MCP Loader as PM-Detect + Exec (Retired)

**Superseded by:** [Decision 30 — Plugin MCP Loader Execs the Consumer's
`node_modules/.bin`](./decisions.md#decision-30-plugin-mcp-loader-execs-the-consumers-node_modulesbin)
and [Decision 70 — Carrier Pattern and Ranked
Layering](./decisions.md#decision-70-carrier-pattern-and-ranked-layering)

**Why retired:** the loader `exec`-replaced itself with
`<pm-exec> vitest-agent-mcp` (`pnpm exec`, `npx --no-install`, `yarn run`,
`bun x`) on the theory that "the user's PM already knows how to find and
execute project bins". That was only true because a pnpm plugin publicly
hoisted the transitive `@vitest-agent/mcp`; pnpm links direct-dependency
bins only, so a bare pnpm consumer had no bin for `pnpm exec` to find, and
each dispatch layer resolved differently per manager. Once the carrier
declares the bin itself, `node_modules/.bin/vitest-agent-mcp` exists under
every manager and the loader execs it directly; PM detection survives only
to word the install line in the not-installed message, and the fallback is
`npx --yes @vitest-agent/mcp`. The hook library's `detect_pm_exec` remains
as the last rung of `detect_vitest_agent_bin`.

**What it was:** detect the PM (`packageManager` field, then lockfile), then
`exec <pm-exec> vitest-agent-mcp` with `VITEST_AGENT_REPORTER_PROJECT_DIR`
exported; print PM-specific install instructions and exit 1 if the bin was
missing. The rationale said re-implementing bin resolution in the loader
was the wrong layer, and that `npx --no-install` prevented a registry fetch
inside Claude Code's MCP startup window.

---

## Decision 33 (hoisting note): Bins Reach Consumers via `publicHoistPattern` (Retired)

**Superseded by:** [Decision 70 — Carrier Pattern and Ranked
Layering](./decisions.md#decision-70-carrier-pattern-and-ranked-layering)

**Why retired:** the root `package.json` declared `@vitest-agent/cli` and
`@vitest-agent/mcp` directly as devDependencies and `pnpm-workspace.yaml`
kept a `publicHoistPattern` for both so their bins landed in the root
`node_modules/.bin` for the dogfood hooks, while published consumers relied
on `@savvy-web/pnpm-plugin-silk` publicly hoisting the transitive packages.
Both were workarounds for pnpm's direct-dependency-only bin linking. The
carrier makes them unnecessary: `@vitest-agent/plugin` declares both bins
as 4-line shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`,
so the root devDependencies shrank to the plugin alone, the hoist pattern
was deleted, and no pnpm plugin or manual install step is required for a
consumer to get working bins. The packed-install e2e proves it under npm,
pnpm, yarn and bun.

**What it was:** the closing sentence of Decision 33's "why regular deps"
paragraph, describing the root devDeps + `publicHoistPattern` arrangement
and the silk plugin's public hoist as the reason the bins resolved.

---

## Decision 50 (zod mechanics): `strict(shape)` over `z.strictObject` (Retired)

**Superseded by:** [Decision 50 — Strict MCP Tool
Inputs](./decisions.md#decision-50-strict-mcp-tool-inputs--reject-unknown-keys-never-silently-widen)
(the rule is unchanged; the mechanism moved) and [Decision
71](./decisions.md#decision-71-effect-native-mcp-server)

**Why retired:** the zod helper only existed because the served schema was
zod. With Effect's `McpServer` the served JSON Schema is generated from the
tool's Effect Schema, and strictness is applied by `registerStrictToolkit`
— `additionalProperties: false` on every object node of the served schema
plus a raw-payload walk before decoding — instead of by wrapping each
registration.

**What it was:** every `registerTool` input in `server.ts` went through a
local `strict(shape)` helper wrapping `z.strictObject` with a custom
`unrecognized_keys` message naming the offending key(s) and the accepted
params; nested shapes went through the same helper after issue #243; the
four tools that declared no `inputSchema` were the carve-out; validation
happened inside the MCP SDK's `validateToolInput` step. The structural
sweep and the two-direction `it.each` table survive in
`served-schema-strict.test.ts`.

---

## Decision 60 (zod-enum projection): Served Enums Built from the Exported Tuple (Retired)

**Superseded by:** [Decision 60 — Single-Source Served MCP
Discriminants](./decisions.md#decision-60-single-source-served-mcp-discriminants-from-the-tool-core)
(the tuple and its compile-time assertion stay; the projection is gone)

**Why retired:** `server.ts` imported each tool's discriminant tuple and
passed it to `z.enum(...)` so the served enum could not drift from the
union. There is no served zod schema any more: `registerStrictToolkit`
derives the served `oneOf` + `x-discriminator` from the union's own
generated JSON Schema, so the union is the single source on both sides and
the tuple's only runtime consumer is `served-enum-drift.test.ts`, which
asserts the served `oneOf` members match it.

**What it was:** `server.ts` built every served `z.enum(...)` from the
imported tuple and never spelled a literal list; `server-enum-drift.test.ts`
listed the tools over an `InMemoryTransport` client and compared each
served enum to its tuple. The "why not derive the zod enum from the Effect
schema" argument — that the served input was deliberately flatter than the
tRPC union — no longer applies because the served input *is* the union.

---

## Decision D19: Effect Schema at the MCP Boundary via `setRequestHandler` (Retired)

**Superseded by:** [Decision 71 — Effect-Native MCP
Server](./decisions.md#decision-71-effect-native-mcp-server)

**Why retired:** the MCP TypeScript SDK's high-level `registerTool` /
`server.tool(name, shape, …)` surfaces accepted only zod shapes, so using
Effect Schema at the boundary meant dropping to
`server.setRequestHandler(ListToolsRequestSchema, …)` /
`setRequestHandler(CallToolRequestSchema, …)` and emitting JSON Schema by
hand. Effect's own `McpServer` takes Effect Schemas directly, so the seam
and the SDK are gone. The `anyOf` → `oneOf` + `x-discriminator` rewrite the
decision described now lives in `registerStrictToolkit`, where it is also
load-bearing: a bare `anyOf` root fails `ToolJsonSchema`'s `type: "object"`
requirement and would `orDie` at registration.

**What it was:** `tools/list` returned
`Schema.toJsonSchemaDocument(EffectSchema)` per tool and `tools/call`
validated payloads via `Schema.decodeUnknownEffect`; resources and prompts
stayed on the SDK's high-level `registerResource` / `registerPrompt` API,
mixing the two layers. The brand-schema guidance (`Schema.UUID` as the base
for branded ids) survives in the current D19 stub.
