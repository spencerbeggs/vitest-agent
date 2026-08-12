---
"@vitest-agent/sdk": minor
---

## Features

* Exported `coerceErrorText` — coerces any unknown error-field value (message, name, diff, stack, …) into a string that is safe to persist or render. Vitest and Effect can put non-string values (arbitrary success values from `Effect.flip`, a throwing `ConfigError.message` getter) into what is typed as a string error field; this handles every case exception-safely.
* `AgentReport.summary.modules`, `RenderState.collectedModules`, and `RunEvent`'s `RunFinished.collectedModules` — new optional fields that carry the true collected-module count through the report and event pipeline, so a fully-passing run no longer reads as "0 modules"

## Bug Fixes

* `extractSqlReason`, `formatFatalError`, and `normalizeAssertionShape` no longer throw when handed a malformed error shape (a throwing `message`/`cause` getter, a non-string message) — they degrade to a placeholder string instead of crashing report generation
* `buildAgentReport` now also marks a module as failed when one of its suites — not just its tests — is in a failed state or carries its own errors. A `beforeAll`/`afterAll` hook throw is attached to the suite entity, not any individual test, and could previously leave a module reporting as fully passed even though the suite itself failed
