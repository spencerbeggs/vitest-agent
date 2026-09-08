---
"@vitest-agent/plugin": minor
---

## Features

### Test annotations and test artifacts

The plugin now ingests test annotations and test artifacts at run end, reading `testCase.annotations()` and `testCase.artifacts()` during the persistence walk so merge-report runs are covered as well as single-shard ones. Artifacts whose type carries the reserved `internal:` prefix are skipped. Attachments referenced by path are never copied — only their path, content type and byte size are recorded, alongside an inline body when it is small enough to persist.

The streaming `TestAnnotated` and `TestArtifactRecorded` run events now also carry the annotation type, source location, and attachment descriptors.

### Report files

New `report` option on `AgentPlugin`, on by default for the `agent` and `ci` executors and off for `human`. Pass `report: false` to disable report files outright, or `{ scope }` to rename the directory they land in — otherwise files are written under `.vitest/vitest-agent/`. The plugin creates the underlying Vitest 5 `Report` handle lazily on first write and never calls `clean()` on it, so a prior shard's output survives. Requires a Vitest version whose reporter context exposes `createReport`; older versions fail loudly with an upgrade message instead of silently dropping report files.

Report filenames and the configured scope name are validated up front — no path separators, and no `.` or `..` scope names that could nest or escape `.vitest/`.
