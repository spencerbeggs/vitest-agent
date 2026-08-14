---
"@vitest-agent/sdk": minor
---

## Features

- `DataReader.getHistory` accepts an optional third argument, `HistoryQueryOptions`, to narrow a project's history to one test or module and cap how many runs come back per test:

  ```ts
  import type { HistoryQueryOptions } from "@vitest-agent/sdk";

  const options: HistoryQueryOptions = { modulePath: "src/foo.test.ts", limit: 10 };
  const history = await reader.getHistory("my-project", options);
  ```

  `testName` and `modulePath` narrow via exact-match SQL predicates; `limit` caps runs kept per `(module_path, full_name)` pair, most-recent-first, defaulting to 20. `HistoryQueryOptions` is exported from both the main entry point and `@vitest-agent/sdk/testing`. No SQLite schema change.
