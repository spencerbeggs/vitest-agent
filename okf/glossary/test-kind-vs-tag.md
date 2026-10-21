---
type: Glossary
title: Test kind vs. Vitest tag
description: >-
  "Test kind" (unit/int/e2e) is a filename-derived classification this
  repository invents and injects as a Vitest tag at collection time; it is
  not something Vitest itself understands or a test declares.
tags: [dx, testing, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: test-location
    resource: ../../packages/sdk/src/utils/test-location.ts
  - id: discover-strategy
    resource: ../../packages/plugin/src/utils/discover-strategy.ts
  - id: inject-tags
    resource: ../../packages/plugin/src/utils/inject-tags.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: vitest-tags-filter
    resource: https://vitest.dev/guide/cli.html
integrity:
  generated:
    body: 9e28ff4f1953d300
---

# Test kind vs. Vitest tag

Vitest 5 ships a native tagging feature: any test or suite can carry
arbitrary string tags, and `--tags-filter` selects a run by them. This
repository layers a second, unrelated concept — **test kind** — on top of
that mechanism, and the two are easy to conflate because the kind ends up
expressed *as* a tag.

## Test kind: filename-derived, not declared

A test's kind (`unit`, `int`, or `e2e`) is never written by the test's
author. `DefaultDiscoverStrategy.classify` derives it purely from the
filename suffix: `.e2e.test.*` / `.e2e.spec.*` → `"e2e"`, `.int.test.*` /
`.int.spec.*` → `"int"` (60 s timeout), everything else discoverable under
`src/` or `__test__/` → `"unit"` (`packages/plugin/src/utils/discover-strategy.ts:222-239`).
The discoverable locations themselves are `SRC_DIR` (`"src"`) and `TEST_DIR`
(`"__test__"`), the single source of truth in
`packages/sdk/src/utils/test-location.ts:4-7`.

## Injection: a Vite transform, not test-file code

Once a file is classified, `injectTags` prepends a two-line guarded prelude
to the compiled source that calls Vitest's `TestRunner.getCurrentSuite()`
and unions the classified tags into the file's task
(`packages/plugin/src/utils/inject-tags.ts:23-33`). Vitest's own runner then
unions parent tags into every suite and test it registers, so the injected
kind tag reaches every declaration form — native `it`/`test`, wrapper
testers, `test.extend` aliases, and dynamically registered tests — without
the test file ever mentioning it. `vitest.config.ts` threads the resulting
`tags` map straight into `defineConfig({ test: { tags } })`
(`vitest.config.ts:8-12`).

## The collision

Because the kind rides Vitest's native tag mechanism, `vitest --tags-filter
"e2e"` genuinely works — but it works by querying an *injected* tag, not a
tag any test declared, and there is no way to look at a test file's source
and see its kind; it is entirely a function of where the file lives and
what its filename ends in. Someone reaching for Vitest's tag feature and
expecting to find `unit`/`int`/`e2e` declared inline, or assuming a
`test.tags` value the author wrote controls kind classification, will be
looking in the wrong place — the filename and directory decide it, and a
custom `DiscoverStrategy.classify` can layer additional tags on top but
never on the same file-suffix axis without also changing what
`classifyTestPath` accepts as a valid location.

One retired detail: nested `__test__/` directories deeper than a package
root (issue #184) are not discovered at all — only `<package>/src/` and
`<package>/__test__/`, both anchored at the package root, are scanned.

See [Convention test-layout](../conventions/test-layout.md),
[Invariant test-path-classification](../invariants/test-path-classification.md),
and [Decision 23](../decisions/23-vitest-native-tag-classification.md).
