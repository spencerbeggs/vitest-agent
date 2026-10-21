---
type: Invariant
title: Test-path classification — one rule for what is a discoverable test
description: classifyTestPath is the single pure rule for whether a path is a discoverable test file and, when not, what verdict it earns; the plugin's discovery walker and the CLI's check-test-path command both derive from it rather than re-implementing the layout rule.
tags: [testing]
resource: ../../packages/sdk/src/utils/test-location.ts
sources:
  - id: test-location
    resource: ../../packages/sdk/src/utils/test-location.ts
  - id: test-location-test
    resource: ../../packages/sdk/__test__/test-location.test.ts
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
integrity:
  generated:
    body: fb2704361e8bc4a9
---

# Test-path classification — one rule for what is a discoverable test

## Property

`classifyTestPath(workspaces, filePath)` is the one function in the
family that decides whether a given path is a discoverable Vitest test
file, and if not, whether that is a deliberate exclusion or a misplaced
file — encoded as the `valid` / `excluded` / `invalid` `TestPathVerdict`,
or `null` when the rule has nothing to say about the path at
all[^test-location]. Every other consumer that needs this answer —
`@vitest-agent/plugin`'s discovery walker (via the shared `SRC_DIR`,
`TEST_DIR`, `TEST_HELPER_DIRS`, and `TEST_FILE_GLOB_SUFFIX` constants) and
`@vitest-agent/cli`'s `agent check-test-path` subcommand (which calls
`classifyTestPath` directly) — derives its answer from this one function
rather than re-implementing the layout rule.

The rule itself: a test file is discoverable only under `<workspace>/src/**`
or `<workspace>/__test__/**`, with the exception of a helper directory
(`fixtures`, `snapshots`, or `utils`) that sits *directly* under
`__test__/` — a same-named directory nested deeper (for example
`__test__/unit/utils/`, the natural mirror of `src/utils/`) is an
ordinary, discoverable suite, not an exclusion[^test-location]. A path
that crosses one of `node_modules`, `.git`, or `dist` — or that no
supplied workspace contains — earns no verdict at all (`null`), which
callers must treat as "fail open," never as `invalid`.

## Mechanism

`classifyTestPath` is pure: it takes the caller's list of
`WorkspaceLike` entries (`{ name, path }`) and the path to classify, finds
the deepest containing workspace with `findOwningWorkspace` (longest
matching path wins, so a nested package outranks a repository root that
also contains the file), and then inspects only the path segments
relative to that workspace root[^test-location]. If any segment names a
`NON_DISCOVERABLE_DIRS` entry, the function returns `null` rather than a
verdict — a vendored dependency or an installed package carries its own
test layout, and rendering a verdict on it would incorrectly advise
moving someone else's file. Otherwise the function inspects only the
first segment (`src` → `valid`) or, for `__test__`, only the segment
directly beneath it (a helper dir there → `excluded`, anything else →
`valid`); every other first segment is `invalid`, with a
`suggestedPath` pointing at `<workspace>/__test__/<basename>`.

Because the function takes no filesystem access and no injected port, it
cannot detect a nested `package.json` marking an independent unit whose
tests belong to a different discovery pass — that check needs a
filesystem probe, and the function's own documentation states the rule
explicitly: a caller with filesystem access applies that check itself and
fails open when it fires. `@vitest-agent/cli`'s `agent check-test-path`
is exactly that caller: it resolves the workspace root via
`findWorkspaceRootSync`, probes for a nested `package.json`, and exits 1
with empty stdout on any of the fail-open conditions (no containing
workspace, an unreadable or non-default-`DiscoverStrategy` config, a
`NON_DISCOVERABLE_DIRS` segment, or a nested manifest) — printing the
`{ verdict, workspace, suggestedPath }` JSON only when
`classifyTestPath` renders an actual verdict. `@vitest-agent/plugin`'s
discovery layer consumes the same module's exported constants
(`SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX`,
`NON_DISCOVERABLE_DIRS`) to build its include/exclude globs, rather than
re-deriving the segment logic independently, so the glob-based walker and
the pure classifier agree by construction on what a workspace's `src/`
and `__test__/` boundaries include.

`packages/sdk/__test__/test-location.test.ts` is the function's pinning
test — it exercises `isTestFileName`, `findOwningWorkspace`, and
`classifyTestPath` directly over constructed `WorkspaceLike`
lists[^test-location-test].

## What a refactor would have to break

Because `classifyTestPath` is the single function every consumer calls
(directly, for the CLI, or through its re-exported constants, for the
plugin's glob builder), a change to the layout rule cannot land in one
consumer without also reaching the other unless the two are deliberately
decoupled — editing the plugin's include-glob construction without
touching `test-location.ts` produces globs that no longer agree with what
`classifyTestPath` would render a verdict on, which is exactly the
regression issue #251 named: a broader match on `TEST_HELPER_DIRS`
against every intermediate segment, rather than only the one directly
under `__test__/`, silently swept whole nested suites out of discovery.
A refactor that changed the "only the segment directly under `__test__/`
counts as a helper" rule to check every intermediate segment instead
would flip `__test__/unit/utils/some.test.ts` from `valid` to `excluded`,
and `test-location.test.ts`'s coverage of that exact nesting shape would
catch it. A refactor that added a new `NON_DISCOVERABLE_DIRS` entry
without updating the plugin's pruning walk (which prunes those same
directory names before recursing, rather than filtering results after)
would desynchronize what the classifier considers "no verdict" from what
discovery actually walks into. And removing the fail-open contract — for
example, having `classifyTestPath` render `invalid` for an unowned path
instead of `null` — would break `agent check-test-path`'s explicit
distinction between "advise moving this file" and "say nothing, because
this repository has no opinion about a path outside every known
workspace."

See [Convention: Test layout](../conventions/test-layout.md) for the
human-facing statement of the `src/` / `__test__/` rule this function
enforces mechanically, and [Interface: Discover API](../interfaces/discover-api.md)
for the plugin's public discovery surface that consumes these same
constants.

[^test-location]: ../../packages/sdk/src/utils/test-location.ts
[^test-location-test]: ../../packages/sdk/__test__/test-location.test.ts
