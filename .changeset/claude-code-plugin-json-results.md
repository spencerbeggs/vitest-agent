---
"@vitest-agent/claude-code-plugin": patch
---

## Bug Fixes

* The `tdd-task` agent no longer tells the model to call `test_errors` with a `format: "xml"` argument. The tool never accepted that argument, and strict input validation rejected the call. The agent now reads the cite-able `id` and `topStackFrameId` values from `structuredContent.errors[]`.
* The `operating-vitest-agent` skill now points agents at `report.consoleLeaks` and `scopedNote` in `structuredContent` instead of a markdown summary line that `@vitest-agent/mcp` no longer emits.
* The `tdd-artifact` PostToolUse hook documents that `run_tests` results arrive as JSON. It still accepts the markdown headline older servers send.

## Documentation

* The plugin README now gives the correct tool count (30) and says tool results are JSON, not markdown.
