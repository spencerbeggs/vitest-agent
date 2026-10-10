---
type: Module
title: playground
description: A dogfooding sandbox workspace with intentional coverage gaps and a permanent deliberate bug, existing only as a live target for the agent plugin's TDD orchestrator and MCP tools during development.
kind: harness
resource: ../../playground
status: stable
tags:
  - testing
  - dx
sources:
  - id: playground-package-json
    resource: ../../playground/package.json
  - id: playground-readme
    resource: ../../playground/README.md
  - id: cache-ts
    resource: ../../playground/src/cache.ts
  - id: lifecycle-ts
    resource: ../../playground/src/lifecycle.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 7a21aa76a551a314c9b05d512276bae272f83d3045213f77b552801c9b3d13c2
---

# playground

## Purpose

`playground/` is not a real application — it exists so the Claude Code
plugin, its TDD orchestrator subagent, and the MCP tools have a live target
during development[^playground-readme]. It is the dogfood system's sandbox:
the plugin's behavior under load is verified by dispatching the
`tdd-task` orchestrator against this workspace (which carries intentional
defects) and auditing the result against a maintainer-held answer key kept
outside this tree and invisible to the orchestrator under test. See [the
agent plugin module](claude-code-plugin.md) for the dogfood
mechanics this workspace is the target of.

## Why the code is intentionally imperfect

Every gap here is deliberate and documented in the source file it lives
in, not accidental debt. `src/cache.ts` is a small TTL-aware in-memory
cache carrying two named gaps: `has()` is a fully correct method with
**zero test coverage**, and `size()` counts logically-expired-but-not-yet-evicted
entries because eviction is lazy (only on `get`), with no test exercising
the stale-count path[^cache-ts]. `src/cache.test.ts` exercises `set`/`get`,
`delete`, and `clear` thoroughly while leaving those two paths untouched on
purpose — a real coverage gap for `file_coverage` and the TDD orchestrator
to discover, not a bug for either to silently work around.

`src/lifecycle.ts` carries a permanent, deliberate off-by-one bug —
`sum(a, b)` returns `a + b + 1` — that exists specifically so a
`/dogfood --lifecycle` run has a genuine, reproducible failure to drive a
red-green-refactor cycle against[^lifecycle-ts]. The file itself must
persist between dogfood runs even though the `lifecycle.test.ts` that
exercises it is ephemeral, created and removed by each run, because
deleting the source file would leave the next run's freshly authored test
with no `file_edit` → `test_case` linkage to backfill
`test_cases.created_turn_id` — without that linkage,
`test_case_authored_in_session` resolves to false and blocks the
`red → green` phase transition the whole exercise is meant to drive.

Other source files (`strings.ts`, `notebook.ts`, `math.ts`) round out the
sandbox with ordinary, unremarkable code and matching tests, so not every
file here is a trap — only the ones documented as such are.

## Publish exclusion

`package.json` sets `"private": true` with no `publishConfig` and no
build scripts[^playground-package-json]. It is not one of the family's
publishable packages and needs no separate exclusion rule beyond that:
being private is sufficient, the same posture `plugin/package.json`
takes for a different reason (see [Decision
81](../decisions/81-ai-plugins-as-a-release-only-pnpm-workspace.md)).

## Test discovery

`pnpm-workspace.yaml` lists `playground` as a top-level workspace member
alongside `packages/*`, `plugin`, and `website`[^pnpm-workspace]. The
root `vitest.config.ts` calls `AgentPlugin.discover()` to auto-detect every
workspace package's test project rather than hand-listing them, so
`playground` is picked up the same way any `packages/*` member is — as
project `playground`, contributing to the repository's coverage numbers on
every test run[^vitest-config][^playground-readme]. `src/cache.test.ts`,
`src/lifecycle.ts`'s companion tests, and the rest of `playground/src/*.test.ts`
sit directly under the package's `src/`, which is one of the two locations
(`src/` and `__test__/`) `classifyTestPath` recognizes as discoverable —
see [Test-Path Classification](../invariants/test-path-classification.md).

[^playground-readme]: `playground/README.md`
[^playground-package-json]: `playground/package.json`
[^cache-ts]: `playground/src/cache.ts:63` (`has`), `playground/src/cache.ts:27` (lazy-eviction remark)
[^lifecycle-ts]: `playground/src/lifecycle.ts:16`
[^vitest-config]: `vitest.config.ts:5`
[^pnpm-workspace]: `pnpm-workspace.yaml:1`
