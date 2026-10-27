---
type: Decision
status: stable
title: Per-Invocation Coverage Directory for MCP Runs
description: Every run_tests call gets its own throwaway coverage reports directory so concurrent runs never clobber each other's on-disk artifacts.
tags: [mcp, testing]
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
integrity:
  generated:
    body: 965e3c8ceb720f0d
---

# Per-Invocation Coverage Directory for MCP Runs

## Context

Vitest's v8 coverage provider removes its reports directory at run start
(`coverage.clean` defaults to `true`). Two runs sharing one checkout — an
MCP `run_tests` call alongside a Bash `vitest run`, or two concurrent MCP
calls — share `./coverage` and delete each other's `.tmp` files mid-flight,
so one dies with an `ENOENT` on a `coverage-N.json` file
(`packages/mcp/src/tools/run-tests.ts`). Forcing
`coverage.enabled: false` for MCP runs was tried and reverted because it
overrides intentional user configuration, and serializing MCP runs against
every other Vitest process in the checkout is not enforceable.

## Decision

Each `run_tests` invocation acquires its own temporary
`coverage.reportsDirectory` (`coverageTempDirectory` in
`packages/mcp/src/tools/run-tests.ts`: `FileSystem.makeTempDirectory`
with the prefix `vitest-agent-cov-`, under `Effect.acquireRelease`). The
directory is passed to `createVitest` as `coverage: { reportsDirectory }`,
a field-level merge, so `enabled`, the provider, and thresholds all still
come from the user's own config — only `reportsDirectory` is replaced.

A failure to create the directory — a full or read-only tmpdir — is
mapped to the run's step failure and returned as the tool's normal
`{ kind: "error", message }` result instead of escaping the handler. The
release removes the directory (best-effort: a removal failure is ignored) when the run's scope closes, after the
Vitest instance is closed, on every exit path, even when `close()`
itself rejects.

## Alternatives rejected

- **Forcing `coverage.enabled: false` on every MCP run:** already tried and
  reverted — it silently discarded a user's intentional "coverage on by
  default" configuration and forced a parallel Bash `--coverage` call just
  to populate `file_coverage` rows.
- **Serializing MCP runs against every other Vitest process in the
  checkout:** rejected as unenforceable — there is no reliable way for the
  MCP process to detect or lock against an arbitrary concurrent `vitest
  run` invoked outside its control.

## Consequences

- Final coverage artifacts (HTML, LCOV) from MCP-driven runs land in the
  throwaway directory rather than `./coverage`, and are deleted afterward.
  This is acceptable because the MCP path never reads coverage from disk —
  the plugin's `CoverageAnalyzer` consumes the in-memory `CoverageMap` via
  `onCoverage` and persists it to SQLite, which is what every MCP coverage
  tool queries. A user who wants the on-disk report runs Vitest directly.
- This decision covers the MCP `run_tests` path only. The plain-CLI half
  of the same clobber — an agent's Bash `vitest run` racing another
  process in the checkout — is a separate surface, covered by [Decision
  62](./62-per-process-coverage-directory-for-plain-cli-agent-runs.md).
- A caller relying on `./coverage` existing after an MCP-driven run will
  not find it there; any tooling that reads coverage artifacts off disk
  must be pointed at SQLite instead.
