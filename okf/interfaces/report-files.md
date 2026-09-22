---
type: Interface
title: Report files
description: The versioned .vitest report files a reporter-independent reader consumes.
kind: wire
resource: ../../packages/plugin/src/utils/report-writer.ts
tags:
  - compat
  - observability
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-16T01:24:14Z
  body_sha256: 1862260e507ebbf6bf6f350f201ebc380a91dfcd08ce9ce9d1aae27161d44f24
sources:
  - id: report-writer
    resource: ../../packages/plugin/src/utils/report-writer.ts
  - id: run-report-file-schema
    resource: ../../packages/sdk/src/schemas/RunReportFile.ts
---

# Interface: report files

## What stays stable

`AgentPlugin({ report })` controls a pair of machine-facing files written
through Vitest 5's `vitest.createReport(scope)` into
`<config.root>/.vitest/<scope>/`.[^report-writer] They are independent of
console mode: an `agent`-mode run that prints nothing to stdout still
writes them, because a Claude Code hook, a CI step, or any reader with no
dependency on `@vitest-agent/sdk` needs a durable file, not a stream.

**Where the files land.** The default scope is `vitest-agent`, so the
default destination is `.vitest/vitest-agent/`. `report: { scope }`
renames the directory (rejecting `/`, `\`, `.`, `..`, and an empty
string — the scope is a single flat directory name, never a nested
path); `report: false` disables the files outright. `.vitest/` belongs
in a consumer's `.gitignore`.

**When files are dropped.** Report-file writing defaults **on** for the
`agent` and `ci` executors and **off** for `human` — a human at a
terminal already sees the rendered console output and gets no files
unless they opt in with `report: true`/`{ scope }`. `report: false`
disables them for any executor. A rejected write (disk full, permission
error) is caught and reported to stderr; it never fails the test run.
The handle is created lazily on the first report-targeted output —
`createReport(scope)` mkdirs eagerly and synchronously, so a run that
emits no report output leaves no directory behind — and every queued
write is flushed before `onTestRunEnd` resolves, including on the
UI-only short-circuit path, so the files exist by the time Vitest moves
on.[^report-writer]

**Filenames are flat.** Vitest's `Report.writeFile` resolves `filename`
against the scope directory with no `mkdir` and no containment check, so
a nested path or a `..` segment would either reject at write time or
escape the directory; the plugin rejects both up front so the error
message can name the offending filename.[^report-writer] `clean()` is
never called on the report handle — it would wipe a prior shard's
output and is a no-op under Vitest's `--merge-reports` anyway.

## The `run.json` shape

The default reporter emits two files into the scope directory:
`run.json` for machine readers and `summary.md` for humans reading a job
log. `run.json`'s envelope is defined by `RunReportFile` in
`packages/sdk/src/schemas/RunReportFile.ts`:[^run-report-file-schema]

```text
{ $schema?, schemaVersion: 1, generatedAt, reports: AgentReport[] }
```

This is a **public contract**, not the raw `AgentReport` encoding — the
envelope carries its own `schemaVersion` independent of any package
version, because the reader on the other end may not track
`@vitest-agent/sdk` releases at all. `reports` holds one `AgentReport`
per Vitest project in the run; each carries the coverage report's three
policy facets (`thresholds` / `targets` / `baselines`), the `failed[]`
modules, and the optional `consoleLeaks` block. `generatedAt` is an
ISO-8601 instant.

## The versioning promise

A contract change to `run.json`'s shape bumps `schemaVersion`, the
document's `$id` URL, and its committed path (`schemas/<version>/run.json`)
together — see
[Interface: published-json-schemas](published-json-schemas.md) for how
that document is generated, drift-checked, and served from GitHub raw
without any release-ordering step. A reader pins to the `schemaVersion` it understands
rather than assuming the shape is stable across major versions of the
family; the envelope's whole purpose is to let that reader detect drift
without importing `@vitest-agent/sdk` at all.

[^report-writer]: `../../packages/plugin/src/utils/report-writer.ts`
[^run-report-file-schema]: `../../packages/sdk/src/schemas/RunReportFile.ts`
