---
"@vitest-agent/engine": minor
---

## Features

* Added `resolveProjectKeyFromCwdEffect(cwd)`, an Effect form of `resolveProjectKeyFromCwd` that reads `package.json` through the ambient `FileSystem` service. It follows the same rules and never fails.
* Added the `SessionEnvFileSystem` interface and an optional `fileSystem` option on `recoverSessionContextFromSessionEnv`, so session-env recovery can read from a source other than the real disk. The default is unchanged.
