---
type: Decision
title: Unified DiscoverStrategy + DiscoverBuilder
description: DiscoverStrategy collapses project detection and tag classification into one extensible contract, and AgentPlugin.discover() returns an immutable thenable DiscoverBuilder with an addProject escape hatch.
status: stable
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 1a2cff02d7bce9e875135930b69861074f1caaadb6ba127fdd7a430c022f53b9
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Unified DiscoverStrategy + DiscoverBuilder

## Context

Workspace discovery used to split project detection and tag classification
across two separate concerns — one class to declare tags and classify
files, a separate builder wrapping `TestProjectInlineConfiguration`, plus a
hand-rolled scanner special-casing every "no tests here" path. A consumer
who needed custom classification or a custom project shape had to fork the
scanner itself, because there was no single extension point covering both
jobs.

## Decision

`DiscoverStrategy` (`packages/plugin/src/utils/discover-strategy.ts`) is
an abstract base with two required members, `buildProject(input:
DiscoverInput): Promise<TestProjectInlineConfiguration | null>`
(`packages/plugin/src/utils/discover-strategy.ts`) and `classify(ctx):
ReadonlyArray<string>` (`packages/plugin/src/utils/discover-strategy.ts`),
plus `extend(options): DiscoverStrategy`
(`packages/plugin/src/utils/discover-strategy.ts`). `DiscoverStrategy.create({
tags, classify, buildProject })`
(`packages/plugin/src/utils/discover-strategy.ts`) builds a
`ConcreteDiscoverStrategy` from a single classify layer and a single
build-project layer; `.extend({ additionalTags?, buildProject?, classify?
})` (`packages/plugin/src/utils/discover-strategy.ts`) appends another
immutable layer rather than mutating the existing one — each extension
`classify` layer receives the parent layer's tag list plus the inherited
tag names (`ClassifyContext.inherited`,
`packages/plugin/src/utils/discover-strategy.ts`), and each extension
`buildProject` layer receives the prior layer's
`TestProjectInlineConfiguration | null` result
(`packages/plugin/src/utils/discover-strategy.ts`) so it can augment
or wholesale replace it. `DefaultDiscoverStrategy`
(`packages/plugin/src/utils/discover-strategy.ts`) is the built-in
unit/int/e2e-by-filename-suffix strategy the plugin uses when no strategy
is supplied.

A `null` return from `buildProject` is the one "skip this package" signal
the scanner recognizes. `DefaultDiscoverStrategy.buildProject`
(`packages/plugin/src/utils/discover-strategy.ts`) returns `null` when
neither `src/` nor `__test__/` contains test files, folding what used to be
three separate special cases (root package, missing `src/`, missing test
files) into one predicate a custom strategy can override outright.

`AgentPlugin.discover()` (`packages/plugin/src/plugin.ts`) returns a
`DiscoverBuilder` (`packages/plugin/src/plugin.ts`) — a
`PromiseLike<DiscoverResult>` with `.addProject(input): DiscoverBuilder`
(`packages/plugin/src/plugin.ts`) — rather than a plain `Promise`.
`makeDiscoverBuilder` (`packages/plugin/src/plugin.ts`) is immutable:
each `.addProject()` call returns a new builder carrying the accumulated
entries (`packages/plugin/src/plugin.ts`), and calling `.then()`
(or awaiting) triggers `discoverProjects(options)`
(`packages/plugin/src/plugin.ts`). `.addProject` is the documented
escape hatch for folders holding tests that are not workspace packages —
the alternative of a parallel options field or a discovery callback would
both fight the scanner's caching model, since neither can be
fingerprinted the way a no-arg call can.

`discoverProjects` (`packages/plugin/src/utils/discover-projects.ts`)
caches results in a process-level `Map` keyed by workspace root
(`packages/plugin/src/utils/discover-projects.ts`), but only on the
no-arg, no-added-entries call path — an explicit strategy or any
`.addProject()` chain always bypasses the cache
(`packages/plugin/src/utils/discover-projects.ts`, comment: "can't fingerprint
DiscoverStrategy instances"). An added-entry name or normalized absolute
path colliding with an existing workspace package, or an added entry whose
`buildProject` returns `null`, both throw on resolution rather than
silently skipping — added entries are explicit user intent, unlike the
routine null-skips the workspace-package scan produces.

`TestProjectInlineConfiguration` is the strategy's actual return type —
there is no fluent wrapper class between a strategy's `buildProject` and
the value `discoverProjects` collects; `discoverProjects` returns `{
projects: TestProjectInlineConfiguration[] | undefined; tags }`, with
`projects` left `undefined` (not an empty array) when no projects were
produced, so Vitest treats the config as having no projects rather than an
explicitly empty list. `classifyByFilename`, `classifyByDirectory`, and
`combineClassifiers` ship as standalone pure functions alongside
`findTestFiles` (the async glob walker `DefaultDiscoverStrategy.buildProject`
uses internally), letting a custom strategy compose classification
primitives without subclassing and without reimplementing
`node_modules`/`.git`/`dist` skipping or brace expansion.

The plugin option carrying the strategy is
`AgentPluginConstructorOptions.discoverStrategy`
(`packages/plugin/src/plugin.ts`); passing `false` disables the Vite
transform hook entirely (`packages/plugin/src/plugin.ts`).

## Alternatives rejected

- **Keep the split builder-plus-classifier design** and let consumers fork
  the scanner for custom behavior: rejected because forking the scanner
  duplicates the `node_modules`/`.git`/`dist` skipping and brace-expansion
  logic every consumer would have to keep in sync with upstream changes.
- **Three orthogonal skip conditions in the scanner** (root package,
  missing `src/`, missing test files) instead of one `null`-returning
  predicate: rejected because a consumer could not override one case
  without reimplementing all three; collapsing them into `buildProject`
  returning `null` gives a single overridable point that already produces
  the same default behavior.
- **A plain `Promise` return from `AgentPlugin.discover()`** instead of a
  thenable builder: rejected because it would force `.addProject`-style
  extension through a second parallel API (an options field or callback),
  neither of which composes with the no-arg cache the common case relies
  on.
- **Silent skip on an `.addProject` collision or null result**: rejected
  because an explicitly added entry is user intent; silently dropping it
  would surprise the caller in a way the routine workspace-package null
  skips do not.

## Consequences

- A custom `DiscoverStrategy` that needs both classification and project
  shaping implements both `classify` and `buildProject` on one object (or
  chains `.extend()` calls), rather than wiring two separate mechanisms
  together.
- Any code path that calls `AgentPlugin.discover()` with an explicit
  strategy or an `.addProject()` chain must accept that the process-level
  cache is bypassed for that call — repeated calls re-walk the filesystem.
- `discoverProjects` consumers must treat `projects: undefined` as "no
  projects," not as an error — Vitest's own contract distinguishes the two.
- A new classifier or project-shaping primitive is added as a standalone
  exported function next to `classifyByFilename` /
  `classifyByDirectory` / `combineClassifiers`, keeping strategy composition
  possible without subclassing.

## Related

- [Module: plugin](../modules/plugin.md)
