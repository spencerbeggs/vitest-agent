---
"@vitest-agent/mcp": minor
---

## Features

* `toolHandlers` is now an `Effect` (the replay store mapped into the handler record) instead of a plain record, so the replay store is built and wrapped once at server build.
* The `ServerLayer` output type widened to `McpServer | McpRequest<"Requires", Scope>`, and the `PromptsLayer` type changed, following Effect 4.1's `McpServer` registrations and per-request requirements. Code that composes these layers directly may need type adjustments.

## Bug Fixes

* `run_tests` root validation now runs in the server fiber.
* A `{ kind: "error" }` result for a non-`Error` rejection now shows the message or its JSON instead of `[object Object]`.
