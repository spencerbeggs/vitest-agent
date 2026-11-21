---
"@vitest-agent/engine": minor
---

## Features

- `FailureSignatureWriteInput` gains an optional `countOccurrence` (default `true`). With `false`, the signature row is still upserted and `last_seen_at` advances, but `occurrence_count` is not incremented; a signature first written this way starts at 0.

## Bug Fixes

- `computeFailureSignature` treats Vitest 5.1's `TestTimeoutError` and `HookTimeoutError` as `Error`, so timeout signatures recorded under Vitest 5.0 keep their hash and history after the upgrade.
