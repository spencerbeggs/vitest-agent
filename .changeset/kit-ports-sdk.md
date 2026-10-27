---
"@vitest-agent/sdk": major
---

## Breaking Changes

The sdk no longer exports helpers that nothing consumed or that the engine and the `@effected` kit now own.

* Removed `probeHostMetadata` and its types. The host metadata probe now lives in `@vitest-agent/engine` as `probeHostMetadataFromEnv`.
* Removed `compressLines` and `normalizeWorkspaceKey`; the engine and the kit own these now and the sdk exports nothing in their place.
* Removed `formatGfm`, `safeFilename`, `detectPackageManager`, `getRunCommand`, `formatConsoleMarkdown` and the rest of the console-markdown formatter.
* Removed `formatFatalError`; it now ships from `@vitest-agent/engine`.

To migrate, import `formatFatalError` and `probeHostMetadataFromEnv` from `@vitest-agent/engine`. For the other removed helpers, drop the import or copy the helper into your own code; `stripAnsi` is still exported.

## Features

* Added `VITEST_CONFIG_FILES`, the single list of Vitest and Vite config filenames that the cli and mcp packages now share.
