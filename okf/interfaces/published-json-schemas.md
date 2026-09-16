---
type: Interface
title: Published JSON Schema documents
description: The generated JSON Schema documents @vitest-agent/sdk ships, committed at the repo-root schemas/ tree and served raw by GitHub.
kind: config
resource: ../../schemas
tags:
  - docs
  - release
  - compat
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
  body_sha256: 904e207e279597e785bca23afeb4caad0068734578d22d7e600acde94a7a6271
sources:
  - id: schemastore-config
    resource: ../../packages/sdk/lib/configs/schemastore.config.ts
  - id: run-report-schema-host
    resource: ../../packages/sdk/lib/configs/run-report-schema.ts
  - id: run-report-schema-doc
    resource: ../../schemas/5.0/run.json
  - id: run-report-file-schema-url
    resource: ../../packages/sdk/src/schemas/RunReportFile.ts
  - id: sdk-package-json
    resource: ../../packages/sdk/package.json
  - id: sdk-build-config
    resource: ../../packages/sdk/savvy.build.ts
  - id: sdk-turbo-json
    resource: ../../packages/sdk/turbo.json
  - id: schema-drift-e2e
    resource: ../../packages/sdk/__test__/schema-drift.e2e.test.ts
---

# Interface: published JSON Schema documents

## What stays stable

The family publishes generated, committed JSON Schema documents under the
repo-root `schemas/<version>/` tree. Today that set holds exactly one
document: `schemas/5.0/run.json`, the schema for
[Interface: report-files](report-files.md)'s `run.json`
envelope.[^run-report-schema-doc] The version label (`5.0`) tracks the
family's v5 track, not any single package's version. `@vitest-agent/sdk`
ships the same tree inside the installed package: `package.json`'s
`"./schemas/*.json"` export subpath resolves it offline without a network
round trip.[^sdk-package-json]

## Where the document is served

Each document's `$id` is a GitHub raw URL of the committed file on
`main`. For the current document, `RUN_REPORT_FILE_SCHEMA_URL` in
`packages/sdk/src/schemas/RunReportFile.ts` is
`https://raw.githubusercontent.com/spencerbeggs/vitest-agent/main/schemas/5.0/run.json`,
written as the first key of every `run.json` the reporter
emits.[^run-report-file-schema-url] There is one source: the committed
file at `schemas/5.0/run.json` *is* what the `$id` resolves to, so
merging to `main` is what publishes it — no docs-site deploy is
involved.

## How the document is generated

`@effected/schemastore-cli` produces the document from the Effect Schema
(`schemastore build` / `schemastore check`, exposed as the sdk's
`schema:build` / `schema:check` scripts) driven by
`packages/sdk/lib/configs/schemastore.config.ts`, which maps
`RunReportFile` onto the hosted identity and emits objects open
(`jsonSchema: { onExcessProperty: "ignore" }`) to match how
`RunReportFile` decodes.[^schemastore-config] The hosted identity lives in
`packages/sdk/lib/configs/run-report-schema.ts` as
`HostedSchema.github({ repo: "spencerbeggs/vitest-agent", path: "schemas", name: "run", versions: ["5.0"], appendVersion: false })`,
the one value the `$id` and the write path derive
from.[^run-report-schema-host] Both files live under `lib/`, not `src/`,
because sdk `src/` may not import `@effected/*`
(see [Module: sdk](../modules/sdk.md)'s boundary).

Turbo wires `schema:build` as a prerequisite of the sdk's `build:dev`, and
`schema:check` as a separate uncached task.[^sdk-turbo-json] The sdk's
`savvy.build.ts` copies the repo-root `schemas/` tree into each emitted
package directory after the bundler runs, which is how
`@vitest-agent/sdk/schemas/5.0/run.json` resolves from an npm
install.[^sdk-build-config]

## The drift gate

Two checks keep the committed document, the Effect Schema, and the URL
constant from drifting apart:

- `schemastore check` reports `DRIFT` when the committed document differs
  from what `build` would write, and fails a contract change that lacks a
  version bump.
- `packages/sdk/__test__/schema-drift.e2e.test.ts` spawns
  `schemastore check --format=json` and asserts a clean, unchanged
  report, then pins `RUN_REPORT_FILE_SCHEMA_URL === RunReportSchemaHost.$id`
  and the committed document's own `$id` to the same
  string.[^schema-drift-e2e]

There is no longer a release-ordering gate on this document: the URL is
live as soon as the file is on `main`, before any package publishes. See
[Runbook: release](../runbooks/release.md).

## How a consumer references a document

- **Offline, from code.** `import schema from "@vitest-agent/sdk/schemas/5.0/run.json"` resolves the shipped copy with no network access.
- **From a `run.json` file.** The file itself carries an optional
  `$schema` field pointing at the served URL, so an editor with JSON
  Schema support can validate it in place.
- **From `vitest-agent.config.toml`.** See
  [Interface: config-toml](config-toml.md) for the config file's own
  schema story — the TOML loader validates against
  `packages/sdk/src/schemas/Config.ts` directly rather than a published
  JSON Schema document, since no separate document is generated for it
  today.

A contract change to the underlying Effect Schema bumps the document's
version label, `$id`, and path together — `schemastore check` fails
otherwise. See
[Decision 67](../decisions/67-report-files-are-a-versioned-public-contract.md)
for why the envelope carries its own version independent of any package
release.

[^schemastore-config]: `../../packages/sdk/lib/configs/schemastore.config.ts`
[^run-report-schema-host]: `../../packages/sdk/lib/configs/run-report-schema.ts`
[^run-report-schema-doc]: `../../schemas/5.0/run.json`
[^run-report-file-schema-url]: `../../packages/sdk/src/schemas/RunReportFile.ts:25-26`
[^sdk-package-json]: `../../packages/sdk/package.json`
[^sdk-build-config]: `../../packages/sdk/savvy.build.ts:17-36`
[^sdk-turbo-json]: `../../packages/sdk/turbo.json`
[^schema-drift-e2e]: `../../packages/sdk/__test__/schema-drift.e2e.test.ts`
