---
"@vitest-agent/mcp": minor
---

## Features

- Every served tool's input schema is now strict — an unknown key is rejected with an error naming the offending key(s) and the full list of accepted params, instead of being silently stripped. A mistyped `run_tests` param used to run the entire workspace and time out at the 120s default instead of surfacing the typo.
- `run_tests` gained working `tags` and `passWithNoTests` params — both were declared on the tool's internal implementation but never reached the served schema, so a real client's tag filter was dropped and the run went wide (#200). The `ok` result also gained a `scope` field echoing the resolved run:

  ```ts
  const result = await run_tests({ project: "sdk", tags: { any: ["int"] } });
  // result.scope -> { project: "sdk", files: [], tags: { any: ["int"] } }
  ```

- `test_history` accepts optional `testName`, `modulePath`, and `limit` params, pushed down as SQL predicates with a per-test run cap (default 20). Narrowing to one test or module avoids the multi-hundred-KB whole-project payload the tool used to return for every call.

## Bug Fixes

- `test({ action: "get" })` now scopes its history lookup to the matched test's own module. Previously, two same-named tests in different modules could return each other's history (#241).
- The server survives a stray `unhandledRejection` / `uncaughtException` raised after the transport connects — it logs to stderr and the stdio transport stays alive instead of dying mid-session. A tool resolver that throws unexpectedly now returns a structured error result instead of crashing the call.
