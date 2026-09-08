---
"@vitest-agent/mcp": minor
---

## Features

`test_errors` rows now carry an `annotations` array — the test annotations the author recorded via `context.annotate`, rendered in both the markdown and XML formats.

The `test` tool gains `annotations` and `artifacts` actions, both scoped to one test by `fullName` (plus optional `project` / `modulePath`) and returning descriptors — content type, path, byte size — never raw bytes by default. Pass `maxBytes` (default `0`) to include inline attachment bodies up to that total byte budget; a body already too large to have been persisted inline is never returned regardless of `maxBytes`.

Help text documents both new actions and disambiguates the `test` tool's `artifacts` action — Vitest test artifacts — from `tdd_artifact_list`'s TDD artifacts, which are unrelated red/green evidence rows.
