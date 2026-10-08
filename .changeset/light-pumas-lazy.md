---
"@vitest-agent/reporter": major
---

## Features

Importing the reporter no longer loads React or Ink (1051 to 481 modules). The live view and the report-time Ink render now load lazily, only when they actually render.

The human report-time render now uses the terminal width instead of a fixed 80 columns, falling back to 80 when output is not a TTY.

In the `stream` live view, stray output from tests (writes straight to stdout or stderr) now prints above the Ink frame instead of landing under it and leaving stranded lines in the terminal. The reporter implements the new optional `printStrayLine` method through the kit's live `logConsole`.

The report-time human render (`renderHumanStringForReport`) now shows the stray-output note. Because it now routes through `dispatchInk`, it also shows the scoped-coverage note that the agent path already showed.

## Breaking Changes

The `OutputFormat` type re-export is removed, following its removal from `@vitest-agent/sdk`.
