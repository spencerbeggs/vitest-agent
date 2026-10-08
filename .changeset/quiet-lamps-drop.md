---
"@vitest-agent/sdk": major
---

## Breaking Changes

Removed the unused output-format selection surface. Nothing in the family read it.

- `ResolvedReporterConfig.format` (reached through `ReporterKit.config`) is gone.
- The `OutputFormat` schema and type are removed.

Drop any `format` reads from a custom reporter's `kit.config`, and any `OutputFormat` imports.

## Features

Added stray-output reporting, for output that tests (or child processes they start with inherited stdio) write straight to stdout or stderr.

- New `StrayOutput` and `StrayOutputSample` schemas. `AgentReport`, `RunFinished` and `RenderState` gain an optional `strayOutput` field.
- New optional reporter-contract method `VitestAgentReporter.printStrayLine?(stream, line): boolean`, so a reporter with a live view can print a captured line above its frame.
- New utils: `makeStrayOutputRecorder`, `isEscapeOnly`, `STRAY_OUTPUT_SOURCE`, `StrayOutputSource`, `readStrayOutput` and `formatStrayOutputNote`.
- The published run JSON Schema (`schemas/5.0/run.json`) gains the optional `strayOutput` property. The change is additive.
