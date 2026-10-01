---
type: Convention
title: Test layout — flat __test__ directories, src co-location, and kind-by-suffix
description: "A test file is discoverable only under a workspace package's src/ or __test__/, only three helper dirs sit directly under __test__/ are excluded, and a subprocess-spawning test must carry the .e2e.test.ts suffix or it times out in CI."
tags: [testing, dx]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: test-location
    resource: ../../packages/sdk/src/utils/test-location.ts
    title: classifyTestPath and the layout constants
  - id: discover-strategy
    resource: ../../packages/plugin/src/utils/discover-strategy.ts
    title: DefaultDiscoverStrategy — tags, timeouts, and filename-suffix classification
  - id: vitest-config
    resource: ../../vitest.config.ts
    title: Root vitest.config.ts — AgentPlugin.discover() and test.tags
  - id: check-test-path
    resource: ../../packages/cli/src/commands/agent.ts
    title: "`vitest-agent agent check-test-path` subcommand"
generated:
  by: okfit/claude-code
  at: 2026-10-01T00:18:42Z
  body_sha256: 5ae61f181d25f25f3cfb383a2024018ed15fc2faa4b2cfe25415326dc16acff8
---

# Test layout — flat __test__ directories, src co-location, and kind-by-suffix

## Put a test file under a package's `src/` or its `__test__/`, never anywhere else

`classifyTestPath` is the single source of truth for where a test file may
live[^test-location]. It walks the supplied workspaces, finds the deepest one
that contains the path, and looks at the first path segment relative to that
workspace root: `src` is always `valid` (co-located tests are supported), and
`__test__` is `valid` unless the segment directly beneath it is a helper
directory. Anything else — a test file sitting at the package root, under
`lib/`, or under any directory name other than `src`/`__test__` — is
`invalid`, and the classifier returns a `suggestedPath` that relocates it
under `<package>/__test__/<basename>`. A path that never resolves to a
workspace, or that crosses a directory discovery never walks into
(`node_modules`, `.git`, `dist`), returns `null` — not a verdict, and callers
must fail open rather than treat that as invalid.

`@vitest-agent/plugin`'s `discoverProjects` scanner and `DiscoverStrategy`
consume the same constants (`SRC_DIR`, `TEST_DIR`, `TEST_FILE_GLOB_SUFFIX`),
so the include globs a Vitest project actually runs and the rule
`classifyTestPath` states agree by construction — one of them changing
without the other changing is a bug, not a design choice.

## Only `fixtures/`, `snapshots/`, and `utils/` directly under `__test__/` are excluded

The helper-directory exclusion is anchored at the test root: `classifyTestPath`
looks only at the segment immediately beneath `__test__/` (its "root
intermediate" segment), not at every intermediate segment on the path[^test-location].
A suite at `__test__/fixtures/foo.test.ts` is `excluded`; a suite at
`__test__/unit/utils/foo.test.ts` is an ordinary discoverable test, because
`utils` there is not the segment directly under `__test__/`. Checking every
intermediate segment used to sweep nested suites like that out of discovery
silently — issue #184's report was reclassified as invalid rather than
"fixed" by widening the include glob, because the reporting file was never a
legal test location in the first place; the correct fix anchored the include
globs at each package root instead of loosening them to an unanchored
`**/__test__/**` pattern that would have globbed the whole repository.

## Classify test kind by filename suffix, not by directory or config

`DefaultDiscoverStrategy` registers three Vitest-native tags — `unit`, `int`,
`e2e` — and a `classify` method that matches the test module's filename
against two regexes: `.int.test.*` / `.int.spec.*` becomes `"int"`,
`.e2e.test.*` / `.e2e.spec.*` becomes `"e2e"`, and everything else defaults
to `"unit"`[^discover-strategy]. The plugin's Vite `transform` hook injects a
per-file prelude that applies the resolved tags to the file's task, so every
suite and test declared in that file inherits them at collection time. Filter
a run by kind with Vitest's native tag-expression syntax
(`--tags-filter "unit"`), not with a project name or a directory pattern —
`AgentPlugin.discover()` feeds both `projects` and `tags` into
`defineConfig({ test })`[^vitest-config].

## Give a subprocess-spawning test the `.e2e.test.ts` suffix, never plain `.test.ts`

The `int` tag carries a 60 s timeout and the `e2e` tag a 120 s timeout plus
retry `2` in CI (`@effected/env`'s CI rule, read when the strategy is
constructed: `CI=false` or `CI=0` does not count); the `unit` tag carries neither,
so an unsuffixed test falls through to Vitest's own 5 s default
timeout[^discover-strategy]. A test that spawns a real process — a built CLI
or MCP bin, a competing-process advisory-lock race — routinely exceeds 5 s
between spawn and handshake. Name that file `*.e2e.test.ts` so the suffix
classifier grants it the 120 s budget; a plain `.test.ts` doing the same work
classifies as `unit` and times out under CI load rather than under the code
being wrong.

## Use `vitest-agent agent check-test-path` for the one check the pure classifier cannot make

`classifyTestPath` is pure, so the nested-`package.json` boundary — a
directory inside a workspace package that declares its own manifest and is
therefore an independent unit whose tests belong to a different discovery
pass — needs a filesystem probe `classifyTestPath` itself cannot perform.
`vitest-agent agent check-test-path <path>` applies that additional check
against the resolved project directory and exits non-zero (fails open) when
it fires, matching where the discovery file walker stops
descending[^check-test-path].

## Related concepts

- [test-path-classification invariant](../invariants/test-path-classification.md)
  states `classifyTestPath` as a code-enforced property rather than a
  followed convention.
- [discover-api interface](../interfaces/discover-api.md) documents
  `AgentPlugin.discover()` and `DiscoverStrategy` from the consumer's side.
- [Decision 23 — Vitest-Native Tag Classification](../decisions/23-vitest-native-tag-classification.md)
  is the rationale for classifying kind by tag rather than by a separate
  project or directory.
- [test-kind-vs-tag glossary entry](../glossary/test-kind-vs-tag.md) names the
  collision between this repository's filename-derived `unit`/`int`/`e2e`
  kinds and Vitest's own general-purpose tag-expression feature.

[^test-location]: ../../packages/sdk/src/utils/test-location.ts
[^discover-strategy]: ../../packages/plugin/src/utils/discover-strategy.ts
[^vitest-config]: ../../vitest.config.ts
[^check-test-path]: ../../packages/cli/src/commands/agent.ts
