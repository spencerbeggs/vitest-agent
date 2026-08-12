---
"@vitest-agent/cli": minor
---

## Features

New `vitest-agent agent check-test-path <path>` subcommand classifies a file path against the test-layout rule (`classifyTestPath` from `@vitest-agent/sdk`) and prints `{ verdict, workspace, suggestedPath }` as JSON.

Exit `1` means "no verdict was rendered" — not an error, and not the exit-code taxonomy the `agent` sidecar subcommands share. It fires when no workspace contains the path, when the path sits under a directory discovery never walks into, and when a directory between the owning package root and the file declares its own `package.json`, marking an independent unit (a vendored upstream checkout, a fixture package) whose tests belong to a different discovery pass. Nothing is written to stdout in those cases, and callers must fail open.

Powers the Claude Code plugin's new PreToolUse `test-location` hook, which denies writing a new test file to a location Vitest will never collect.
