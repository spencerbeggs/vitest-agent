---
type: Decision
title: Report Files Are a Versioned Public Contract
description: The run.json envelope Vitest 5's createReport writes carries its own schemaVersion independent of any package version, published as a JSON Schema document, because it is read by code with no dependency on @vitest-agent/sdk.
status: draft
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-16T01:24:14Z
  body_sha256: 210039ba7dce93053005b03c1c7fb2d2c5ac9fdc2ca1f2e30c672c2084235e5d
sources:
  - id: run-report-file-schema
    resource: ../../packages/sdk/src/schemas/RunReportFile.ts
  - id: schemastore-config
    resource: ../../packages/sdk/lib/configs/schemastore.config.ts
  - id: run-report-schema-host
    resource: ../../packages/sdk/lib/configs/run-report-schema.ts
  - id: published-schema-doc
    resource: ../../schemas/5.0/run.json
  - id: schema-drift-e2e
    resource: ../../packages/sdk/__test__/schema-drift.e2e.test.ts
  - id: report-writer
    resource: ../../packages/plugin/src/utils/report-writer.ts
  - id: plugin-report-option
    resource: ../../packages/plugin/src/plugin.ts
  - id: rendered-output-type
    resource: ../../packages/sdk/src/formatters/types.ts
---

# Report Files Are a Versioned Public Contract

## Context

Vitest 5 added `vitest.createReport(scope)`, a supported way for a
reporter to write files into `.vitest/<scope>/`. vitest-agent uses it for
two files: `run.json` for machine readers — a Claude Code hook, a CI step,
an agent that never saw the terminal — and a human-facing summary. A
machine reader of `run.json` may have no dependency on
`@vitest-agent/sdk` at all, so the file's shape cannot be "whatever
`AgentReport` happens to encode to this month" and drift silently with a
package version bump.

## Decision

`run.json` is `{ $schema, schemaVersion: 1, generatedAt, reports:
AgentReport[] }` — an envelope carrying its own contract version
independent of any npm package version.[^run-report-file-schema] It is
published as a JSON Schema document at
`https://raw.githubusercontent.com/spencerbeggs/vitest-agent/main/schemas/5.0/run.json`
— the committed repo-root `schemas/5.0/run.json`, which GitHub serves
raw, so the file on `main` is the served document with no second
copy.[^published-schema-doc] `@effected/schemastore-cli` generates it
from the Effect Schema via `packages/sdk/lib/configs/schemastore.config.ts`
(objects emitted open, `onExcessProperty: "ignore"`, to match how
`RunReportFile` decodes),[^schemastore-config] whose hosted identity is
`HostedSchema.github({ repo: "spencerbeggs/vitest-agent", path: "schemas", name: "run", versions: ["5.0"], appendVersion: false })`
in `run-report-schema.ts`;[^run-report-schema-host] the sdk's build copies
the tree into the emitted package so `./schemas/*.json` resolves offline.
`RenderedOutput` (the type every
formatter returns) is a discriminated union whose `report` member carries
a flat `filename` alongside `content` and `contentType`, distinct from the
`stdout` / `file` / `github-summary` members that share one
shape.[^rendered-output-type] The plugin owns writing report files:
`utils/report-writer.ts` creates the `createReport` handle lazily on the
first report-targeted output — `createReport` mkdirs eagerly and
synchronously, so a run that emits no report output leaves no directory
behind — never calls `clean()` (it would wipe a prior shard's output and
is a no-op under `--merge-reports` anyway), rejects `/`, `\`, `.`, and
`..` in both the filename and the scope, and writes failures to stderr
rather than failing the run.[^report-writer] `AgentPlugin({ report })`
defaults report files on for the `agent` and `ci` executors and off for a
human at a terminal; `report: false` disables them entirely, and `report:
{ scope }` renames the directory, with `"vitest-agent"` as the default
scope.[^plugin-report-option]

## Alternatives rejected

- **Reuse the existing `file` target on `RenderedOutput`** for report
  output. Rejected because `file` has always been the reserved no-op with
  no path convention — giving report output its own discriminated-union
  member keeps the reporter out of path resolution entirely and lets
  Vitest's own `createReport` own cleanup, sharding, and merge behavior.
- **Version `run.json`'s shape implicitly through `@vitest-agent/sdk`'s
  own package version.** Rejected because a reader with no dependency on
  the sdk package — a shell hook, a CI step written in another language —
  has no way to observe a package version at all; an explicit
  `schemaVersion` field on the envelope is the only contract such a reader
  can check.
- **Publish the JSON Schema through the docs site** (a second generated
  copy under `website/docs/public/schemas/`, served at
  `vitest-agent.dev/schemas/…`). This was the first design and was
  dropped before any version was ever served — the `1.0.0` URL never went
  live and had no adopters — because it coupled every sdk release to a
  docs deploy (the `$id` had to resolve before the package publishing it
  could ship) and kept two committed copies of one document in sync by
  test. Hosting the committed file from GitHub raw makes merge to `main`
  the publish step and leaves exactly one source; the version label moved
  to `5.0` to align with the family's v5 track at the same time.
- **Hand-roll the generator** (a `scripts/generate-schemas.ts` driving
  `@effected/schemastore`'s pipeline directly). Rejected in favour of the
  `schemastore` CLI's `build` / `check` pair, which owns the drift and
  version-gate semantics the script re-implemented and gives turbo and CI
  a task to wire (`schema:build` ahead of `build:dev`, `schema:check` as
  the gate).

## Consequences

A contract change to `run.json` must bump the schema's version label, the
`$id` URL, and the committed path together — `schemastore check` reports
drift otherwise, and `packages/sdk/__test__/schema-drift.e2e.test.ts`
pins `RUN_REPORT_FILE_SCHEMA_URL` to the hosted identity's `$id` and to
the committed document's own `$id`, so a one-sided bump fails before it
reaches a consumer.[^schema-drift-e2e] The schema config lives under
`packages/sdk/lib/` rather than `src/` because sdk `src/` may not import
`@effected/*`. Report files are
machine-facing and independent of console mode: an `agent`-mode run that
prints nothing to stdout still writes them, and the `.vitest/` directory
belongs in a consumer's `.gitignore` rather than being treated as ordinary
build output.

## Related

- [Interface: report-files](../interfaces/report-files.md)
- [Module: plugin](../modules/plugin.md)

[^run-report-file-schema]: `../../packages/sdk/src/schemas/RunReportFile.ts:25-26,58-62`
[^schemastore-config]: `../../packages/sdk/lib/configs/schemastore.config.ts`
[^run-report-schema-host]: `../../packages/sdk/lib/configs/run-report-schema.ts`
[^published-schema-doc]: `../../schemas/5.0/run.json`
[^schema-drift-e2e]: `../../packages/sdk/__test__/schema-drift.e2e.test.ts`
[^rendered-output-type]: `../../packages/sdk/src/formatters/types.ts:17-24`
[^report-writer]: `../../packages/plugin/src/utils/report-writer.ts:43-46,54-60,74-80,83-112`
[^plugin-report-option]: `../../packages/plugin/src/plugin.ts:400-410`
