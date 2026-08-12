---
"@vitest-agent/cli": minor
---

## Features

New `vitest-agent agent check-test-path <path>` subcommand classifies a file path against the test-layout rule (`classifyTestPath` from `@vitest-agent/sdk`) and prints `{ verdict, workspace, suggestedPath }` as JSON. Exits non-zero when no workspace contains the path, so hook callers can fail open rather than read a verdict that was never rendered.

Powers the Claude Code plugin's new PreToolUse `test-location` hook, which denies writing a new test file to a location Vitest will never collect.
