---
"vitest-agent-cli": minor
---

## Features

### Cross-package version constants

Exports CURRENT_CLI_VERSION, a build-time string constant injected from package.json at compile time.

Before Command.run executes, the CLI bin compares CURRENT_CLI_VERSION against CURRENT_SDK_VERSION. Any mismatch emits a single namespaced line to stderr in the form "[vitest-agent-cli] version drift: vitest-agent-sdk@X with vitest-agent-cli@Y. Reinstall vitest-agent-* packages so versions match." The check is observation-only and never throws or exits.
