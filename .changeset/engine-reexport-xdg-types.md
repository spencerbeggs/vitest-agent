---
"@vitest-agent/engine": minor
---

## Features

- Re-export the `AppDirs` and `AppDirsError` types from `@effected/xdg`. They appear in the requirements and error channel of `resolveDataPath`, so dependents can now name them in declarations without depending on `@effected/xdg` directly. TypeScript 7.1 rejects inferred types it cannot name (TS2883).
