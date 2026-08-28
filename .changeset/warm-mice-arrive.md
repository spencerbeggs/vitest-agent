---
"@vitest-agent/sdk": patch
---

## Refactoring

- Route `resolveDataPath` directory creation through Effect `FileSystem.makeDirectory(..., { recursive: true })` so path resolution no longer uses direct `node:fs` calls inside the Effect flow.
