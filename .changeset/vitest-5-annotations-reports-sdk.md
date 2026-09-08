---
"@vitest-agent/sdk": minor
---

## Breaking Changes

`RenderedOutput` changed from an interface to a discriminated union so the new `report` member could be added. Consumers extending or structurally matching the old interface must switch to matching one of the union's members instead.

## Features

### Test annotations and test artifacts

New `TestAnnotation`, `TestArtifact`, `TestAttachment` and `TestArtifactLocation` schemas, plus `DataStore.writeAnnotations` / `writeArtifacts` and `DataReader.getAnnotationsForTest` / `getArtifactsForTest`. Attachments are stored by reference — path, content type and byte size — with an inline body persisted only when the stored bytes stay under 64 KiB.

Migration `0002_test_artifacts` recreates `test_annotations` without the `notice | warning | error` constraint (a Vitest annotation type is any string), drops its inline attachment columns in favour of the existing `attachments` table, adds `test_artifacts.data` for an artifact's custom fields, and adds `attachments.byte_size`.

### Report files

New `report` target on `RenderedOutput` carrying a `filename` and content destined for Vitest's report scope directory, a `RunReportFile` schema describing the `run.json` envelope (`schemaVersion`, an ISO-8601 `generatedAt`, and `reports` — one `AgentReport` per Vitest project), and a `report` option on `AgentPluginOptions`.

The `RunReportFile` contract is also published as a standalone JSON Schema at `schemas/run-report-file-1.0.0.json`, reachable via the new `./schemas/*.json` export, with `RUN_REPORT_FILE_SCHEMA_URL` pointing at the canonical hosted copy written into `run.json`'s `$schema` field.

## Dependencies

| Dependency             | Type          | Action | From | To      |
| :--------------------- | :------------ | :----- | :--- | :------ |
| @effected/schemastore  | devDependency | added  | —    | 0.6.0   |
| tsx                    | devDependency | added  | —    | 4.23.13 |
