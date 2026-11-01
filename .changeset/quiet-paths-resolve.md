---
"@vitest-agent/engine": minor
---

## Features

* `ProjectDiscoveryLive`, `resolveProjectKeyFromCwdEffect`, `resolveSessionForRecording`, `recordTurnEffect`, `recordTddArtifactEffect`, and `resolveDataPath` now require `Path.Path` in their environment. Provide it from `PlatformLive` or `@effect/platform-node`'s `NodePath.layer` when calling them directly; core `Path.layer` is POSIX-only and gives wrong results on Windows.
* `@effected/memfs` is now a runtime dependency.

## Bug Fixes

* Windows project-key and project-discovery path handling no longer forces the POSIX `Path.layer`. If you hit this bug on Windows, the project key and the `data.db` directory resolve differently after upgrading, and history recorded under the old key is orphaned (not deleted).
* Turn payloads are now decoded through their schema. A malformed payload fails with a typed `DataStoreError`, and a direct `writeTurn` of a `tool_result` without `success` now fails instead of silently storing `0`.
* Error detail text is rendered consistently through `ErrorText.describe`.
