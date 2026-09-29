---
type: Decision
status: stable
title: Per-Process Coverage Directory for Plain-CLI Agent Runs
description: Why an agent-executor plain-CLI vitest run gets its coverage.reportsDirectory rewritten to a fresh per-process temp directory, and why that rewrite and its cleanup are guarded and scoped to only the agent executor.
tags: [architecture, testing, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: fe9c8025ee424172444771b7359af9225803759d0d5325f86cbbd1a512e1c745
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Per-Process Coverage Directory for Plain-CLI Agent Runs

## Context

An earlier decision isolated `coverage.reportsDirectory` for MCP `run_tests` calls, but the plain-CLI path was still exposed: an agent running `vitest run` from Bash shares `./coverage` with any other Vitest process in the checkout (a second agent, a watch mode, an MCP call), and the v8 provider's `clean: true` default `rm -rf`s that directory at run start, so one run deletes the other's `.tmp` files mid-flight and dies with an `ENOENT` on a coverage temp file.

## Decision

A pure decision function, `resolveCoverageDirIsolation({ executor, coverageEnabled, env, configured })` (`packages/plugin/src/utils/resolve-coverage-dir-isolation.ts`), returns one of three outcomes, and `configureVitest` acts on it once per Vitest run (guarded by a `WeakSet` keyed on the Vitest instance, since `configureVitest` fires per project while `coverage.reportsDirectory` is root-level config — `packages/plugin/src/plugin.ts`):

- `keep` — leave the configured directory alone. Returned whenever coverage is disabled (UI-only mode), whenever the executor is not `agent`, and when `VITEST_AGENT_COVERAGE_DIR_ISOLATION` is one of `off`/`0`/`false` (`packages/plugin/src/utils/resolve-coverage-dir-isolation.ts`).
- `explicit` — use `VITEST_AGENT_COVERAGE_DIR=<path>` verbatim; no `mkdtemp`, no cleanup (`packages/plugin/src/utils/resolve-coverage-dir-isolation.ts`). The escape hatch for an agent that wants the on-disk report somewhere it can read.
- `isolate` — the default for the `agent` executor with coverage on: rewrite `coverage.reportsDirectory` to a fresh `mkdtempSync`-produced directory and register a best-effort `rmSync` in `vitest.onClose()` (`packages/plugin/src/utils/resolve-coverage-dir-isolation.ts`).

Only the `agent` executor is ever relocated — a human's `./coverage` output and CI's configured directory are exactly what those executors expect to find on disk, so they are never touched.

Cleanup lives in `onClose`, not `onTestRunEnd`: for a non-watch `vitest run`, `Vitest.report("onTestRunEnd", …)` fires and returns before `Vitest.reportCoverage()` writes the lcov/html artifacts into `reportsDirectory`. Deleting the directory from inside the reporter's `onTestRunEnd` would race that write and reintroduce the exact `ENOENT` the fix exists to prevent. `startVitest`'s non-watch path calls `ctx.close()` in a `finally` strictly after `ctx.start()` — and therefore after `reportCoverage()` — resolves, so `vitest.onClose(fn)` is the earliest hook guaranteed to run after the provider is done with the directory. The rewrite itself is always early enough: `configureVitest` runs inside `Vitest.setServer`, well before the lazy coverage-provider initialization reads the config.

## Alternatives rejected

Leaving the shared `./coverage` directory in place and asking agents to serialize their own Vitest invocations was rejected as unenforceable — nothing prevents a second agent, a watch-mode session, or a concurrent MCP `run_tests` call from touching the same checkout. Deleting the temp directory from the reporter's `onTestRunEnd` hook was tried conceptually and rejected because of the ordering race against `reportCoverage()` described above.

## Consequences

`file_coverage` rows come from the in-memory istanbul `CoverageMap` the reporter receives in `onCoverage`, never from files under `reportsDirectory`, so relocating the directory changes nothing about what lands in SQLite. Coverage-provider failures are unchanged: they already surface through `unhandledErrors` and a non-zero exit rather than a silent exit-0, and this still fires with the directory rewritten. The trade-off accepted is the same as the MCP-side isolation: an agent's on-disk html/lcov output lands in a throwaway directory. The agent reads coverage from the MCP tools, which query SQLite, so nothing it consumes moves; `VITEST_AGENT_COVERAGE_DIR` exists for the rare case where it needs the files directly.
